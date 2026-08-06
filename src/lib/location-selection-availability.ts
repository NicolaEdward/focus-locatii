import { hasGlobalDataAccess } from "@/lib/rbac";
import type { AuthSession } from "@/lib/auth";
import { summarizeAvailabilityTimeline, type AvailabilityDecision } from "@/lib/availability";
import { loadAvailabilityDecisions, type AvailabilityReservationRow } from "@/lib/availability-service";
import {
  isManualAvailabilityStatus,
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
  lifecycleStatus: "ACTIVE" | "INACTIVE" | "ARCHIVED" | "MAINTENANCE";
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
  const referenceDate = periodStart || periodEnd || startOfUtcDay(new Date());
  const batch = await loadAvailabilityDecisions({
    locationIds,
    periodStart,
    periodEnd,
    referenceDate
  });

  return Object.fromEntries([...batch.locationsById.values()].map((location) => {
    const decision = batch.decisionsByLocationId[location.id];
    const conflicts = decisionConflicts(location.id, decision, batch.reservationsById, input.session);
    if (!periodEnd) {
      if (decision.lifecycleReason) return [location.id, lifecycleUnavailable(location)];
      if (decision.status === "UNKNOWN") return [location.id, unknownAvailability(location, "Perioada selectata nu este valida.")];
      return [location.id, buildNoPeriodAvailability(location, conflicts, referenceDate, decision)];
    }
    return [location.id, buildAvailability({ location, conflicts, decision })];
  }));
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
  decision: AvailabilityDecision;
}): LocationSelectionAvailability {
  if (input.decision.lifecycleReason) return lifecycleUnavailable(input.location);
  if (input.decision.status === "UNKNOWN") {
    return unknownAvailability(input.location, "Perioada selectata nu este valida.");
  }
  const baseWarnings = locationWarnings(input.location);
  const blockingIntervals = input.conflicts.map(toBlockingInterval);
  if (input.decision.status === "PARTIAL") {
    const coverage: SelectedPeriodCoverage = {
      mergedIntervals: blockingIntervals,
      availableSegments: input.decision.availableWindows.map((window) => ({ start: window.from, end: window.to })),
      coversEntirePeriod: false
    };
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
      availableFrom: firstAvailable?.start.toISOString(),
      availableUntil: firstAvailable?.end.toISOString()
    };
  }

  if (input.decision.status === "CONFLICT" || input.decision.status === "BLOCKED") {
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

function lifecycleUnavailable(location: AvailabilityLocation): LocationSelectionAvailability {
  const maintenance = location.lifecycleStatus === "MAINTENANCE";
  const label = maintenance ? "Mentenanta" : "Locatie inactiva";
  const explanation = maintenance
    ? "Locatia este in mentenanta si nu poate fi propusa momentan."
    : "Locatia nu este activa in inventarul comercial.";
  return {
    locationId: location.id,
    state: "CONFLICT",
    label,
    tone: "red",
    explanation,
    warnings: [explanation],
    conflicts: [],
    blockingIntervals: []
  };
}

function buildNoPeriodAvailability(
  location: AvailabilityLocation,
  futureConflicts: LocationSelectionConflict[],
  referenceDate: Date,
  decision: AvailabilityDecision
): LocationSelectionAvailability {
  const intervals = futureConflicts.map(toBlockingInterval);
  const timeline = summarizeAvailabilityTimeline(decision, referenceDate);
  const current = timeline.activeInterval;
  const next = timeline.nextInterval;
  const baseWarnings = locationWarnings(location).filter((warning) => !isGenericAvailableNote(warning));

  if (current) {
    if (current.openEnded || isManualAvailabilityStatus(current.status)) {
      const label = manualAvailabilityStatusLabel(current.status);
      const explanation = current.openEnded
        ? `Blocat din ${formatDate(current.from)}.`
        : `Blocat la data verificata: ${formatDate(current.from)} - ${formatDate(current.to)}.`;
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
    const occupiedUntil = timeline.activeUntil || current.to;
    const availableFrom = timeline.availableFrom?.toISOString() || null;
    const availableUntil = timeline.availableUntil?.toISOString() || null;
    const action = reservationIntervalAction(current.status);
    const remaining = reservationHoldRemainingSuffix({
      status: current.status,
      holdExpiresAt: current.holdExpiresAt?.toISOString() || null
    });
    const availableWindow = timeline.availableDays && availableFrom && availableUntil
      ? ` Disponibil ${timeline.availableDays} ${timeline.availableDays === 1 ? "zi" : "zile"}, intre ${formatDate(availableFrom)} si ${formatDate(availableUntil)}.`
      : "";
    const nextOccupation = next
      ? ` Urmatoarea ocupare incepe la ${formatDate(next.from)} si se termina la ${formatDate(next.to)}.`
      : "";
    return {
      locationId: location.id,
      state: "CONFLICT",
      label: `${action} pana la ${formatDate(occupiedUntil)}`,
      tone: "red",
      explanation: `${action} la data verificata: ${formatDate(current.from)} - ${formatDate(occupiedUntil)}${remaining}.${availableWindow}${nextOccupation}`,
      warnings: [
        `${action} pana la ${formatDate(occupiedUntil)}${remaining}.`,
        ...(availableWindow ? [availableWindow.trim()] : []),
        ...baseWarnings
      ],
      conflicts: futureConflicts,
      blockingIntervals: intervals,
      availableFrom,
      availableUntil
    };
  }

  if (next && timeline.availableUntil) {
    const availableUntil = timeline.availableUntil.toISOString();
    const hasMultipleFuture = futureConflicts.length > 1;
    const daysText = timeline.availableDays
      ? ` Disponibila ${timeline.availableDays} ${timeline.availableDays === 1 ? "zi" : "zile"}.`
      : "";
    return {
      locationId: location.id,
      state: "AVAILABLE",
      label: `Disponibil pana la ${formatDate(availableUntil)}`,
      tone: "yellow",
      explanation: `${daysText} Urmatoarea ocupare incepe la ${formatDate(next.from)} si se termina la ${formatDate(next.to)}.`.trim(),
      warnings: [
        hasMultipleFuture ? `Exista ${futureConflicts.length} rezervari viitoare.` : `Rezervare viitoare din ${formatDate(next.from)}.`,
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

function decisionConflicts(
  locationId: string,
  decision: AvailabilityDecision,
  reservationsById: Map<string, AvailabilityReservationRow>,
  session: AuthSession
): LocationSelectionConflict[] {
  return decision.conflictingIntervals.map((interval, index) => {
    if (interval.source === "RESERVATION" && interval.sourceId) {
      const reservation = reservationsById.get(interval.sourceId);
      if (reservation) return serializeConflict(reservation, session);
    }
    return {
      reservationId: interval.sourceId || `${interval.source.toLowerCase()}:${index}`,
      locationId,
      status: interval.status,
      periodStart: interval.from.toISOString(),
      periodEnd: interval.to.toISOString(),
      holdExpiresAt: interval.holdExpiresAt?.toISOString() || null,
      clientName: null,
      campaignName: interval.reason,
      sellerName: null,
      openEnded: interval.openEnded
    };
  });
}

function serializeConflict(
  reservation: AvailabilityReservationRow,
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
    holdExpiresAt: reservation.holdExpiresAt?.toISOString() || null,
    clientName: canSeeDetails ? reservation.client?.companyName || reservation.clientName : null,
    campaignName: canSeeDetails ? reservation.campaign?.campaignName || reservation.campaignName : null,
    sellerName: canSeeDetails ? reservation.sellerUser?.name || reservation.salesperson : null
  };
}

function locationWarnings(location: AvailabilityLocation) {
  const warnings: string[] = [];
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
    holdExpiresAt: conflict.holdExpiresAt,
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
  const action = reservationIntervalAction(first.status);
  const remaining = reservationHoldRemainingSuffix(first);
  return first.openEnded
    ? `${action} din ${formatDate(first.start)}${remaining}.`
    : `${action} in perioada ${formatDate(first.start)} - ${formatDate(first.end)}${remaining}.`;
}

function partialExplanation(coverage: SelectedPeriodCoverage) {
  const blockedText = coverage.mergedIntervals.length
    ? coverage.mergedIntervals
        .map((interval) => {
          const action = reservationIntervalAction(interval.status);
          return `${action}: ${formatDate(interval.start)} - ${formatDate(interval.end)}${reservationHoldRemainingSuffix(interval)}`;
        })
        .join("; ")
    : "Ocuparea necesita verificare";
  const availableText = coverage.availableSegments.length
    ? coverage.availableSegments
        .map((interval) => `${formatDate(interval.start)} - ${formatDate(interval.end)}`)
        .join("; ")
    : "fara interval disponibil";
  return `${blockedText}. Disponibil: ${availableText}.`;
}

type SelectedPeriodCoverage = {
  mergedIntervals: LocationSelectionBlockingInterval[];
  availableSegments: Array<{ start: Date; end: Date }>;
  coversEntirePeriod: boolean;
};

function reservationIntervalAction(status: string) {
  if (status === "HOLD" || status === "RESERVED") return "Rezervat";
  return "Ocupat";
}

function reservationHoldRemainingSuffix(interval: Pick<LocationSelectionBlockingInterval, "status" | "holdExpiresAt">) {
  if (interval.status !== "HOLD" && interval.status !== "RESERVED") return "";
  if (!interval.holdExpiresAt) return "";
  const days = Math.ceil((new Date(interval.holdExpiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return " (expira astazi)";
  return ` (mai are ${days} ${days === 1 ? "zi" : "zile"})`;
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

function groupByLocationId<T extends { locationId: string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const current = grouped.get(row.locationId) || [];
    current.push(row);
    grouped.set(row.locationId, current);
  }
  return grouped;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}
