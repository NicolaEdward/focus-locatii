const assert = require("node:assert/strict");
require("tsx/cjs");
const { calculateSegmentedBillingItems, getValidatedPriceIntervals, combinePriceIntervals, amountForPriceIntervals } = require("../src/lib/segmented-billing.ts");
const d = (value) => new Date(value + "T00:00:00.000Z");
const input = { periodStart: d("2026-11-01"), periodEnd: d("2026-12-31"), monthlyAmount: 200, currency: "RON", billingRule: "month_start", billingFrequency: "monthly", paymentTermDays: 7 };
const segment = (from, to, rate, currency = "RON") => ({ effectiveFrom: from, effectiveTo: to, monthlyRent: rate, currency });
const schedule = [segment("2026-11-01", "2026-11-15", "100"), segment("2026-11-16", "2026-12-31", "200")];

assert.deepEqual(calculateSegmentedBillingItems(input, schedule).map((row) => row.amount), [150, 200], "An effective-date amendment must not overwrite earlier rent");
assert.deepEqual(calculateSegmentedBillingItems(input, []).map((row) => row.amount), [200, 200], "Legacy rows without segments use the explicit current monthly rent");
const once = calculateSegmentedBillingItems({ ...input, billingFrequency: "once", billingRule: "campaign_start" }, schedule);
assert.equal(once.length, 1);
assert.equal(once[0].amount, 350);
assert.equal(once[0].invoiceDate.toISOString().slice(0, 10), "2026-11-01");
assert.equal(once[0].dueDate.toISOString().slice(0, 10), "2026-11-08");

const oneMonth = { ...input, periodEnd: d("2026-11-30"), monthlyAmount: .01 };
const splitEqualRate = [segment("2026-11-01", "2026-11-15", ".01"), segment("2026-11-16", "2026-11-30", ".01")];
assert.equal(calculateSegmentedBillingItems(oneMonth, splitEqualRate)[0].amount, .01, "Round after summing segment contributions, not once per split");

for (const [parts, reason] of [
  [[segment("2026-11-01", "2026-11-14", 100), segment("2026-11-16", null, 200)], "PRICE_SEGMENT_GAP"],
  [[segment("2026-11-01", "2026-11-16", 100), segment("2026-11-16", null, 200)], "PRICE_SEGMENT_OVERLAP"],
  [[segment("2026-11-01", "2026-11-15", 100), segment("2026-11-16", null, 200, "EUR")], "PRICE_SEGMENT_CURRENCY_MISMATCH"],
  [[segment("2026-11-01", null, 0)], "PRICE_SEGMENT_RENT_INVALID"],
  [[segment("not-a-date", null, 100)], "PRICE_SEGMENT_PERIOD_INVALID"],
]) {
  const result = getValidatedPriceIntervals(input, parts);
  assert.equal(result.valid, false);
  assert.deepEqual(result.reasons, [reason]);
  assert.throws(() => calculateSegmentedBillingItems(input, parts), /reconciliere/);
}
assert.equal(getValidatedPriceIntervals({ ...input, currency: "" }, []).valid, false, "Do not invent the currency of an unpriced legacy contract");

const partial = { ...input, periodStart: d("2026-11-16"), periodEnd: d("2026-11-30") };
const shares = [33.34, 33.33, 33.33].map((monthlyAmount) => getValidatedPriceIntervals({ ...partial, monthlyAmount }, []).intervals);
assert.equal(amountForPriceIntervals(combinePriceIntervals(shares), partial.periodStart, partial.periodEnd), 50, "Contract shares are summed before monthly rounding");
const differentDates = [
  getValidatedPriceIntervals(partial, [segment("2026-11-16", "2026-11-20", "33.34"), segment("2026-11-21", "2026-11-30", "40")]).intervals,
  getValidatedPriceIntervals(partial, [segment("2026-11-16", "2026-11-25", "33.33"), segment("2026-11-26", "2026-11-30", "50")]).intervals,
];
assert.equal(amountForPriceIntervals(combinePriceIntervals(differentDates), partial.periodStart, partial.periodEnd), 38.33);
const leap = { ...input, periodStart: d("2028-02-01"), periodEnd: d("2028-02-29"), monthlyAmount: 290 };
assert.equal(calculateSegmentedBillingItems(leap, [segment("2028-02-01", "2028-02-14", 290), segment("2028-02-15", "2028-02-29", 580)])[0].amount, 440, "Leap-year inclusive calendar days");
console.log(JSON.stringify({ ok: true, checked: ["effective-date pricing", "legacy fallback", "once/monthly dates", "split rounding", "gap/overlap/currency refusal", "group cents", "different amendment boundaries", "leap day"] }));
