import type { ReservationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasGlobalDataAccess } from "@/lib/rbac";
import type { AuthSession } from "@/lib/auth";
import type {
  LocationSelectionAvailability,
  LocationSelectionAvailabilityState,
  LocationSelectionConflict
} from "@/lib/location-selection-dto";

export const LOCATION_SELECTION_BLOCKING_STATUSES = ["HOLD", "RESERVED", "BOOKED"] as const;
export const LOCATION_SELECTION_NON_BLOCKING_STATUSES = ["CANCELLED", "EXPIRED", "LOST", "ARCHIVED"] as const;

type AvailabilityLocation = {
  id: string;
  code: string;
  status: string;
  availabilityText: string | null;
  blockedReason: string | null;
  blockedFrom: Date | null;
  blockedUntil: Date | null;
};

export async function getLocationSelectionAvailability(input: {
  locationIds: string[];
  periodStart?: string | null;
  periodEnd?: string | null;
  session: AuthSession;
}) {
  const locationIds = unique(input.locationIds).slice(0, 500);
  const periodStart = parseDate(input.periodStart);
  const periodEnd = parseDate(input.periodEnd);

  if (!locationIds.length) return {};

  const locations = await prisma.location.findMany({
    where: { id: { in: locationIds } },
    select: {
      id: true,
      code: true,
      status: true,
      availabilityText: true,
      blockedReason: true,
      blockedFrom: true,
      blockedUntil: true
    }
  });

  if (!periodStart || !periodEnd) {
    return Object.fromEntries(locations.map((location) => [location.id, unknownAvailability(location, "Alege perioada pentru disponibilitate.")]));
  }

  if (periodStart > periodEnd) {
    return Object.fromEntries(locations.map((location) => [location.id, unknownAvailability(location, "Perioada selectata nu este valida.")]));
  }

  const conflicts = await prisma.reservation.findMany({
    where: {
      locationId: { in: locationIds },
      status: { in: [...LOCATION_SELECTION_BLOCKING_STATUSES] as ReservationStatus[] },
      periodStart: { lte: periodEnd },
      periodEnd: { gte: periodStart }
    },
    include: {
      client: { select: { companyName: true } },
      campaign: { select: { campaignName: true } },
      sellerUser: { select: { name: true } }
    },
    orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }]
  });

  return Object.fromEntries(
    locations.map((location) => {
      const locationConflicts = conflicts.filter((conflict) => conflict.locationId === location.id);
      return [
        location.id,
        buildAvailability({
          location,
          conflicts: locationConflicts.map((conflict) => serializeConflict(conflict, input.session)),
          periodStart,
          periodEnd
        })
      ];
    })
  );
}

export function availabilitySummary(input: {
  state: LocationSelectionAvailabilityState;
  conflictCount: number;
  warnings: string[];
}) {
  if (input.state === "UNKNOWN") return "Alege perioada";
  if (input.state === "CONFLICT") return `${input.conflictCount} conflict${input.conflictCount === 1 ? "" : "e"}`;
  if (input.state === "PARTIAL") return "Disponibil partial";
  if (input.warnings.length) return "Disponibil cu note";
  return "Disponibil";
}

function buildAvailability(input: {
  location: AvailabilityLocation;
  conflicts: LocationSelectionConflict[];
  periodStart: Date;
  periodEnd: Date;
}): LocationSelectionAvailability {
  const warnings = locationWarnings(input.location, input.periodStart, input.periodEnd);
  if (input.conflicts.length) {
    return {
      locationId: input.location.id,
      state: "CONFLICT",
      label: availabilitySummary({ state: "CONFLICT", conflictCount: input.conflicts.length, warnings }),
      warnings,
      conflicts: input.conflicts
    };
  }

  return {
    locationId: input.location.id,
    state: "AVAILABLE",
    label: availabilitySummary({ state: "AVAILABLE", conflictCount: 0, warnings }),
    warnings,
    conflicts: []
  };
}

function unknownAvailability(location: AvailabilityLocation, reason: string): LocationSelectionAvailability {
  return {
    locationId: location.id,
    state: "UNKNOWN",
    label: "Alege perioada",
    warnings: [reason],
    conflicts: []
  };
}

function serializeConflict(
  reservation: {
    id: string;
    locationId: string;
    status: string;
    periodStart: Date;
    periodEnd: Date;
    clientName: string;
    campaignName: string | null;
    salesperson: string | null;
    ownerId: string | null;
    sellerUserId: string | null;
    client?: { companyName: string } | null;
    campaign?: { campaignName: string } | null;
    sellerUser?: { name: string } | null;
  },
  session: AuthSession
): LocationSelectionConflict {
  const canSeeDetails =
    hasGlobalDataAccess(session.role) ||
    reservation.sellerUserId === session.id ||
    reservation.ownerId === session.id ||
    (!reservation.ownerId && !reservation.sellerUserId && [session.name, session.email].includes(reservation.salesperson || ""));

  return {
    reservationId: reservation.id,
    locationId: reservation.locationId,
    status: reservation.status,
    periodStart: reservation.periodStart.toISOString(),
    periodEnd: reservation.periodEnd.toISOString(),
    clientName: canSeeDetails ? reservation.client?.companyName || reservation.clientName : null,
    campaignName: canSeeDetails ? reservation.campaign?.campaignName || reservation.campaignName : null,
    sellerName: canSeeDetails ? reservation.sellerUser?.name || reservation.salesperson : null
  };
}

function locationWarnings(location: AvailabilityLocation, periodStart: Date, periodEnd: Date) {
  const warnings: string[] = [];
  if (!["AVAILABLE", "AVAILABLE_FROM"].includes(location.status)) {
    warnings.push(`Status inventar: ${location.status}. Verifica disponibilitatea comerciala.`);
  }
  if (location.blockedReason && blockOverlaps(location.blockedFrom, location.blockedUntil, periodStart, periodEnd)) {
    warnings.push(`Locatie blocata: ${location.blockedReason}`);
  }
  if (location.availabilityText) {
    warnings.push(`Nota disponibilitate: ${location.availabilityText}`);
  }
  return warnings;
}

function blockOverlaps(blockedFrom: Date | null, blockedUntil: Date | null, periodStart: Date, periodEnd: Date) {
  if (!blockedFrom && !blockedUntil) return true;
  const start = blockedFrom || new Date("1970-01-01T00:00:00.000Z");
  const end = blockedUntil || new Date("9999-12-31T00:00:00.000Z");
  return start <= periodEnd && end >= periodStart;
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
