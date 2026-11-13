const assert = require("node:assert/strict");
const { loadTsModule } = require("./load-ts-module.cjs");

const billing = loadTsModule("src/lib/decoration-billing.ts");
const operations = loadTsModule("src/lib/operation-status.ts");
const results = [];
function check(name, run) {
  try { run(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.message }); }
}
function task(id, changes = {}) {
  return {
    reservation: { id, status: "BOOKED", clientName: "SIM Client", campaignName: "SIM Campaign", currency: "EUR" },
    operationStatus: "DONE", taskDate: "2027-01-03T00:00:00.000Z", finalizationDate: "2027-01-04T00:00:00.000Z",
    cost: 250, currency: "RON", ...changes,
  };
}

check("unknown installation currency is not the rental currency or EUR", () => {
  const report = billing.buildDecorationBillingReport([task("unknown", { currency: null })], "2027-01");
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].currency, null);
  assert.equal(report.rows[0].missingCurrency, true);
  assert.equal(report.missingCurrencyRows.length, 1);
  assert.deepEqual(Object.keys(report.totals), []);
});
check("unsupported currency is preserved for review outside monetary totals", () => {
  const report = billing.buildDecorationBillingReport([task("unsupported", { currency: "USD" })], "2027-01");
  assert.equal(report.rows[0].currency, null);
  assert.equal(report.rows[0].sourceCurrency, "USD");
  assert.deepEqual(Object.keys(report.totals), []);
  assert.match(billing.decorationBillingCsv(report), /Moneda montaj neverificata/);
});
check("completed evidence survives rental cancellation without authorizing billing", () => {
  const current = task("cancelled");
  const report = billing.buildDecorationBillingReport([
    { ...current, reservation: { ...current.reservation, status: "CANCELLED" } },
    task("active"),
  ], "2027-01");
  assert.equal(report.rows.length, 1);
  assert.equal(report.totals.RON, 250);
  assert.equal(report.executionRows.length, 2);
  const cancelled = report.executionRows.find((row) => row.reservationId === "cancelled");
  assert.equal(cancelled.reservationStatus, "CANCELLED");
  assert.equal(cancelled.billingReview, "rental_status_review");
  assert.equal(cancelled.cost, 250);
});
check("unknown estimate differs from explicit zero", () => {
  const report = billing.buildDecorationBillingReport([task("unknown", { cost: null }), task("free", { cost: 0 })], "2027-01");
  assert.equal(report.missingCostRows.length, 1);
  assert.equal(report.rows.find((row) => row.reservationId === "free").missingCost, false);
  assert.equal(report.totals.RON, 0);
});
check("operation cost metadata does not manufacture currency", () => {
  const unverified = operations.withOperationCost(null, "decoration", 250, null);
  assert.equal(operations.operationCost(unverified, "decoration").currency, null);
  const known = operations.withOperationCost(unverified, "decoration", 0, "RON");
  assert.equal(operations.operationCost(known, "decoration").cost, 0);
  assert.equal(operations.operationCost(known, "decoration").currency, "RON");
});
check("legacy/relational duplicates do not double count completed execution", () => {
  const current = task("same", { dedupeKey: "reservation:same:DECORATION:base" });
  const report = billing.buildDecorationBillingReport([current, current], "2027-01");
  assert.equal(report.executionRows.length, 1);
  assert.equal(report.rows.length, 1);
  assert.equal(report.totals.RON, 250);
});
check("installation totals preserve cents without binary floating point residue", () => {
  const report = billing.buildDecorationBillingReport([task("small-a", { cost: 0.1 }), task("small-b", { cost: 0.2 })], "2027-01");
  assert.equal(report.totals.RON, 0.3);
  assert.equal(billing.decorationBillingCsv(report).includes("0.30000000000000004"), false);
});
check("historical unsupported precision needs review instead of silent rounding", () => {
  const report = billing.buildDecorationBillingReport([task("invalid-precision", { cost: 0.001 })], "2027-01");
  assert.equal(report.rows[0].cost, null);
  assert.equal(report.rows[0].missingCost, true);
  assert.deepEqual(Object.keys(report.totals), []);
});
console.log(JSON.stringify({ ok: results.every((row) => row.passed), results }, null, 2));
if (results.some((row) => !row.passed)) process.exitCode = 1;
