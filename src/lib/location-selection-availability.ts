import type { ReservationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasGlobalDataAccess } from "@/lib/rbac";
import type { AuthSession } from "@/lib/auth";
import {
  isManualAvailabilityStatus,
  legacyManualBlockConflict,
  listLocationAvailabilityOverrideConflicts,
  manualAvailabilityStatusLabel
} from "@/lib/location-availability-overrides";
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
    const referenceDate = periodStart || periodEnd || startOfUtcDay(new Date());
    const [futureReservations, overrideConflicts] = await Promise.all([
      prisma.reservation.findMany({
        where: {
          locationId: { in: locationIds },
          status: { in: [...LOCATION_SELECTION_BLOCKING_STATUSES] as ReservationStatus[] },
          periodEnd: { gte: referenceDate }
        },
        include: {
          client: { select: { companyName: true } },
          campaign: { select: { campaignName: true } },
          sellerUser: { select: { name: true } }
        },
        orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }]
      }),
      listLocationAvailabilityOverrideConflicts({
        locationIds,
        referenceDate,
        session: input.session
      })
    ]);

    return Object.fromEntries(
      locations.map((location) => {
        const reservationConflicts = futureReservations
          .filter((reservation) => reservation.locationId === location.id)
          .map((reservation) => serializeConflict(reservation, input.session));
        const legacyBlock = legacyManualBlockConflict(location, { referenceDate });
        const intervals = [
          ...reservationConflicts,
          ...overrideConflicts.filter((conflict) => conflict.locationId === location.id),
          ...(legacyBlock ? [legacyBlock] : [])
        ].sort(compareConflicts);
        return [location.id, buildNoPeriodAvailability(location, intervals, referenceDate)];
      })
    );
  }

  if (periodStart > periodEnd) {
    return Object.fromEntries(locations.map((location) => [location.id, unknownAvailability(location, "Perioada selectata nu este valida.")]));
  }

  const [conflicts, overrideConflicts] = await Promise.all([
    prisma.reservation.findMany({
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
    }),
    listLocationAvailabilityOverrideConflicts({
      locationIds,
      periodStart,
      periodEnd,
      session: input.session
    })
  ]);

  return Object.fromEntries(
    locations.map((location) => {
      const reservationConflicts = conflicts
        .filter((conflict) => conflict.locationId === location.id)
        .map((conflict) => serializeConflict(conflict, input.session));
      const legacyBlock = legacyManualBlockConflict(location, { periodStart, periodEnd });
      const locationConflicts = [
        ...reservationConflicts,
        ...overrideConflicts.filter((conflict) => conflict.locationId === location.id),
        ...(legacyBlock ? [legacyBlock] : [])
      ].sort(compareConflicts);
      return [
        location.id,
        buildAvailability({
          location,
          conflicts: locationConflicts,
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
  const baseWarnings = locationWarnings(input.location);
  if (input.conflicts.length) {
    const blockingIntervals = input.conflicts.map(toBlockingInterval);
    const coverage = selectedPeriodCoverage(blockingIntervals, input.periodStart, input.periodEnd);
    if (!coverage.coversEntirePeriod && coverage.availableSegments.length) {
      const explanation = partialExplanation(coverage);
      const firstAvailable = coverage.availableSegments[0];
      return {
        locationId: input.location.id,
        state: "PARTIAL",
        label: "Disponibil partial",
        tone: "yellow",
        explanation,
        warnings: [explanation, ...baseWarnings.filter((warning) => !isGenericAvailableNote(warning))],
        conflicts: input.conflicts,
        blockingIntervals,
        availableFrom: firstAvailable.start.toISOString(),
        availableUntil: firstAvailable.end.toISOString()
      };
    }

    const explanation = conflictExplanation(coverage.mergedIntervals.length ? coverage.mergedIntervals : blockingIntervals);
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
  referenceDate: Date
): LocationSelectionAvailability {
  const intervals = futureConflicts.map(toBlockingInterval);
  const current = futureConflicts.find((conflict) => new Date(conflict.periodStart) <= referenceDate && new Date(conflict.periodEnd) >= referenceDate);
  const next = futureConflicts.find((conflict) => new Date(conflict.periodStart) > referenceDate);
  const baseWarnings = locationWarnings(location).filter((warning) => !isGenericAvailableNote(warning));

  if (current) {
    if (current.openEnded || isManualAvailabilityStatus(current.status)) {
      const label = manualAvailabilityStatusLabel(current.status);
      const explanation = current.openEnded
        ? `Blocat din ${formatDate(current.periodStart)}.`
        : `Blocat la data verificata: ${formatDate(current.periodStart)} - ${formatDate(current.periodEnd)}.`;
      return {
        locationId: location.id,
        state: "CONFLICT",
        label,
        tone: "red",
        explanation,
        warnings: [explanation, ...baseWarnings],
        conflicts: futureConflicts,
        blockingIntervals: intervals
      };
    }
    const availableFrom = addDays(new Date(current.periodEnd), 1).toISOString();
    const label = `Disponibil din ${formatDate(availableFrom)}`;
    return {
      locationId: location.id,
      state: "CONFLICT",
      label,
      tone: "red",
      explanation: `Ocupat la data verificata: ${formatDate(current.periodStart)} - ${formatDate(current.periodEnd)}.`,
      warnings: [`Ocupat pana la ${formatDate(current.periodEnd)}.`, ...baseWarnings],
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

function locationWarnings(location: AvailabilityLocation) {
  const warnings: string[] = [];
  if (!["AVAILABLE", "AVAILABLE_FROM"].includes(location.status)) {
    warnings.push(`Status inventar: ${location.status}. Verifica disponibilitatea comerciala.`);
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
    end: conflict.periodEnd,
    openEnded: conflict.openEnded
  };
}

function conflictExplanation(intervals: LocationSelectionBlockingInterval[]) {
  const first = intervals[0];
  if (!first) return "Exista conflict in perioada selectata.";
  if (isManualAvailabilityStatus(first.status)) {
    return first.openEnded
      ? `Blocat din ${formatDate(first.start)}.`
      : `Blocat in perioada ${formatDate(first.start)} - ${formatDate(first.end)}.`;
  }
  return first.openEnded
    ? `Ocupat din ${formatDate(first.start)}.`
    : `Ocupat in perioada ${formatDate(first.start)} - ${formatDate(first.end)}.`;
}

function partialExplanation(coverage: SelectedPeriodCoverage) {
  const firstBlocked = coverage.mergedIntervals[0];
  const firstAvailable = coverage.availableSegments[0];
  const blockedAction = firstBlocked && isManualAvailabilityStatus(firstBlocked.status) ? "Blocat" : "Ocupat";
  const blockedLabel = firstBlocked ? manualAvailabilityStatusLabel(firstBlocked.status) : null;
  const blockedText = firstBlocked
    ? coverage.mergedIntervals.length > 1
      ? `${blockedAction} in ${coverage.mergedIntervals.length} intervale; primul: ${formatDate(firstBlocked.start)} - ${formatDate(firstBlocked.end)}.`
      : `${blockedAction} ${formatDate(firstBlocked.start)} - ${formatDate(firstBlocked.end)}${blockedLabel ? ` (${blockedLabel})` : ""}.`
    : "Exista ocupare partiala.";
  const availableText = firstAvailable
    ? coverage.availableSegments.length > 1
      ? `Primul interval disponibil: ${formatDate(firstAvailable.start)} - ${formatDate(firstAvailable.end)}.`
      : `Disponibil ${formatDate(firstAvailable.start)} - ${formatDate(firstAvailable.end)}.`
    : "Verifica intervalele disponibile.";
  return `${blockedText} ${availableText}`;
}

type SelectedPeriodCoverage = {
  mergedIntervals: LocationSelectionBlockingInterval[];
  availableSegments: Array<{ start: Date; end: Date }>;
  coversEntirePeriod: boolean;
};

function selectedPeriodCoverage(
  intervals: LocationSelectionBlockingInterval[],
  periodStart: Date,
  periodEnd: Date
): SelectedPeriodCoverage {
  const clamped = intervals
    .map((interval) => ({
      status: interval.status,
      start: maxDate(new Date(interval.start), periodStart),
      end: minDate(new Date(interval.end), periodEnd),
      openEnded: interval.openEnded
    }))
    .filter((interval) => interval.start <= interval.end)
    .sort((left, right) => left.start.getTime() - right.start.getTime() || left.end.getTime() - right.end.getTime());

  const merged: Array<{ status: string; start: Date; end: Date; openEnded?: boolean }> = [];
  for (const interval of clamped) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > addDays(last.end, 1)) {
      merged.push({ ...interval });
      continue;
    }
    if (interval.end > last.end) last.end = interval.end;
    last.openEnded = Boolean(last.openEnded || interval.openEnded);
  }

  const availableSegments: Array<{ start: Date; end: Date }> = [];
  let cursor = periodStart;
  for (const interval of merged) {
    if (cursor < interval.start) {
      availableSegments.push({ start: cursor, end: addDays(interval.start, -1) });
    }
    const nextCursor = addDays(interval.end, 1);
    if (nextCursor > cursor) cursor = nextCursor;
  }
  if (cursor <= periodEnd) {
    availableSegments.push({ start: cursor, end: periodEnd });
  }

  const coversEntirePeriod =
    merged.length === 1 &&
    merged[0].start <= periodStart &&
    merged[0].end >= periodEnd;

  return {
    mergedIntervals: merged.map((interval) => ({
      status: interval.status,
      start: interval.start.toISOString(),
      end: interval.end.toISOString(),
      openEnded: interval.openEnded
    })),
    availableSegments,
    coversEntirePeriod
  };
}

function isGenericAvailableNote(value: string) {
  return /^Nota disponibilitate:\s*disponibil\.?$/i.test(value.trim());
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

function maxDate(left: Date, right: Date) {
  return left > right ? left : right;
}

function minDate(left: Date, right: Date) {
  return left < right ? left : right;
}

function compareConflicts(left: LocationSelectionConflict, right: LocationSelectionConflict) {
  return new Date(left.periodStart).getTime() - new Date(right.periodStart).getTime() || new Date(left.periodEnd).getTime() - new Date(right.periodEnd).getTime();
}

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}
