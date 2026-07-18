export const HOLD_DURATION_DAYS = 5;

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
