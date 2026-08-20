import assert from "node:assert/strict";
import { isSalesReportInventoryEligible } from "../src/lib/sales-report-inventory";

const periodStart = new Date("2026-08-01T00:00:00.000Z");
const periodEnd = new Date("2026-08-31T00:00:00.000Z");

assert.equal(isSalesReportInventoryEligible({ lifecycleStatus: "ACTIVE" }, periodStart, periodEnd), true);
assert.equal(isSalesReportInventoryEligible({ lifecycleStatus: "MAINTENANCE" }, periodStart, periodEnd), false);
assert.equal(isSalesReportInventoryEligible({ lifecycleStatus: "INACTIVE" }, periodStart, periodEnd), false);
assert.equal(isSalesReportInventoryEligible({ lifecycleStatus: "ARCHIVED" }, periodStart, periodEnd), false);

for (const type of ["MAINTENANCE", "COMMERCIAL_BLOCK", "INTERNAL_HOLD"]) {
  assert.equal(isSalesReportInventoryEligible({
    lifecycleStatus: "ACTIVE",
    availabilityOverrides: [{
      id: `override-${type}`,
      type,
      reason: "Test indisponibilitate",
      periodStart: "2026-08-10T00:00:00.000Z",
      periodEnd: "2026-08-20T00:00:00.000Z"
    }]
  }, periodStart, periodEnd), false, `${type} must be excluded from the sales denominator`);
}

assert.equal(isSalesReportInventoryEligible({
  lifecycleStatus: "ACTIVE",
  availabilityOverrides: [{
    id: "old-maintenance",
    type: "MAINTENANCE",
    reason: "Interventie finalizata",
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: "2026-07-10T00:00:00.000Z"
  }]
}, periodStart, periodEnd), true, "an old override must not affect the selected reporting period");

assert.equal(isSalesReportInventoryEligible({
  lifecycleStatus: "ACTIVE",
  blockedReason: "Blocaj legacy",
  blockedFrom: "2026-08-05T00:00:00.000Z",
  blockedUntil: "2026-08-12T00:00:00.000Z"
}, periodStart, periodEnd), false, "an overlapping legacy block must be excluded");

assert.equal(isSalesReportInventoryEligible({
  lifecycleStatus: "ACTIVE",
  blockedReason: "Blocaj legacy incheiat",
  blockedFrom: "2026-07-01T00:00:00.000Z",
  blockedUntil: "2026-07-31T00:00:00.000Z"
}, periodStart, periodEnd), true, "an old legacy block must not affect the selected reporting period");

assert.equal(isSalesReportInventoryEligible({
  lifecycleStatus: "ACTIVE",
  reservations: [{
    id: "booked-location",
    status: "BOOKED",
    periodStart,
    periodEnd
  }]
}, periodStart, periodEnd), true, "BOOKED inventory remains eligible and is counted as sold");

console.log("Sales report inventory eligibility tests passed.");
