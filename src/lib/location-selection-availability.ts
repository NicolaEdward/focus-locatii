import type { ReservationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasGlobalDataAccess } from "@/lib/rbac";
import type { AuthSession } from "@/lib/auth";
import type {
  LocationSelectionAvailability,
  LocationSelectionAvailabilityState,
  LocationSelectionBlockingInterval,
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
    const today = startOfUtcDay(new Date());
    const futureReservations = await prisma.reservation.findMany({
      where: {
        locationId: { in: locationIds },
        status: { in: [...LOCATION_SELECTION_BLOCKING_STATUSES] as ReservationStatus[] },
        periodEnd: { gte: today }
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
        const intervals = futureReservations
          .filter((reservation) => reservation.locationId === location.id)
          .map((reservation) => serializeConflict(reservation, input.session));
        return [location.id, buildNoPeriodAvailability(location, intervals, today)];
      })
    );
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
  const baseWarnings = locationWarnings(input.location, input.periodStart, input.periodEnd);
  if (input.conflicts.length) {
    const blockingIntervals = input.conflicts.map(toBlockingInterval);
    const explanation = conflictExplanation(blockingIntervals);
    return {
      locationId: input.location.id,
      state: "CONFLICT",
      label: "Indisponibil",
      tone: "red",
      explanation,
      warnings: [explanation, ...baseWarnings.filter((warning) => !isGenericAvailableNote(warning))],
      conflicts: input.conflicts,
      blockingIntervals
    };
  }

  const warnings = baseWarnings.filter((warning) => !isGenericAvailableNote(warning));
  return {
    locationId: input.location.id,
    state: "AVAILABLE",
    label: "Disponibil",
    tone: warnings.length ? "yellow" : "green",
    explanation: warnings[0] || "Disponibil in perioada selectata.",
    warnings,
    conflicts: [],
    blockingIntervals: []
  };
}

function unknownAvailability(location: AvailabilityLocation, reason: string): LocationSelectionAvailability {
  return {
    locationId: location.id,
    state: "UNKNOWN",
    label: "Disponibilitate necunoscuta",
    tone: "gray",
    explanation: reason,
    warnings: [reason],
    conflicts: [],
    blockingIntervals: []
  };
}

function buildNoPeriodAvailability(
  location: AvailabilityLocation,
  futureConflicts: LocationSelectionConflict[],
  today: Date
): LocationSelectionAvailability {
  const intervals = futureConflicts.map(toBlockingInterval);
  const current = futureConflicts.find((conflict) => new Date(conflict.periodStart) <= today && new Date(conflict.periodEnd) >= today);
  const next = futureConflicts.find((conflict) => new Date(conflict.periodStart) > today);
  const baseWarnings = locationWarnings(location, today, today).filter((warning) => !isGenericAvailableNote(warning));

  if (current) {
    const availableFrom = addDays(new Date(current.periodEnd), 1).toISOString();
    const label = `Disponibil din ${formatDate(availableFrom)}`;
    return {
      locationId: location.id,
      state: "CONFLICT",
      label,
      tone: "red",
      explanation: `Ocupat acum: ${formatDate(current.periodStart)} - ${formatDate(current.periodEnd)}.`,
      warnings: [`Ocupat acum pana la ${formatDate(current.periodEnd)}.`, ...baseWarnings],
      conflicts: futureConflicts,
      blockingIntervals: intervals,
      availableFrom
    };
  }

  if (next) {
    const availableUntil = addDays(new Date(next.periodStart), -1).toISOString();
    const hasMultipleFuture = futureConflicts.length > 1;
    return {
      locationId: location.id,
      state: "AVAILABLE",
      label: `Disponibil pana la ${formatDate(availableUntil)}`,
      tone: "yellow",
      explanation: hasMultipleFuture
        ? `Verifica perioada - exista ${futureConflicts.length} rezervari viitoare.`
        : `Urmatoarea ocupare incepe la ${formatDate(next.periodStart)}.`,
      warnings: [
        hasMultipleFuture ? `Exista ${futureConflicts.length} rezervari viitoare.` : `Rezervare viitoare din ${formatDate(next.periodStart)}.`,
        ...baseWarnings
      ],
      conflicts: futureConflicts,
      blockingIntervals: intervals,
      availableUntil
    };
  }

  return {
    locationId: location.id,
    state: "AVAILABLE",
    label: "Disponibil",
    tone: baseWarnings.length ? "yellow" : "green",
    explanation: baseWarnings[0] || "Nu exista rezervari active sau viitoare.",
    warnings: baseWarnings,
    conflicts: [],
    blockingIntervals: []
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

function toBlockingInterval(conflict: LocationSelectionConflict): LocationSelectionBlockingInterval {
  return {
    status: conflict.status,
    start: conflict.periodStart,
    end: conflict.periodEnd
  };
}

function conflictExplanation(intervals: LocationSelectionBlockingInterval[]) {
  const first = intervals[0];
  if (!first) return "Exista conflict in perioada selectata.";
  return `Ocupat in perioada ${formatDate(first.start)} - ${formatDate(first.end)}.`;
}

function isGenericAvailableNote(value: string) {
  return /^Nota disponibilitate:\s*disponibil\.?$/i.test(value.trim());
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

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}
