export const HOLD_DURATION_DAYS = 5;

export function reservationBusinessStatusLabel(status: string) {
  return ({
    HOLD: "HOLD",
    RESERVED: "HOLD",
    BOOKED: "Rezervat",
    CANCELLED: "Anulat",
    EXPIRED: "Expirat"
  } as Record<string, string>)[status] || status;
}

const HOLD_STATUSES = ["HOLD", "RESERVED"] as const;

export function holdExpirationFrom(value = new Date()) {
  const expiresAt = new Date(value);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + HOLD_DURATION_DAYS);
  return expiresAt;
}

export function effectiveHoldExpiresAt(input: { holdExpiresAt: Date | null; createdAt: Date }) {
  return input.holdExpiresAt || holdExpirationFrom(input.createdAt);
}

export function isEffectiveHold(
  input: { status: string; holdExpiresAt: Date | null; createdAt: Date },
  now = new Date()
) {
  return HOLD_STATUSES.includes(input.status as (typeof HOLD_STATUSES)[number]) && effectiveHoldExpiresAt(input) > now;
}

export function isEffectiveBlockingReservation(
  input: { status: string; holdExpiresAt: Date | null; createdAt: Date },
  now = new Date()
) {
  return input.status === "BOOKED" || isEffectiveHold(input, now);
}

export function isHoldStatus(status: string) {
  return HOLD_STATUSES.includes(status as (typeof HOLD_STATUSES)[number]);
}

export type ReservationOccupancySummary = {
  activeHolds: number;
  occupiedNow: number;
  upcoming: number;
  activeOrUpcoming: number;
};

export function occupancySummaryFromCounts(input: Omit<ReservationOccupancySummary, "activeOrUpcoming">): ReservationOccupancySummary {
  return {
    ...input,
    activeOrUpcoming: input.occupiedNow + input.activeHolds + input.upcoming
  };
}

export function summarizeReservationOccupancy(
  reservations: Array<{
    status: string;
    periodStart: string | Date;
    periodEnd: string | Date;
    holdExpiresAt: string | Date | null;
    createdAt: string | Date;
  }>,
  now = new Date()
): ReservationOccupancySummary {
  const today = startOfUtcDay(now);
  const activeHolds = reservations.filter((row) =>
    isEffectiveHold({
      status: row.status,
      holdExpiresAt: row.holdExpiresAt ? new Date(row.holdExpiresAt) : null,
      createdAt: new Date(row.createdAt)
    }, now) && new Date(row.periodEnd) >= today
  ).length;
  const occupiedNow = reservations.filter((row) =>
    row.status === "BOOKED" && new Date(row.periodStart) <= today && new Date(row.periodEnd) >= today
  ).length;
  const upcoming = reservations.filter((row) =>
    row.status === "BOOKED" && new Date(row.periodStart) > today && new Date(row.periodEnd) >= today
  ).length;
  return occupancySummaryFromCounts({ activeHolds, occupiedNow, upcoming });
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
