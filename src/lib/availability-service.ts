import { Prisma } from "@prisma/client";
import { decideAvailability, type AvailabilityDecision } from "@/lib/availability";
import { listActiveLocationAvailabilityOverrides } from "@/lib/location-availability-overrides";
import { prisma } from "@/lib/prisma";
import { effectiveBlockingReservationWhere } from "@/lib/reservation-lifecycle";

type AvailabilityDb = typeof prisma | Prisma.TransactionClient;

const availabilityLocationSelect = {
  id: true,
  code: true,
  status: true,
  lifecycleStatus: true,
  availabilityText: true,
  availableFrom: true,
  availableUntil: true,
  bookedFrom: true,
  bookedUntil: true,
  blockedReason: true,
  blockedFrom: true,
  blockedUntil: true
} satisfies Prisma.LocationSelect;

const availabilityReservationSelect = {
  id: true,
  locationId: true,
  status: true,
  periodStart: true,
  periodEnd: true,
  holdExpiresAt: true,
  createdAt: true,
  clientName: true,
  campaignName: true,
  salesperson: true,
  ownerId: true,
  sellerUserId: true,
  client: { select: { companyName: true } },
  campaign: { select: { campaignName: true } },
  sellerUser: { select: { name: true } }
} satisfies Prisma.ReservationSelect;

export type AvailabilityLocationRow = Prisma.LocationGetPayload<{ select: typeof availabilityLocationSelect }>;
export type AvailabilityReservationRow = Prisma.ReservationGetPayload<{ select: typeof availabilityReservationSelect }>;

export type AvailabilityBatchResult = {
  decisionsByLocationId: Record<string, AvailabilityDecision>;
  locationsById: Map<string, AvailabilityLocationRow>;
  reservationsById: Map<string, AvailabilityReservationRow>;
};

export async function loadAvailabilityDecisions(input: {
  locationIds: string[];
  periodStart?: Date | null;
  periodEnd?: Date | null;
  referenceDate?: Date | null;
  ignoreReservationId?: string | null;
  now?: Date;
  db?: AvailabilityDb;
  requireOverrideStorage?: boolean;
}): Promise<AvailabilityBatchResult> {
  const locationIds = [...new Set(input.locationIds.filter(Boolean))].slice(0, 500);
  const db = input.db || prisma;
  const now = input.now || new Date();
  const referenceDate = input.referenceDate || input.periodStart || input.periodEnd || startOfUtcDay(now);
  if (!locationIds.length) {
    return { decisionsByLocationId: {}, locationsById: new Map(), reservationsById: new Map() };
  }

  const reservationPeriodWhere: Prisma.ReservationWhereInput = input.periodEnd
    ? {
        periodStart: { lte: input.periodEnd },
        periodEnd: { gte: input.periodStart || referenceDate }
      }
    : { periodEnd: { gte: referenceDate } };

  const [locations, reservations, overrides] = await Promise.all([
    db.location.findMany({
      where: { id: { in: locationIds } },
      select: availabilityLocationSelect
    }),
    db.reservation.findMany({
      where: {
        locationId: { in: locationIds },
        ...effectiveBlockingReservationWhere(now),
        ...reservationPeriodWhere,
        ...(input.ignoreReservationId ? { id: { not: input.ignoreReservationId } } : {})
      },
      select: availabilityReservationSelect,
      orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }, { id: "asc" }]
    }),
    listActiveLocationAvailabilityOverrides({
      locationIds,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      referenceDate,
      db,
      requireStorage: input.requireOverrideStorage
    })
  ]);

  const reservationsByLocation = groupBy(reservations, (row) => row.locationId);
  const overridesByLocation = groupBy(overrides, (row) => row.locationId);
  const decisionsByLocationId = Object.fromEntries(locations.map((location) => [
    location.id,
    decideAvailability({
      ...location,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      referenceDate,
      ignoreReservationId: input.ignoreReservationId,
      now,
      reservations: reservationsByLocation.get(location.id) || [],
      availabilityOverrides: overridesByLocation.get(location.id) || []
    })
  ]));

  return {
    decisionsByLocationId,
    locationsById: new Map(locations.map((location) => [location.id, location])),
    reservationsById: new Map(reservations.map((reservation) => [reservation.id, reservation]))
  };
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(key(row), [...(grouped.get(key(row)) || []), row]);
  return grouped;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
