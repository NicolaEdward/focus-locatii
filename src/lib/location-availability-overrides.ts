import { Prisma, type LocationAvailabilityOverride, type LocationAvailabilityOverrideType } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { LocationSelectionConflict } from "@/lib/location-selection-dto";

export const LOCATION_AVAILABILITY_OVERRIDE_TYPES = ["COMMERCIAL_BLOCK", "MAINTENANCE", "INTERNAL_HOLD"] as const;

const FAR_FUTURE_DATE = new Date("2099-12-31T00:00:00.000Z");
type AvailabilityOverrideStore = Pick<typeof prisma, "locationAvailabilityOverride">;

export type LegacyManualBlockLocation = {
  id: string;
  code: string;
  blockedReason: string | null;
  blockedFrom: Date | null;
  blockedUntil: Date | null;
};

export async function listLocationAvailabilityOverrideConflicts(input: {
  locationIds: string[];
  periodStart?: Date | null;
  periodEnd?: Date | null;
  referenceDate?: Date | null;
  session: AuthSession;
  db?: AvailabilityOverrideStore;
}): Promise<LocationSelectionConflict[]> {
  const rows = await listActiveLocationAvailabilityOverrides(input);
  return rows.map((row) => availabilityOverrideConflict(row));
}

export async function listActiveLocationAvailabilityOverrides(input: {
  locationIds: string[];
  periodStart?: Date | null;
  periodEnd?: Date | null;
  referenceDate?: Date | null;
  db?: AvailabilityOverrideStore;
  requireStorage?: boolean;
}): Promise<LocationAvailabilityOverride[]> {
  if (!input.locationIds.length) return [];
  const periodWhere = overridePeriodWhere(input.periodStart, input.periodEnd, input.referenceDate);
  const db = input.db || prisma;

  try {
    return await db.locationAvailabilityOverride.findMany({
      where: {
        locationId: { in: input.locationIds },
        clearedAt: null,
        ...periodWhere
      },
      orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }]
    });
  } catch (error) {
    if (!input.requireStorage && isMissingAvailabilityOverrideStorage(error)) return [];
    throw error;
  }
}

export async function createManualAvailabilityOverride(input: {
  locationId: string;
  reason: string;
  periodStart: Date;
  periodEnd?: Date | null;
  notes?: string | null;
  createdByUserId?: string | null;
  type?: LocationAvailabilityOverrideType;
  db?: AvailabilityOverrideStore;
}) {
  const db = input.db || prisma;
  try {
    await db.locationAvailabilityOverride.updateMany({
      where: {
        locationId: input.locationId,
        clearedAt: null,
        type: input.type || "COMMERCIAL_BLOCK"
      },
      data: {
        clearedAt: new Date(),
        clearedByUserId: input.createdByUserId || null
      }
    });

    return await db.locationAvailabilityOverride.create({
      data: {
        locationId: input.locationId,
        type: input.type || "COMMERCIAL_BLOCK",
        reason: input.reason,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd || null,
        notes: input.notes || null,
        createdByUserId: input.createdByUserId || null
      }
    });
  } catch (error) {
    if (isMissingAvailabilityOverrideStorage(error)) return null;
    throw error;
  }
}

export async function clearManualAvailabilityOverrides(input: {
  locationId: string;
  clearedByUserId?: string | null;
  type?: LocationAvailabilityOverrideType;
  db?: AvailabilityOverrideStore;
}) {
  const db = input.db || prisma;
  try {
    return await db.locationAvailabilityOverride.updateMany({
      where: {
        locationId: input.locationId,
        clearedAt: null,
        ...(input.type ? { type: input.type } : {})
      },
      data: {
        clearedAt: new Date(),
        clearedByUserId: input.clearedByUserId || null
      }
    });
  } catch (error) {
    if (isMissingAvailabilityOverrideStorage(error)) return { count: 0 };
    throw error;
  }
}

export function legacyManualBlockConflict(
  location: LegacyManualBlockLocation,
  input: {
    periodStart?: Date | null;
    periodEnd?: Date | null;
    referenceDate?: Date | null;
  }
): LocationSelectionConflict | null {
  if (!location.blockedReason) return null;
  const referenceDate = input.referenceDate || input.periodStart || startOfUtcDay(new Date());
  const blockStart = location.blockedFrom || referenceDate;
  const blockEnd = location.blockedUntil || input.periodEnd || FAR_FUTURE_DATE;
  const overlaps = input.periodStart && input.periodEnd
    ? blockStart <= input.periodEnd && blockEnd >= input.periodStart
    : blockEnd >= referenceDate;
  if (!overlaps) return null;

  return {
    reservationId: `legacy-block:${location.id}`,
    locationId: location.id,
    status: "COMMERCIAL_BLOCK",
    periodStart: blockStart.toISOString(),
    periodEnd: blockEnd.toISOString(),
    clientName: null,
    campaignName: location.blockedReason,
    sellerName: null,
    openEnded: !location.blockedUntil
  };
}

export function isManualAvailabilityStatus(status: string) {
  return LOCATION_AVAILABILITY_OVERRIDE_TYPES.includes(status as LocationAvailabilityOverrideType) || status === "COMMERCIAL_BLOCK";
}

export function manualAvailabilityStatusLabel(status: string) {
  if (status === "MAINTENANCE") return "Mentenanta";
  if (status === "INTERNAL_HOLD") return "Hold intern";
  if (status === "COMMERCIAL_BLOCK") return "Blocaj comercial";
  return status;
}

function availabilityOverrideConflict(row: LocationAvailabilityOverride): LocationSelectionConflict {
  const end = row.periodEnd || FAR_FUTURE_DATE;
  return {
    reservationId: `availability-override:${row.id}`,
    locationId: row.locationId,
    status: row.type,
    periodStart: row.periodStart.toISOString(),
    periodEnd: end.toISOString(),
    clientName: null,
    campaignName: row.reason,
    sellerName: null,
    openEnded: !row.periodEnd
  };
}

function overridePeriodWhere(periodStart?: Date | null, periodEnd?: Date | null, referenceDate?: Date | null) {
  if (periodStart && periodEnd) {
    return {
      periodStart: { lte: periodEnd },
      OR: [{ periodEnd: null }, { periodEnd: { gte: periodStart } }]
    } satisfies Prisma.LocationAvailabilityOverrideWhereInput;
  }

  const reference = referenceDate || periodStart || periodEnd || startOfUtcDay(new Date());
  return {
    OR: [{ periodEnd: null }, { periodEnd: { gte: reference } }]
  } satisfies Prisma.LocationAvailabilityOverrideWhereInput;
}

function isMissingAvailabilityOverrideStorage(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  );
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
