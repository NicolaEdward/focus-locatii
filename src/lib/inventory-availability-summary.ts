import { Prisma } from "@prisma/client";
import { decideAvailability, type AvailabilityInput } from "@/lib/availability";
import { bucharestBusinessDateKey, dateKeyAsStorageDate } from "@/lib/dashboard/executive/time";
import { isDigitalLocationType } from "@/lib/location-medium";
import { prisma } from "@/lib/prisma";
import { effectiveBlockingReservationWhere } from "@/lib/reservation-lifecycle";

export type InventoryAvailabilitySummary = {
  asOf: string;
  dateKey: string;
  timeZone: "Europe/Bucharest";
  activeLocations: number;
  maintenanceLocations: number;
  staticLocations: number;
  digitalLocations: number;
  freeToday: number;
  occupiedToday: number;
  heldToday: number;
  blockedToday: number;
  unknownToday: number;
};
export type InventoryAvailabilityBucket = "DIGITAL" | "FREE" | "OCCUPIED" | "HELD" | "BLOCKED" | "UNKNOWN";
type InventoryDb = Pick<Prisma.TransactionClient, "location" | "reservation" | "locationAvailabilityOverride" | "doohProfile">;

/** Classifies one physical support once. No owner, client or campaign details
 * enter this aggregate; all company blockers still affect availability. */
export function inventoryAvailabilityBucket(
  location: AvailabilityInput & { type?: string | null; hasDoohProfile?: boolean },
  referenceDate: Date,
  now: Date,
): InventoryAvailabilityBucket {
  if (isDigitalLocationType(location.type) || location.hasDoohProfile) return "DIGITAL";
  const decision = decideAvailability({ ...location, referenceDate, now });
  if (decision.status === "UNKNOWN") return "UNKNOWN";
  if (decision.lifecycleReason) return "BLOCKED";
  const current = decision.conflictingIntervals.filter((interval) => interval.from <= referenceDate && interval.to >= referenceDate);
  if (current.some((interval) => interval.source === "RESERVATION" && interval.status === "BOOKED")) return "OCCUPIED";
  if (current.some((interval) => interval.source === "RESERVATION" && ["HOLD", "RESERVED"].includes(interval.status))) return "HELD";
  if (!decision.isBookable) return "BLOCKED";
  return decision.status === "AVAILABLE" ? "FREE" : "UNKNOWN";
}

const locationSelect = {
  id: true, type: true, status: true, lifecycleStatus: true,
  availabilityText: true, availableFrom: true, availableUntil: true,
  bookedFrom: true, bookedUntil: true, blockedReason: true, blockedFrom: true, blockedUntil: true,
} satisfies Prisma.LocationSelect;

/** A stable company-wide snapshot, independent of the seller's private ledger,
 * result pagination or filters. Caller-supplied transactions must provide their
 * own consistent snapshot. No business rows are modified. */
export async function getInventoryAvailabilitySummary(input: { now?: Date; db?: InventoryDb } = {}): Promise<InventoryAvailabilitySummary> {
  const now = input.now || new Date();
  if (input.db) return readInventorySummary(input.db, now);
  return prisma.$transaction((tx) => readInventorySummary(tx, now), {
    isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 30_000,
  });
}

async function readInventorySummary(db: InventoryDb, now: Date): Promise<InventoryAvailabilitySummary> {
  const dateKey = bucharestBusinessDateKey(now), day = dateKeyAsStorageDate(dateKey);
  const endExclusive = new Date(day.getTime() + 86_400_000);
  const result: InventoryAvailabilitySummary = {
    asOf: now.toISOString(), dateKey, timeZone: "Europe/Bucharest",
    activeLocations: 0, maintenanceLocations: await db.location.count({ where: { lifecycleStatus: "MAINTENANCE" } }),
    staticLocations: 0, digitalLocations: 0, freeToday: 0, occupiedToday: 0,
    heldToday: 0, blockedToday: 0, unknownToday: 0,
  };
  let afterId: string | undefined;
  while (true) {
    const locations = await db.location.findMany({
      where: { lifecycleStatus: "ACTIVE", ...(afterId ? { id: { gt: afterId } } : {}) },
      select: locationSelect, orderBy: { id: "asc" }, take: 500,
    });
    if (!locations.length) break;
    const ids = locations.map((location) => location.id);
    const [reservations, overrides, profiles] = await Promise.all([
      db.reservation.findMany({ where: { locationId: { in: ids }, ...effectiveBlockingReservationWhere(now),
        // Stored periods are inclusive calendar labels. Include the entire raw
        // start day before the canonical reducer normalizes legacy noon values.
        periodStart: { lt: endExclusive }, periodEnd: { gte: day },
      }, select: { locationId: true, status: true, periodStart: true, periodEnd: true, holdExpiresAt: true, createdAt: true } }),
      db.locationAvailabilityOverride.findMany({ where: { locationId: { in: ids }, clearedAt: null,
        periodStart: { lt: endExclusive }, OR: [{ periodEnd: null }, { periodEnd: { gte: day } }],
      }, select: { locationId: true, type: true, periodStart: true, periodEnd: true, clearedAt: true } }),
      db.doohProfile.findMany({ where: { locationId: { in: ids } }, select: { locationId: true } }),
    ]);
    const reservationsByLocation = groupByLocation(reservations), overridesByLocation = groupByLocation(overrides);
    const digitalIds = new Set(profiles.map((profile) => profile.locationId));
    for (const location of locations) {
      result.activeLocations++;
      const bucket = inventoryAvailabilityBucket({ ...location,
        reservations: reservationsByLocation.get(location.id) || [],
        availabilityOverrides: overridesByLocation.get(location.id) || [],
        hasDoohProfile: digitalIds.has(location.id),
      }, day, now);
      if (bucket === "DIGITAL") { result.digitalLocations++; continue; }
      result.staticLocations++;
      if (bucket === "FREE") result.freeToday++;
      else if (bucket === "OCCUPIED") result.occupiedToday++;
      else if (bucket === "HELD") result.heldToday++;
      else if (bucket === "BLOCKED") result.blockedToday++;
      else result.unknownToday++;
    }
    afterId = locations.at(-1)!.id;
    if (locations.length < 500) break;
  }
  if (result.staticLocations + result.digitalLocations !== result.activeLocations ||
    result.freeToday + result.occupiedToday + result.heldToday + result.blockedToday + result.unknownToday !== result.staticLocations)
    throw new Error("INVENTORY_AVAILABILITY_PARTITION_INVALID");
  return result;
}

function groupByLocation<T extends { locationId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const group = map.get(row.locationId);
    if (group) group.push(row); else map.set(row.locationId, [row]);
  }
  return map;
}
