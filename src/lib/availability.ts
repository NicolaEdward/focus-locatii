import { effectiveHoldExpiresAt, isEffectiveBlockingReservation } from "@/lib/reservation-lifecycle-domain";

export type PublicAvailabilityStatus = "AVAILABLE" | "BOOKED" | "RESERVED" | "UNKNOWN";

export type AvailabilityInput = {
  status?: string | null;
  availabilityText?: string | null;
  availableFrom?: Date | string | null;
  availableUntil?: Date | string | null;
  bookedFrom?: Date | string | null;
  bookedUntil?: Date | string | null;
  blockedReason?: string | null;
  blockedFrom?: Date | string | null;
  blockedUntil?: Date | string | null;
  lifecycleStatus?: string | null;
  availabilityOverrides?: Array<{
    id?: string | null;
    type?: string | null;
    reason?: string | null;
    periodStart?: Date | string | null;
    periodEnd?: Date | string | null;
    clearedAt?: Date | string | null;
  }>;
  reservations?: Array<{
    id?: string | null;
    status?: string | null;
    periodStart?: Date | string | null;
    periodEnd?: Date | string | null;
    holdExpiresAt?: Date | string | null;
    createdAt?: Date | string | null;
  }>;
};

export type AvailabilityDecisionStatus = "AVAILABLE" | "PARTIAL" | "CONFLICT" | "BLOCKED" | "UNKNOWN";

export type AvailabilityReasonCode =
  | "AVAILABLE_NO_BLOCKERS"
  | "INVALID_PERIOD"
  | "LOCATION_INACTIVE"
  | "LOCATION_ARCHIVED"
  | "LOCATION_MAINTENANCE"
  | "RESERVATION_BOOKED"
  | "RESERVATION_HOLD"
  | "OVERRIDE_COMMERCIAL_BLOCK"
  | "OVERRIDE_MAINTENANCE"
  | "OVERRIDE_INTERNAL_HOLD"
  | "LEGACY_MANUAL_BLOCK"
  | "LEGACY_AVAILABILITY_WINDOW";

export type AvailabilityReason = {
  code: AvailabilityReasonCode;
  sourceId?: string | null;
};

export type AvailabilityConflictInterval = {
  source: "RESERVATION" | "OVERRIDE" | "LEGACY_BLOCK" | "LEGACY_AVAILABILITY";
  sourceId: string | null;
  status: string;
  from: Date;
  to: Date;
  reason: string | null;
  holdExpiresAt: Date | null;
  openEnded: boolean;
};

export type AvailabilityDecision = {
  status: AvailabilityDecisionStatus;
  isBookable: boolean;
  reasons: AvailabilityReason[];
  conflictingIntervals: AvailabilityConflictInterval[];
  availableWindows: AvailabilityWindow[];
  activeOverride: AvailabilityConflictInterval | null;
  lifecycleReason: AvailabilityReasonCode | null;
  effectiveHoldExpiry: Date | null;
  dateSemantics: "INCLUSIVE_WITH_SAME_DAY_HANDOFF";
  periodStart: Date | null;
  periodEnd: Date | null;
};

const FAR_FUTURE_DATE = new Date("2099-12-31T00:00:00.000Z");

type AvailabilityDecisionInput = AvailabilityInput & {
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
  referenceDate?: Date | string | null;
  ignoreReservationId?: string | null;
  now?: Date;
};

export type PublicAvailability = {
  publicStatus: PublicAvailabilityStatus;
  label: string;
  detail: string | null;
};

export type AvailabilityTimelineSummary = {
  activeInterval: AvailabilityConflictInterval | null;
  activeUntil: Date | null;
  nextInterval: AvailabilityConflictInterval | null;
  availableFrom: Date | null;
  availableUntil: Date | null;
  availableDays: number | null;
};

export type AvailabilityWindowStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "SUSPENDED";

export type AvailabilityWindow = {
  from: Date;
  to: Date;
  labelFrom: Date;
  labelTo: Date;
};

export type CalculatedAvailability = {
  status: AvailabilityWindowStatus;
  publicStatus: PublicAvailabilityStatus;
  label: string;
  detail: string | null;
  windows: AvailabilityWindow[];
};

export function decideAvailability(input: AvailabilityDecisionInput): AvailabilityDecision {
  const now = input.now || new Date();
  const periodStart = toDate(input.periodStart || input.referenceDate) || startOfDay(now);
  const periodEnd = toDate(input.periodEnd);
  if (periodEnd && periodStart > periodEnd) {
    return decision({
      status: "UNKNOWN",
      isBookable: false,
      reasons: [{ code: "INVALID_PERIOD" }],
      periodStart,
      periodEnd
    });
  }

  const lifecycleReason = lifecycleReasonCode(input.lifecycleStatus);
  if (lifecycleReason) {
    return decision({
      status: "BLOCKED",
      isBookable: false,
      reasons: [{ code: lifecycleReason }],
      lifecycleReason,
      periodStart,
      periodEnd
    });
  }

  const rangeEnd = periodEnd || FAR_FUTURE_DATE;
  const conflictingIntervals = canonicalBlockingIntervals(input, periodStart, rangeEnd, now)
    .filter((interval) => periodEnd
      ? availabilityIntervalConflicts(interval, periodStart, periodEnd)
      : interval.to >= periodStart)
    .sort(compareCanonicalIntervals);
  const decisionIntervals = periodEnd
    ? conflictingIntervals
    : conflictingIntervals.filter((interval) => interval.from <= periodStart && interval.to >= periodStart);
  const activeOverride = decisionIntervals.find((interval) =>
    interval.source === "OVERRIDE" &&
    (periodEnd ? interval.from <= periodEnd && interval.to >= periodStart : interval.from <= periodStart && interval.to >= periodStart)
  ) || null;
  const effectiveHoldExpiry = decisionIntervals
    .map((interval) => interval.holdExpiresAt)
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => a.getTime() - b.getTime())[0] || null;
  const reasons = uniqueReasons(decisionIntervals.map(intervalReason));

  if (!periodEnd) {
    const blocking = [...decisionIntervals].sort(compareTimelineIntervals)[0] || null;
    const blocked = Boolean(blocking);
    return decision({
      status: blocked ? (blocking?.source === "RESERVATION" ? "CONFLICT" : "BLOCKED") : "AVAILABLE",
      isBookable: !blocked,
      reasons: reasons.length ? reasons : [{ code: "AVAILABLE_NO_BLOCKERS" }],
      conflictingIntervals,
      activeOverride,
      effectiveHoldExpiry,
      periodStart,
      periodEnd: null,
      availableWindows: blocked ? [] : [{ from: periodStart, to: rangeEnd, labelFrom: periodStart, labelTo: rangeEnd }]
    });
  }

  const occupied = mergeCoverageIntervals(conflictingIntervals.map((interval) => ({
    from: maxDate(interval.from, periodStart),
    to: minDate(interval.to, periodEnd),
    status: interval.status
  })));
  const available = availableWindows(periodStart, periodEnd, occupied);
  if (!occupied.length) {
    return decision({
      status: "AVAILABLE",
      isBookable: true,
      reasons: [{ code: "AVAILABLE_NO_BLOCKERS" }],
      conflictingIntervals,
      activeOverride,
      effectiveHoldExpiry,
      periodStart,
      periodEnd,
      availableWindows: [{ from: periodStart, to: periodEnd, labelFrom: periodStart, labelTo: periodEnd }]
    });
  }

  const hasManualBlock = conflictingIntervals.some((interval) =>
    isManualBlockingStatus(interval.status)
  );
  if (hasManualBlock) {
    return decision({
      status: "BLOCKED",
      isBookable: false,
      reasons,
      conflictingIntervals,
      activeOverride,
      effectiveHoldExpiry,
      periodStart,
      periodEnd,
      availableWindows: []
    });
  }

  if (available.length) {
    return decision({
      status: "PARTIAL",
      isBookable: false,
      reasons,
      conflictingIntervals,
      activeOverride,
      effectiveHoldExpiry,
      periodStart,
      periodEnd,
      availableWindows: available
    });
  }

  const fullyBlockedByManualRule = occupied.every((interval) => isManualBlockingStatus(interval.status));
  return decision({
    status: fullyBlockedByManualRule ? "BLOCKED" : "CONFLICT",
    isBookable: false,
    reasons,
    conflictingIntervals,
    activeOverride,
    effectiveHoldExpiry,
    periodStart,
    periodEnd,
    availableWindows: []
  });
}

export function publicAvailabilityExplanation(decisionValue: AvailabilityDecision) {
  if (decisionValue.lifecycleReason === "LOCATION_MAINTENANCE") return "Locatie temporar indisponibila";
  if (decisionValue.lifecycleReason) return "Locatie indisponibila";
  if (decisionValue.status === "BLOCKED") return "Temporar indisponibila";
  if (decisionValue.status === "CONFLICT") return "Ocupata in perioada verificata";
  if (decisionValue.status === "PARTIAL") return "Disponibilitate partiala";
  if (decisionValue.status === "UNKNOWN") return "Disponibilitate de verificat";
  return "Disponibila";
}

export function adminAvailabilityExplanation(decisionValue: AvailabilityDecision) {
  if (decisionValue.lifecycleReason === "LOCATION_MAINTENANCE") return "Locatia este in mentenanta.";
  if (decisionValue.lifecycleReason === "LOCATION_INACTIVE") return "Locatia este inactiva.";
  if (decisionValue.lifecycleReason === "LOCATION_ARCHIVED") return "Locatia este arhivata.";
  if (!decisionValue.periodEnd && decisionValue.periodStart) {
    const timeline = summarizeAvailabilityTimeline(decisionValue, decisionValue.periodStart);
    if (timeline.activeInterval && timeline.activeUntil) {
      const action = timeline.activeInterval.source === "RESERVATION"
        ? timeline.activeInterval.status === "BOOKED" ? "Ocupata" : "Rezervata"
        : timeline.activeInterval.status === "MAINTENANCE" ? "In mentenanta" : "Blocata comercial";
      return `${action} pana la ${formatDate(timeline.activeUntil)}.`;
    }
    if (timeline.nextInterval && timeline.availableUntil) {
      return `Disponibila pana la ${formatDate(timeline.availableUntil)}. Urmatoarea ocupare: ${formatDate(timeline.nextInterval.from)} - ${formatDate(timeline.nextInterval.to)}.`;
    }
  }
  const first = decisionValue.conflictingIntervals[0];
  if (!first) return decisionValue.status === "UNKNOWN" ? "Perioada nu este valida." : "Disponibila in perioada selectata.";
  const action = first.source === "RESERVATION"
    ? first.status === "BOOKED" ? "Ocupata" : "Rezervata"
    : first.status === "MAINTENANCE" ? "In mentenanta" : "Blocata comercial";
  return `${action}: ${formatDate(first.from)} - ${formatDate(first.to)}.`;
}

export function publicAvailability(input: AvailabilityInput, now = new Date()): PublicAvailability {
  const status = String(input.status || "UNKNOWN").toUpperCase();
  const availabilityText = cleanText(input.availabilityText);
  const availableFrom = toDate(input.availableFrom);
  const availableUntil = toDate(input.availableUntil);
  const bookedFrom = toDate(input.bookedFrom);
  const bookedUntil = toDate(input.bookedUntil);
  const today = startOfDay(now);
  const decisionValue = decideAvailability({ ...input, referenceDate: today, now });
  if (decisionValue.lifecycleReason || decisionValue.status === "BLOCKED") {
    return {
      publicStatus: "UNKNOWN",
      label: publicAvailabilityExplanation(decisionValue),
      detail: null
    };
  }
  const timeline = summarizeAvailabilityTimeline(decisionValue, today);

  if (timeline.activeInterval && timeline.activeUntil) {
    const activeStatus = timeline.activeInterval.status === "RESERVED" || timeline.activeInterval.status === "HOLD" ? "RESERVED" : "BOOKED";
    const nextAvailable = timeline.availableFrom;
    const boundedWindow = availabilityGapLabel(timeline);
    return {
      publicStatus: activeStatus,
      label: `${activeStatus === "RESERVED" ? "Rezervat" : "Inchiriat"} pana la ${formatDate(timeline.activeUntil)}`,
      detail: boundedWindow || (timeline.nextInterval
        ? bookingWindowLabel(timeline.nextInterval.status, timeline.nextInterval.from, timeline.nextInterval.to)
        : nextAvailable
          ? activeStatus === "BOOKED"
            ? `Disponibil pentru changeover din ${formatDate(nextAvailable)}`
            : `Disponibil din ${formatDate(nextAvailable)}`
          : null)
    };
  }

  if (timeline.nextInterval && timeline.availableUntil) {
    const boundedWindow = availabilityGapLabel(timeline);
    return {
      publicStatus: "AVAILABLE",
      label: `Disponibil pana la ${formatDate(timeline.availableUntil)}`,
      detail: boundedWindow || bookingWindowLabel(timeline.nextInterval.status, timeline.nextInterval.from, timeline.nextInterval.to)
    };
  }

  if (status === "UNKNOWN" && decisionValue.status === "AVAILABLE") {
    return {
      publicStatus: "AVAILABLE",
      label: "Disponibil",
      detail: availabilityText && availabilityText.toLocaleLowerCase("ro-RO") !== "disponibil"
        ? availabilityText
        : null
    };
  }

  if ((status === "BOOKED" || status === "RESERVED") && bookedFrom && bookedFrom > today) {
    const until = availableUntil || addDays(bookedFrom, -1);
    return {
      publicStatus: "AVAILABLE",
      label: until ? `Disponibil pana la ${formatDate(until)}` : "Disponibil momentan",
      detail: bookingWindowLabel(status, bookedFrom, bookedUntil)
    };
  }

  if (status === "BOOKED" || status === "RESERVED") {
    if (bookedUntil && bookedUntil < today) {
      return {
        publicStatus: "AVAILABLE",
        label: availableUntil ? `Disponibil pana la ${formatDate(availableUntil)}` : "Disponibil",
        detail: `Ultima ocupare pana la ${formatDate(bookedUntil)}`
      };
    }

    const nextAvailable = availableFrom || (bookedUntil ? addDays(bookedUntil, 1) : null);
    return {
      publicStatus: status === "RESERVED" ? "RESERVED" : "BOOKED",
      label: bookedUntil ? `${status === "RESERVED" ? "Rezervat" : "Inchiriat"} pana la ${formatDate(bookedUntil)}` : status === "RESERVED" ? "Rezervat" : "Inchiriat",
      detail: nextAvailable ? `Disponibil din ${formatDate(nextAvailable)}` : availabilityText
    };
  }

  if (status === "AVAILABLE_FROM") {
    const nextAvailable = availableFrom || parseDateFromText(availabilityText);
    return {
      publicStatus: "BOOKED",
      label: nextAvailable ? `Inchiriat pana la ${formatDate(addDays(nextAvailable, -1))}` : "Inchiriat",
      detail: nextAvailable ? `Disponibil din ${formatDate(nextAvailable)}` : availabilityText
    };
  }

  if (status === "AVAILABLE") {
    return {
      publicStatus: "AVAILABLE",
      label: availableUntil ? `Disponibil pana la ${formatDate(availableUntil)}` : "Disponibil",
      detail: bookedFrom && bookedFrom > today ? bookingWindowLabel("BOOKED", bookedFrom, bookedUntil) : null
    };
  }

  return {
    publicStatus: "UNKNOWN",
    label: availabilityText || "De verificat",
    detail: null
  };
}

export function calculateAvailability(
  input: AvailabilityInput,
  requestedStartDate?: Date | string | null,
  requestedEndDate?: Date | string | null
): CalculatedAvailability {
  const from = toDate(requestedStartDate) || startOfDay(new Date());
  const to = toDate(requestedEndDate) || from;
  const decisionValue = decideAvailability({ ...input, periodStart: from, periodEnd: to });

  if (decisionValue.lifecycleReason || decisionValue.status === "UNKNOWN") {
    const label = decisionValue.lifecycleReason === "LOCATION_MAINTENANCE"
      ? "In mentenanta"
      : decisionValue.lifecycleReason ? "Locatie inactiva" : publicAvailabilityExplanation(decisionValue);
    return {
      status: "SUSPENDED",
      publicStatus: "UNKNOWN",
      label,
      detail: null,
      windows: []
    };
  }

  if (decisionValue.status === "CONFLICT" || decisionValue.status === "BLOCKED") {
    const first = decisionValue.conflictingIntervals[0];
    return {
      status: "UNAVAILABLE",
      publicStatus: first?.status === "RESERVED" || first?.status === "HOLD" ? "RESERVED" : "BOOKED",
      label: decisionValue.status === "BLOCKED" ? "Temporar indisponibila in perioada selectata" : "Ocupata in perioada selectata",
      detail: first ? bookingWindowLabel(first.status, first.from, first.to) : null,
      windows: []
    };
  }

  const label = availabilityWindowLabel(decisionValue.availableWindows, from, to);
  return {
    status: decisionValue.status === "PARTIAL" ? "PARTIAL" : "AVAILABLE",
    publicStatus: "AVAILABLE",
    label,
    detail: decisionValue.status === "PARTIAL" ? "Disponibilitate partiala in perioada selectata" : null,
    windows: decisionValue.availableWindows
  };
}

export function formatAvailability(input: Pick<PublicAvailability, "label" | "detail">) {
  return input.detail ? `${input.label} | ${input.detail}` : input.label;
}

function bookingWindowLabel(status: string, from: Date | null, until: Date | null) {
  const label = isManualBlockingStatus(status)
    ? "Indisponibil temporar"
    : status === "RESERVED" || status === "HOLD" ? "Rezervat" : "Inchiriat";
  if (from && until) return `${label} intre ${formatDate(from)} si ${formatDate(until)}`;
  if (from) return `${label} din ${formatDate(from)}`;
  if (until) return `${label} pana la ${formatDate(until)}`;
  return label;
}

function availabilityGapLabel(timeline: AvailabilityTimelineSummary) {
  if (
    !timeline.nextInterval ||
    !timeline.availableFrom ||
    !timeline.availableUntil ||
    !timeline.availableDays
  ) {
    return null;
  }
  const daysLabel = `${timeline.availableDays} ${timeline.availableDays === 1 ? "zi" : "zile"}`;
  return `Disponibil ${daysLabel}, intre ${formatDate(timeline.availableFrom)} si ${formatDate(timeline.availableUntil)}. ${bookingWindowLabel(
    timeline.nextInterval.status,
    timeline.nextInterval.from,
    timeline.nextInterval.to
  )}.`;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function cleanText(value?: string | null) {
  const text = String(value || "").trim();
  return text || null;
}

function toDate(value?: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return startOfDay(date);
}

function toInstant(value?: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function canonicalBlockingIntervals(
  input: AvailabilityDecisionInput,
  from: Date,
  to: Date,
  now: Date
): AvailabilityConflictInterval[] {
  const intervals: AvailabilityConflictInterval[] = [];

  for (const reservation of input.reservations || []) {
    if (input.ignoreReservationId && reservation.id === input.ignoreReservationId) continue;
    const periodStart = toDate(reservation.periodStart);
    const periodEnd = toDate(reservation.periodEnd);
    if (!periodStart || !periodEnd || periodStart > periodEnd) continue;
    const createdAt = toInstant(reservation.createdAt) || now;
    const holdExpiresAt = toInstant(reservation.holdExpiresAt);
    const status = String(reservation.status || "").toUpperCase();
    if (!isEffectiveBlockingReservation({ status, holdExpiresAt, createdAt }, now)) continue;
    intervals.push({
      source: "RESERVATION",
      sourceId: reservation.id || null,
      status,
      from: periodStart,
      to: periodEnd,
      reason: null,
      holdExpiresAt: status === "HOLD" || status === "RESERVED"
        ? effectiveHoldExpiresAt({ holdExpiresAt, createdAt })
        : null,
      openEnded: false
    });
  }

  for (const override of input.availabilityOverrides || []) {
    if (toInstant(override.clearedAt)) continue;
    const periodStart = toDate(override.periodStart);
    if (!periodStart) continue;
    const periodEnd = toDate(override.periodEnd) || FAR_FUTURE_DATE;
    intervals.push({
      source: "OVERRIDE",
      sourceId: override.id || null,
      status: String(override.type || "COMMERCIAL_BLOCK").toUpperCase(),
      from: periodStart,
      to: periodEnd,
      reason: cleanText(override.reason),
      holdExpiresAt: null,
      openEnded: !override.periodEnd
    });
  }

  if (cleanText(input.blockedReason)) {
    intervals.push({
      source: "LEGACY_BLOCK",
      sourceId: null,
      status: "COMMERCIAL_BLOCK",
      from: toDate(input.blockedFrom) || from,
      to: toDate(input.blockedUntil) || FAR_FUTURE_DATE,
      reason: cleanText(input.blockedReason),
      holdExpiresAt: null,
      openEnded: !input.blockedUntil
    });
  }

  const legacyStatus = String(input.status || "").toUpperCase();
  const bookedFrom = toDate(input.bookedFrom);
  const bookedUntil = toDate(input.bookedUntil);
  const availableFrom = toDate(input.availableFrom);
  const availableUntil = toDate(input.availableUntil);
  const hasStructuredReservation = intervals.some((interval) => interval.source === "RESERVATION");
  if (!hasStructuredReservation && (legacyStatus === "BOOKED" || legacyStatus === "RESERVED") && bookedUntil) {
    intervals.push(legacyAvailabilityInterval(
      legacyStatus,
      bookedFrom || from,
      bookedUntil
    ));
  } else if (!hasStructuredReservation && legacyStatus === "AVAILABLE_FROM" && availableFrom && availableFrom > from) {
    intervals.push(legacyAvailabilityInterval("BOOKED", from, addDays(availableFrom, -1)));
  }
  if (availableUntil && availableUntil < to) {
    intervals.push(legacyAvailabilityInterval("BOOKED", addDays(availableUntil, 1), to));
  }

  return intervals.filter((interval) => interval.from <= interval.to && interval.from <= to && interval.to >= from);
}

function legacyAvailabilityInterval(status: string, from: Date, to: Date): AvailabilityConflictInterval {
  return {
    source: "LEGACY_AVAILABILITY",
    sourceId: null,
    status,
    from,
    to,
    reason: null,
    holdExpiresAt: null,
    openEnded: false
  };
}

function mergeCoverageIntervals(intervals: Array<{ from: Date; to: Date; status: string }>) {
  const merged: Array<{ from: Date; to: Date; status: string }> = [];

  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.from > addDays(previous.to, 1)) {
      merged.push({ ...interval });
      continue;
    }

    if (interval.to > previous.to) previous.to = interval.to;
    if (statusPriority(interval.status) < statusPriority(previous.status)) previous.status = interval.status;
  }

  return merged;
}

function availableWindows(from: Date, to: Date, occupied: Array<{ from: Date; to: Date; status: string }>): AvailabilityWindow[] {
  const windows: AvailabilityWindow[] = [];
  let cursor = from;

  for (const interval of occupied) {
    if (interval.from > cursor) {
      const windowEnd = allowsSameDayHandoff(interval.status) ? interval.from : addDays(interval.from, -1);
      windows.push({
        from: cursor,
        to: windowEnd,
        labelFrom: cursor,
        labelTo: interval.from
      });
    }
    if (interval.to >= cursor) cursor = allowsSameDayHandoff(interval.status) ? interval.to : addDays(interval.to, 1);
    if (cursor > to) break;
  }

  const cursorIsOccupiedBookedBoundary = occupied.some((interval) =>
    allowsSameDayHandoff(interval.status) &&
    interval.to.getTime() === cursor.getTime()
  );
  if (cursor <= to && (cursor < to || !cursorIsOccupiedBookedBoundary)) {
    const previous = occupied.filter((interval) => interval.to < cursor).at(-1);
    windows.push({
      from: cursor,
      to,
      labelFrom: previous ? previous.to : cursor,
      labelTo: to
    });
  }

  return windows;
}

function availabilityWindowLabel(
  windows: AvailabilityWindow[],
  from: Date,
  to: Date
) {
  if (!windows.length) return "Ocupata in perioada selectata";
  const fullWindow = windows.length === 1 && windows[0].from <= from && windows[0].to >= to;
  if (fullWindow) return "Disponibila";

  const labels = windows.map((window) => {
    if (window.from <= from) return `Disponibila pana la data de ${formatDate(window.to)}`;
    if (window.to >= to) return `Disponibila din data de ${formatDate(window.from)}`;
    return `Disponibila din data de ${formatDate(window.from)} pana la data de ${formatDate(window.to)}`;
  });

  return labels.join("; ");
}

function decision(input: {
  status: AvailabilityDecisionStatus;
  isBookable: boolean;
  reasons: AvailabilityReason[];
  periodStart: Date | null;
  periodEnd: Date | null;
  conflictingIntervals?: AvailabilityConflictInterval[];
  availableWindows?: AvailabilityWindow[];
  activeOverride?: AvailabilityConflictInterval | null;
  lifecycleReason?: AvailabilityReasonCode | null;
  effectiveHoldExpiry?: Date | null;
}): AvailabilityDecision {
  return {
    status: input.status,
    isBookable: input.isBookable,
    reasons: input.reasons,
    conflictingIntervals: input.conflictingIntervals || [],
    availableWindows: input.availableWindows || [],
    activeOverride: input.activeOverride || null,
    lifecycleReason: input.lifecycleReason || null,
    effectiveHoldExpiry: input.effectiveHoldExpiry || null,
    dateSemantics: "INCLUSIVE_WITH_SAME_DAY_HANDOFF",
    periodStart: input.periodStart,
    periodEnd: input.periodEnd
  };
}

function lifecycleReasonCode(value?: string | null): AvailabilityReasonCode | null {
  const status = String(value || "ACTIVE").toUpperCase();
  if (status === "INACTIVE") return "LOCATION_INACTIVE";
  if (status === "ARCHIVED") return "LOCATION_ARCHIVED";
  if (status === "MAINTENANCE") return "LOCATION_MAINTENANCE";
  return null;
}

function intervalReason(interval: AvailabilityConflictInterval): AvailabilityReason {
  if (interval.source === "RESERVATION") {
    return {
      code: interval.status === "BOOKED" ? "RESERVATION_BOOKED" : "RESERVATION_HOLD",
      sourceId: interval.sourceId
    };
  }
  if (interval.source === "LEGACY_BLOCK") return { code: "LEGACY_MANUAL_BLOCK" };
  if (interval.source === "LEGACY_AVAILABILITY") return { code: "LEGACY_AVAILABILITY_WINDOW" };
  if (interval.status === "MAINTENANCE") return { code: "OVERRIDE_MAINTENANCE", sourceId: interval.sourceId };
  if (interval.status === "INTERNAL_HOLD") return { code: "OVERRIDE_INTERNAL_HOLD", sourceId: interval.sourceId };
  return { code: "OVERRIDE_COMMERCIAL_BLOCK", sourceId: interval.sourceId };
}

function uniqueReasons(reasons: AvailabilityReason[]) {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = `${reason.code}:${reason.sourceId || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareCanonicalIntervals(a: AvailabilityConflictInterval, b: AvailabilityConflictInterval) {
  const byStart = a.from.getTime() - b.from.getTime();
  if (byStart) return byStart;
  return statusPriority(a.status) - statusPriority(b.status);
}

function isManualBlockingStatus(status: string) {
  return ["COMMERCIAL_BLOCK", "MAINTENANCE", "INTERNAL_HOLD"].includes(status);
}

function compareTimelineIntervals(a: AvailabilityConflictInterval, b: AvailabilityConflictInterval) {
  const manualA = isManualBlockingStatus(a.status) ? 0 : 1;
  const manualB = isManualBlockingStatus(b.status) ? 0 : 1;
  if (manualA !== manualB) return manualA - manualB;
  return statusPriority(a.status) - statusPriority(b.status);
}

export function summarizeAvailabilityTimeline(
  decisionValue: Pick<AvailabilityDecision, "conflictingIntervals">,
  referenceDate: Date | string
): AvailabilityTimelineSummary {
  const reference = toDate(referenceDate) || startOfDay(new Date());
  const intervals = decisionValue.conflictingIntervals
    .filter((interval) => interval.to >= reference)
    .sort(compareCanonicalIntervals);
  const current = intervals
    .filter((interval) => interval.from <= reference && interval.to >= reference)
    .sort(compareTimelineIntervals);
  const activeInterval = current[0] || null;

  if (!activeInterval) {
    const nextInterval = intervals.find((interval) => interval.from > reference) || null;
    if (!nextInterval) {
      return {
        activeInterval: null,
        activeUntil: null,
        nextInterval: null,
        availableFrom: reference,
        availableUntil: null,
        availableDays: null
      };
    }
    const availableUntil = availabilityBoundaryBefore(nextInterval);
    return {
      activeInterval: null,
      activeUntil: null,
      nextInterval,
      availableFrom: reference,
      availableUntil,
      availableDays: positiveCalendarDays(reference, nextInterval.from)
    };
  }

  let activeUntil = current.reduce((latest, interval) => interval.to > latest ? interval.to : latest, activeInterval.to);
  let endingInterval = current
    .filter((interval) => interval.to.getTime() === activeUntil.getTime())
    .sort(compareTimelineIntervals)[0] || activeInterval;

  let extended = true;
  while (extended) {
    extended = false;
    for (const interval of intervals) {
      if (interval.from > activeUntil || interval.to <= activeUntil) continue;
      activeUntil = interval.to;
      endingInterval = interval;
      extended = true;
    }
  }
  endingInterval = intervals
    .filter((interval) => interval.from <= activeUntil && interval.to.getTime() === activeUntil.getTime())
    .sort(compareTimelineIntervals)[0] || endingInterval;

  const nextInterval = intervals.find((interval) => interval.from > activeUntil) || null;
  const availableFrom = availabilityBoundaryAfter(endingInterval);
  const availableUntil = nextInterval ? availabilityBoundaryBefore(nextInterval) : null;
  const availableDays = nextInterval ? positiveCalendarDays(availableFrom, nextInterval.from) : null;

  return {
    activeInterval,
    activeUntil,
    nextInterval,
    availableFrom,
    availableUntil,
    availableDays
  };
}

export function bookingPeriodsConflict(
  firstStart: Date,
  firstEnd: Date,
  secondStart: Date,
  secondEnd: Date
) {
  if (firstStart > firstEnd || secondStart > secondEnd) return false;
  if (firstStart > secondEnd || firstEnd < secondStart) return false;

  const firstHandsToSecond =
    firstEnd.getTime() === secondStart.getTime() &&
    firstStart.getTime() < secondStart.getTime();
  const secondHandsToFirst =
    secondEnd.getTime() === firstStart.getTime() &&
    secondStart.getTime() < firstStart.getTime();
  return !firstHandsToSecond && !secondHandsToFirst;
}

function availabilityIntervalConflicts(
  interval: AvailabilityConflictInterval,
  requestedStart: Date,
  requestedEnd: Date
) {
  if (interval.source === "RESERVATION" && allowsSameDayHandoff(interval.status)) {
    return bookingPeriodsConflict(interval.from, interval.to, requestedStart, requestedEnd);
  }
  return interval.from <= requestedEnd && interval.to >= requestedStart;
}

function allowsSameDayHandoff(status: string) {
  return status === "BOOKED";
}

function availabilityBoundaryBefore(interval: AvailabilityConflictInterval) {
  return allowsSameDayHandoff(interval.status) ? interval.from : addDays(interval.from, -1);
}

function availabilityBoundaryAfter(interval: AvailabilityConflictInterval) {
  return allowsSameDayHandoff(interval.status) ? interval.to : addDays(interval.to, 1);
}

function positiveCalendarDays(from: Date, to: Date) {
  const days = Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / (24 * 60 * 60 * 1000));
  return days > 0 ? days : null;
}

function minDate(a: Date, b: Date) {
  return a <= b ? a : b;
}

function maxDate(a: Date, b: Date) {
  return a >= b ? a : b;
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseDateFromText(value?: string | null) {
  const text = String(value || "");
  const match = text.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = match[3] ? normalizeYear(Number(match[3])) : new Date().getFullYear();
  const date = new Date(Date.UTC(year, month, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return startOfDay(date);
}

function normalizeYear(value: number) {
  if (value < 100) return 2000 + value;
  return value;
}

function statusPriority(status: string) {
  if (status === "BOOKED") return 0;
  if (status === "RESERVED") return 1;
  if (status === "HOLD") return 2;
  return 3;
}
