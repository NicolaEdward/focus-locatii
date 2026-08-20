import {
  decideAvailability,
  type AvailabilityInput,
  type AvailabilityReasonCode
} from "@/lib/availability";

const NON_SELLABLE_INVENTORY_REASONS = new Set<AvailabilityReasonCode>([
  "INVALID_PERIOD",
  "LOCATION_INACTIVE",
  "LOCATION_ARCHIVED",
  "LOCATION_MAINTENANCE",
  "OVERRIDE_COMMERCIAL_BLOCK",
  "OVERRIDE_MAINTENANCE",
  "OVERRIDE_INTERNAL_HOLD",
  "LEGACY_MANUAL_BLOCK"
]);

export function isSalesReportInventoryEligible(
  location: AvailabilityInput,
  periodStart: Date,
  periodEnd: Date
) {
  const decision = decideAvailability({
    ...location,
    periodStart,
    periodEnd
  });

  return !decision.reasons.some((reason) => NON_SELLABLE_INVENTORY_REASONS.has(reason.code));
}
