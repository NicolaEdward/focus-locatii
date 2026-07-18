import { prisma } from "../src/lib/prisma";
import { isEffectiveBlockingReservation, isEffectiveHold } from "../src/lib/reservation-lifecycle-domain";

async function main() {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [reservations, locations, overrides] = await Promise.all([
    prisma.reservation.findMany({
      select: {
        id: true,
        locationId: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        holdExpiresAt: true,
        createdAt: true,
        location: { select: { code: true } }
      },
      orderBy: [{ locationId: "asc" }, { periodStart: "asc" }, { id: "asc" }]
    }),
    prisma.location.findMany({
      select: {
        id: true,
        code: true,
        lifecycleStatus: true,
        blockedReason: true,
        blockedFrom: true,
        blockedUntil: true
      }
    }),
    prisma.locationAvailabilityOverride.findMany({
      where: { clearedAt: null },
      select: { id: true, locationId: true, type: true, periodStart: true, periodEnd: true }
    })
  ]);

  const effective = reservations.filter((row) => isEffectiveBlockingReservation(row, now));
  const expiredStoredHolds = reservations.filter((row) =>
    (row.status === "HOLD" || row.status === "RESERVED") && !isEffectiveHold(row, now)
  );
  const missingExplicitExpiry = reservations.filter((row) =>
    (row.status === "HOLD" || row.status === "RESERVED") && row.holdExpiresAt == null
  );
  const invalidPeriods = reservations.filter((row) => row.periodStart > row.periodEnd);
  const overlaps = [] as Array<{
    locationId: string;
    locationCode: string;
    firstId: string;
    firstStatus: string;
    secondId: string;
    secondStatus: string;
    overlapStart: string;
    overlapEnd: string;
  }>;

  const byLocation = groupBy(effective, (row) => row.locationId);
  for (const rows of byLocation.values()) {
    for (let left = 0; left < rows.length; left += 1) {
      for (let right = left + 1; right < rows.length; right += 1) {
        const first = rows[left];
        const second = rows[right];
        if (first.periodStart > second.periodEnd || first.periodEnd < second.periodStart) continue;
        overlaps.push({
          locationId: first.locationId,
          locationCode: first.location.code,
          firstId: first.id,
          firstStatus: first.status,
          secondId: second.id,
          secondStatus: second.status,
          overlapStart: maxDate(first.periodStart, second.periodStart).toISOString(),
          overlapEnd: minDate(first.periodEnd, second.periodEnd).toISOString()
        });
      }
    }
  }

  const activeOverrides = overrides.filter((row) =>
    row.periodStart <= today && (!row.periodEnd || row.periodEnd >= today)
  );
  const overrideReservationOverlaps = overrides.flatMap((override) =>
    (byLocation.get(override.locationId) || [])
      .filter((reservation) => override.periodStart <= reservation.periodEnd && (!override.periodEnd || override.periodEnd >= reservation.periodStart))
      .map((reservation) => ({ overrideId: override.id, reservationId: reservation.id, locationId: override.locationId }))
  );
  const nonActiveWithEffectiveReservation = locations.filter((location) =>
    location.lifecycleStatus !== "ACTIVE" && (byLocation.get(location.id) || []).length > 0
  );
  const activeLegacyBlocks = locations.filter((location) =>
    Boolean(location.blockedReason) &&
    (!location.blockedFrom || location.blockedFrom <= today) &&
    (!location.blockedUntil || location.blockedUntil >= today)
  );

  const result = {
    generatedAt: now.toISOString(),
    readOnly: true,
    counts: {
      reservations: reservations.length,
      effectiveBlockingReservations: effective.length,
      overlaps: overlaps.length,
      bookedBookedOverlaps: overlaps.filter((row) => row.firstStatus === "BOOKED" && row.secondStatus === "BOOKED").length,
      holdBookedOverlaps: overlaps.filter((row) => [row.firstStatus, row.secondStatus].includes("BOOKED") && [row.firstStatus, row.secondStatus].some((status) => status === "HOLD" || status === "RESERVED")).length,
      holdHoldOverlaps: overlaps.filter((row) => row.firstStatus !== "BOOKED" && row.secondStatus !== "BOOKED").length,
      expiredStoredHolds: expiredStoredHolds.length,
      holdsMissingExplicitExpiry: missingExplicitExpiry.length,
      invalidPeriods: invalidPeriods.length,
      activeOverrides: activeOverrides.length,
      overrideReservationOverlaps: overrideReservationOverlaps.length,
      activeLegacyBlocks: activeLegacyBlocks.length,
      nonActiveLocationsWithEffectiveReservations: nonActiveWithEffectiveReservation.length
    },
    examples: {
      overlaps: overlaps.slice(0, 10),
      expiredStoredHolds: expiredStoredHolds.slice(0, 10).map(safeReservation),
      holdsMissingExplicitExpiry: missingExplicitExpiry.slice(0, 10).map(safeReservation),
      invalidPeriods: invalidPeriods.slice(0, 10).map(safeReservation),
      overrideReservationOverlaps: overrideReservationOverlaps.slice(0, 10),
      activeLegacyBlocks: activeLegacyBlocks.slice(0, 10).map((row) => ({
        id: row.id,
        code: row.code,
        blockedFrom: row.blockedFrom?.toISOString() || null,
        blockedUntil: row.blockedUntil?.toISOString() || null
      })),
      nonActiveLocationsWithEffectiveReservations: nonActiveWithEffectiveReservation.slice(0, 10).map((row) => ({ id: row.id, code: row.code, lifecycleStatus: row.lifecycleStatus }))
    }
  };

  console.log(JSON.stringify(result, null, 2));
}

function safeReservation(row: {
  id: string;
  locationId: string;
  status: string;
  periodStart: Date;
  periodEnd: Date;
  holdExpiresAt: Date | null;
  location: { code: string };
}) {
  return {
    id: row.id,
    locationId: row.locationId,
    locationCode: row.location.code,
    status: row.status,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    holdExpiresAt: row.holdExpiresAt?.toISOString() || null
  };
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(key(row), [...(grouped.get(key(row)) || []), row]);
  return grouped;
}

function minDate(left: Date, right: Date) {
  return left < right ? left : right;
}

function maxDate(left: Date, right: Date) {
  return left > right ? left : right;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
