export type PublicAvailabilityStatus = "AVAILABLE" | "BOOKED" | "RESERVED" | "UNKNOWN";

type AvailabilityInput = {
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
    type?: string | null;
    reason?: string | null;
    periodStart?: Date | string | null;
    periodEnd?: Date | string | null;
    clearedAt?: Date | string | null;
  }>;
  reservations?: Array<{
    status?: string | null;
    periodStart?: Date | string | null;
    periodEnd?: Date | string | null;
  }>;
};

export type PublicAvailability = {
  publicStatus: PublicAvailabilityStatus;
  label: string;
  detail: string | null;
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

export function publicAvailability(input: AvailabilityInput, now = new Date()): PublicAvailability {
  const status = String(input.status || "UNKNOWN").toUpperCase();
  const availabilityText = cleanText(input.availabilityText);
  const availableFrom = toDate(input.availableFrom);
  const availableUntil = toDate(input.availableUntil);
  const bookedFrom = toDate(input.bookedFrom);
  const bookedUntil = toDate(input.bookedUntil);
  const today = startOfDay(now);
  const reservations = normalizeReservations(input.reservations);
  const activeReservation = reservations
    .filter((reservation) => reservation.periodStart <= today && reservation.periodEnd >= today)
    .sort((a, b) => statusPriority(a.status) - statusPriority(b.status))[0];
  const futureReservation = reservations.find((reservation) => reservation.periodStart > today);

  if (activeReservation) {
    const activeStatus = activeReservation.status === "RESERVED" || activeReservation.status === "HOLD" ? "RESERVED" : "BOOKED";
    return {
      publicStatus: activeStatus,
      label: `${activeStatus === "RESERVED" ? "Rezervat" : "Inchiriat"} pana la ${formatDate(activeReservation.periodEnd)}`,
      detail: `Disponibil din ${formatDate(addDays(activeReservation.periodEnd, 1))}`
    };
  }

  if (futureReservation) {
    return {
      publicStatus: "AVAILABLE",
      label: `Disponibil pana la ${formatDate(addDays(futureReservation.periodStart, -1))}`,
      detail: bookingWindowLabel(futureReservation.status, futureReservation.periodStart, futureReservation.periodEnd)
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
  const status = String(input.status || "UNKNOWN").toUpperCase();
  const lifecycleStatus = String(input.lifecycleStatus || "ACTIVE").toUpperCase();
  const requestedStart = toDate(requestedStartDate) || startOfDay(new Date());
  const requestedEnd = toDate(requestedEndDate) || requestedStart;
  const from = requestedStart <= requestedEnd ? requestedStart : requestedEnd;
  const to = requestedStart <= requestedEnd ? requestedEnd : requestedStart;
  const normalizedReservations = normalizeReservations(input.reservations);

  if (lifecycleStatus === "INACTIVE" || lifecycleStatus === "ARCHIVED" || lifecycleStatus === "MAINTENANCE") {
    return {
      status: "SUSPENDED",
      publicStatus: "UNKNOWN",
      label: lifecycleStatus === "MAINTENANCE" ? "In mentenanta" : "Locatie inactiva",
      detail: null,
      windows: []
    };
  }

  if (status === "UNKNOWN") {
    return {
      status: "SUSPENDED",
      publicStatus: "UNKNOWN",
      label: "Suspendata / de verificat",
      detail: null,
      windows: []
    };
  }

  const occupied = [
    ...normalizedReservations.map((reservation) => ({
      from: reservation.periodStart,
      to: reservation.periodEnd,
      status: reservation.status
    })),
    ...manualAvailabilityIntervals(input, from, to),
    ...legacyOccupiedIntervals(input, from, to, status)
  ]
    .map((interval) => ({
      ...interval,
      from: maxDate(interval.from, from),
      to: minDate(interval.to, to)
    }))
    .filter((interval) => interval.from <= interval.to)
    .sort((a, b) => a.from.getTime() - b.from.getTime());

  if ((status === "BOOKED" || status === "RESERVED") && !occupied.length && !toDate(input.bookedUntil)) {
    return {
      status: "UNAVAILABLE",
      publicStatus: status === "RESERVED" ? "RESERVED" : "BOOKED",
      label: status === "RESERVED" ? "Rezervata" : "Inchiriata",
      detail: cleanText(input.availabilityText),
      windows: []
    };
  }

  const mergedOccupied = mergeIntervals(occupied);
  const windows = availableWindows(from, to, mergedOccupied);
  const constrainedWindows = constrainAvailabilityBounds(windows, input);

  if (!constrainedWindows.length) {
    const firstOccupied = mergedOccupied[0];
    return {
      status: "UNAVAILABLE",
      publicStatus: firstOccupied?.status === "RESERVED" || firstOccupied?.status === "HOLD" ? "RESERVED" : "BOOKED",
      label: "Ocupata in perioada selectata",
      detail: firstOccupied ? bookingWindowLabel(firstOccupied.status, firstOccupied.from, firstOccupied.to) : null,
      windows: []
    };
  }

  const fullWindow = constrainedWindows.length === 1 && constrainedWindows[0].from <= from && constrainedWindows[0].to >= to;
  const label = availabilityWindowLabel(constrainedWindows, from, to, mergedOccupied);

  return {
    status: fullWindow ? "AVAILABLE" : "PARTIAL",
    publicStatus: "AVAILABLE",
    label,
    detail: fullWindow ? null : "Disponibilitate partiala in perioada selectata",
    windows: constrainedWindows
  };
}

export function formatAvailability(input: Pick<PublicAvailability, "label" | "detail">) {
  return input.detail ? `${input.label} | ${input.detail}` : input.label;
}

function bookingWindowLabel(status: string, from: Date | null, until: Date | null) {
  const label = status === "RESERVED" || status === "HOLD" ? "Rezervat" : "Inchiriat";
  if (from && until) return `${label} intre ${formatDate(from)} si ${formatDate(until)}`;
  if (from) return `${label} din ${formatDate(from)}`;
  if (until) return `${label} pana la ${formatDate(until)}`;
  return label;
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

function legacyOccupiedIntervals(input: AvailabilityInput, from: Date, to: Date, status: string) {
  const bookedFrom = toDate(input.bookedFrom);
  const bookedUntil = toDate(input.bookedUntil);
  const availableFrom = toDate(input.availableFrom);
  const intervals: Array<{ from: Date; to: Date; status: string }> = [];

  if ((status === "BOOKED" || status === "RESERVED") && bookedFrom && bookedUntil) {
    intervals.push({ from: bookedFrom, to: bookedUntil, status });
  } else if ((status === "BOOKED" || status === "RESERVED") && bookedUntil) {
    intervals.push({ from, to: bookedUntil, status });
  } else if (status === "AVAILABLE_FROM" && availableFrom && availableFrom > from) {
    intervals.push({ from, to: minDate(addDays(availableFrom, -1), to), status: "BOOKED" });
  }

  return intervals;
}

function manualAvailabilityIntervals(input: AvailabilityInput, from: Date, to: Date) {
  const intervals: Array<{ from: Date; to: Date; status: string }> = [];
  const blockedFrom = toDate(input.blockedFrom) || from;
  const blockedUntil = toDate(input.blockedUntil) || to;

  if (input.blockedReason && blockedFrom <= to && blockedUntil >= from) {
    intervals.push({
      from: blockedFrom,
      to: blockedUntil,
      status: "COMMERCIAL_BLOCK"
    });
  }

  for (const override of input.availabilityOverrides || []) {
    if (toDate(override.clearedAt)) continue;
    const periodStart = toDate(override.periodStart);
    if (!periodStart) continue;
    const periodEnd = toDate(override.periodEnd) || to;
    if (periodStart <= to && periodEnd >= from) {
      intervals.push({
        from: periodStart,
        to: periodEnd,
        status: String(override.type || "COMMERCIAL_BLOCK").toUpperCase()
      });
    }
  }

  return intervals;
}

function constrainAvailabilityBounds(windows: AvailabilityWindow[], input: AvailabilityInput) {
  const availableFrom = toDate(input.availableFrom);
  const availableUntil = toDate(input.availableUntil);

  return windows
    .map((window) => ({
      ...window,
      from: availableFrom && window.from < availableFrom ? availableFrom : window.from,
      to: availableUntil && window.to > availableUntil ? availableUntil : window.to
    }))
    .filter((window) => window.from <= window.to);
}

function mergeIntervals(intervals: Array<{ from: Date; to: Date; status: string }>) {
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
      const windowEnd = addDays(interval.from, -1);
      windows.push({
        from: cursor,
        to: windowEnd,
        labelFrom: cursor,
        labelTo: interval.from
      });
    }
    if (interval.to >= cursor) cursor = addDays(interval.to, 1);
    if (cursor > to) break;
  }

  if (cursor <= to) {
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
  to: Date,
  occupied: Array<{ from: Date; to: Date; status: string }>
) {
  if (!windows.length) return "Ocupata in perioada selectata";
  const fullWindow = windows.length === 1 && windows[0].from <= from && windows[0].to >= to;
  if (fullWindow) return "Disponibila";

  const labels = windows.map((window) => {
    const previous = occupied.filter((interval) => interval.to < window.from).at(-1);
    const next = occupied.find((interval) => interval.from > window.to);
    const labelFrom = previous ? previous.to : window.labelFrom;
    const labelTo = next ? next.from : window.labelTo;

    if (window.from <= from) return `Disponibila pana la data de ${formatDate(labelTo)}`;
    if (window.to >= to) return `Disponibila din data de ${formatDate(labelFrom)}`;
    return `Disponibila din data de ${formatDate(labelFrom)} pana la data de ${formatDate(labelTo)}`;
  });

  return labels.join("; ");
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

function normalizeReservations(input: AvailabilityInput["reservations"]) {
  return (input || [])
    .map((reservation) => ({
      status: String(reservation.status || "BOOKED").toUpperCase(),
      periodStart: toDate(reservation.periodStart),
      periodEnd: toDate(reservation.periodEnd)
    }))
    .filter((reservation): reservation is { status: string; periodStart: Date; periodEnd: Date } =>
      Boolean(
        reservation.periodStart &&
          reservation.periodEnd &&
          reservation.periodStart <= reservation.periodEnd &&
          !["CANCELLED", "EXPIRED", "ARCHIVED"].includes(reservation.status)
      )
    )
    .sort((a, b) => {
      const byStart = a.periodStart.getTime() - b.periodStart.getTime();
      if (byStart) return byStart;
      return statusPriority(a.status) - statusPriority(b.status);
    });
}

function statusPriority(status: string) {
  if (status === "BOOKED") return 0;
  if (status === "RESERVED") return 1;
  if (status === "HOLD") return 2;
  return 3;
}
