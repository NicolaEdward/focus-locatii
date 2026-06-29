const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

const billing = loadTsModule(path.join(process.cwd(), "src", "lib", "decoration-billing.ts"));
const operationStatus = loadTsModule(path.join(process.cwd(), "src", "lib", "operation-status.ts"));

main();

function main() {
  finalizedMontajAppearsInMonthlyBilling();
  unfinishedMontajDoesNotEnterTotal();
  cancelledAndArchivedAreExcluded();
  missingCostWarningAppears();
  monthlyTotalIsCorrect();
  duplicateLegacyAndRelationalRowsDoNotDoubleCount();
  exportRowsMatchReportRows();
  costUpdateChangesTotalWithoutDuplicate();
  operationTaskStatusStoresCompletionDate();

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "finalized montaj appears in monthly billing",
      "unfinished montaj does not appear in billing total",
      "cancelled/archived montaj excluded",
      "missing cost warning appears",
      "monthly total is correct",
      "duplicate legacy/OperationTask read does not double count",
      "export rows match report rows",
      "cost update changes total without duplicating row",
      "operation extra task DONE stores completion metadata"
    ]
  }, null, 2));
}

function finalizedMontajAppearsInMonthlyBilling() {
  const report = billing.buildDecorationBillingReport([
    task({ status: "DONE", finalizationDate: "2026-06-12T10:00:00.000Z", cost: 250 })
  ], "2026-06");

  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].client, "Client Test");
  assert.equal(report.rows[0].campaign, "Campanie Test");
  assert.equal(report.rows[0].location, "B-001 - Piata Test");
  assert.equal(report.rows[0].status, "DONE");
}

function unfinishedMontajDoesNotEnterTotal() {
  const report = billing.buildDecorationBillingReport([
    task({ status: "IN_PROGRESS", finalizationDate: "2026-06-12T10:00:00.000Z", cost: 250 })
  ], "2026-06");

  assert.equal(report.rows.length, 0);
  assert.equal(Object.keys(report.totals).length, 0);
}

function cancelledAndArchivedAreExcluded() {
  const report = billing.buildDecorationBillingReport([
    task({ reservationStatus: "CANCELLED", status: "DONE", cost: 100 }),
    task({ reservationStatus: "ARCHIVED", status: "DONE", cost: 100, reservationId: "reservation-archived" }),
    task({ status: "ARCHIVED", cost: 100, reservationId: "task-archived" })
  ], "2026-06");

  assert.equal(report.rows.length, 0);
  assert.equal(Object.keys(report.totals).length, 0);
}

function missingCostWarningAppears() {
  const report = billing.buildDecorationBillingReport([
    task({ status: "DONE", cost: null })
  ], "2026-06");

  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].missingCost, true);
  assert.equal(report.missingCostRows.length, 1);
  assert.equal(Object.keys(report.totals).length, 0);
}

function monthlyTotalIsCorrect() {
  const report = billing.buildDecorationBillingReport([
    task({ reservationId: "r1", cost: 100, currency: "EUR" }),
    task({ reservationId: "r2", cost: 50, currency: "EUR" }),
    task({ reservationId: "r3", cost: 200, currency: "RON" }),
    task({ reservationId: "r4", cost: 999, finalizationDate: "2026-07-01T00:00:00.000Z" })
  ], "2026-06");

  assert.equal(report.rows.length, 3);
  assert.equal(report.totals.EUR, 150);
  assert.equal(report.totals.RON, 200);
}

function duplicateLegacyAndRelationalRowsDoNotDoubleCount() {
  const report = billing.buildDecorationBillingReport([
    task({ reservationId: "r1", dedupeKey: "reservation:r1:DECORATION:base", cost: 120 }),
    task({ reservationId: "r1", dedupeKey: "reservation:r1:DECORATION:base", cost: 120 })
  ], "2026-06");

  assert.equal(report.rows.length, 1);
  assert.equal(report.totals.EUR, 120);
}

function exportRowsMatchReportRows() {
  const report = billing.buildDecorationBillingReport([
    task({ reservationId: "r1", cost: 120 }),
    task({ reservationId: "r2", cost: null })
  ], "2026-06");
  const csv = billing.decorationBillingCsv(report);

  assert(csv.includes("Data finalizare"));
  assert(csv.includes("Client Test"));
  assert(csv.includes("Cost montaj lipsa"));
  assert(csv.includes("TOTAL"));
  assert.equal((csv.match(/2026-06/g) || []).length >= report.rows.length, true);
  assert.equal(billing.decorationBillingFileName("2026-06"), "facturare-montaj-2026-06.csv");
}

function costUpdateChangesTotalWithoutDuplicate() {
  const report = billing.buildDecorationBillingReport([
    task({ reservationId: "r1", dedupeKey: "reservation:r1:DECORATION:base", cost: 100 }),
    task({ reservationId: "r1", dedupeKey: "reservation:r1:DECORATION:base", cost: 175 })
  ], "2026-06");

  assert.equal(report.rows.length, 1);
  assert.equal(report.totals.EUR, 175);
}

function operationTaskStatusStoresCompletionDate() {
  const notes = operationStatus.withOperationTask(null, {
    id: "red-1",
    kind: "decoration",
    status: "NEW",
    taskType: "redecoration",
    taskDate: "2026-06-10T00:00:00.000Z"
  });
  const doneNotes = operationStatus.withOperationTaskStatus(notes, "red-1", "DONE");
  const [taskRow] = operationStatus.operationExtraTasks(doneNotes, "decoration");

  assert.equal(taskRow.status, "DONE");
  assert(taskRow.updatedAt, "updatedAt should be stored when status changes");
  assert(taskRow.completedAt, "completedAt should be stored for DONE task");
}

function task(overrides = {}) {
  const reservationId = overrides.reservationId || "reservation-1";
  return {
    reservation: {
      id: reservationId,
      status: overrides.reservationStatus || "BOOKED",
      clientName: "Client Test",
      campaignName: "Campanie Test",
      campaignId: "campaign-1",
      contractNumber: "CTR-1",
      locationId: "location-1",
      locationCode: "B-001",
      locationName: "Piata Test",
      currency: overrides.currency || "EUR"
    },
    taskDate: overrides.taskDate || "2026-06-01T00:00:00.000Z",
    finalizationDate: overrides.finalizationDate || "2026-06-12T10:00:00.000Z",
    operationStatus: overrides.status || "DONE",
    taskId: overrides.taskId || null,
    taskType: overrides.taskType || "initial",
    cost: overrides.cost === undefined ? 100 : overrides.cost,
    currency: overrides.currency || "EUR",
    dedupeKey: overrides.dedupeKey || null
  };
}
