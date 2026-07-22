import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { sagaShadowFixture } from "../src/lib/integrations/saga/fixtures";
import { normalizeSagaInvoice } from "../src/lib/integrations/saga/normalize";
import { reconcileSagaSnapshot, type SagaCanonicalInvoice, type SagaCanonicalPayment } from "../src/lib/integrations/saga/shadow-reconciliation";

const snapshot = sagaShadowFixture(new Date("2026-07-22T12:00:00.000Z"));
const normalized = normalizeSagaInvoice(snapshot.invoices[0]);
assert.equal(normalized.netAmount, "1000.00");
assert.equal(normalized.vatAmount, "190.00");
assert.equal(normalized.grossAmount, "1190.00");
assert.equal(normalized.currency, "EUR");

const invoices: SagaCanonicalInvoice[] = [{
  id: "canonical-1", companyCode: "FOCUS_MEDIA", invoiceNumber: "PV 0001", normalizedInvoiceNumber: "pv0001",
  invoiceDate: new Date("2026-07-01T00:00:00.000Z"), currency: "EUR", invoicedAmount: new Prisma.Decimal("1190.00"),
  remainingAmount: new Prisma.Decimal("990.00"), clientTaxId: "ROPREVIEW001"
}];
const payments: SagaCanonicalPayment[] = [{
  id: "manual-1", receivableId: "canonical-1", amount: new Prisma.Decimal("200.00"), currency: "EUR",
  receivedAt: new Date("2026-07-10T00:00:00.000Z"), paymentReference: "LOCAL-REFERENCE", source: "manual", status: "active"
}];

const report = reconcileSagaSnapshot(snapshot, invoices, payments, new Date("2026-07-22T12:00:00.000Z"));
assert.equal(report.summary.exactMatches, 1);
assert.equal(report.summary.newInvoices, 1);
assert.equal(report.summary.manualPaymentsPendingReconciliation, 1);
assert.equal(report.summary.potentialDuplicatePayments, 1, "amount/date without matching reference is not auto-merged");
assert.equal(report.summary.exactPaymentMatches, 0);
assert.equal(report.summary.newPayments, 0);
assert.equal(report.canonicalWrites, 0);
assert.equal(report.paymentLedgerPolicy, "MANUAL_LEDGER_AUTHORITATIVE");
assert.equal(report.rawPayloadIncluded, false);
assert.equal(report.totals.find((row) => row.currency === "EUR")?.vat, "190.00");
assert.equal(report.totals.find((row) => row.currency === "RON")?.gross, "5950.00");

const conflictInvoices = [{ ...invoices[0], invoicedAmount: new Prisma.Decimal("1200.00") }];
const conflict = reconcileSagaSnapshot(snapshot, conflictInvoices, payments);
assert.equal(conflict.categories.CONFLICTING_TOTALS, 1);
assert.equal(conflict.summary.exactMatches, 0);

const exactPaymentSnapshot = structuredClone(snapshot);
exactPaymentSnapshot.collections[0].reference = "LOCAL-REFERENCE";
const exactPayment = reconcileSagaSnapshot(exactPaymentSnapshot, invoices, payments);
assert.equal(exactPayment.summary.exactPaymentMatches, 1);
assert.equal(exactPayment.summary.potentialDuplicatePayments, 0);

const newPayment = reconcileSagaSnapshot(snapshot, invoices, []);
assert.equal(newPayment.summary.newPayments, 1);
assert.equal(newPayment.canonicalWrites, 0);

const reversedPaymentSnapshot = structuredClone(snapshot);
reversedPaymentSnapshot.collections[0].reversed = true;
const reversedPayment = reconcileSagaSnapshot(reversedPaymentSnapshot, invoices, payments);
assert.equal(reversedPayment.summary.reversedPayments, 1);
assert.equal(reversedPayment.summary.exactPaymentMatches, 0);

const cancelledInvoiceSnapshot = structuredClone(snapshot);
cancelledInvoiceSnapshot.invoices[0].cancelled = true;
const cancelledInvoice = reconcileSagaSnapshot(cancelledInvoiceSnapshot, invoices, payments);
assert.equal(cancelledInvoice.categories.CANCELLED_OR_STORNO, 1);
assert.equal(cancelledInvoice.summary.exactMatches, 0);

const route = read("src", "app", "api", "admin", "integrations", "saga", "shadow", "route.ts");
const service = read("src", "lib", "integrations", "saga", "shadow-reconciliation.ts");
const rbac = read("src", "lib", "rbac.ts");
assert(route.includes("runSagaShadowReconciliation"));
assert(!service.includes("financialReceivable.create"));
assert(!service.includes("financialReceivable.update"));
assert(!service.includes("financialReceivablePayment.create"));
assert(rbac.includes("finance.integrations.saga.view"));
assert(rbac.includes("finance.integrations.saga.configure"));

console.log(JSON.stringify({ ok: true, checks: 31, mode: "SHADOW_READ_ONLY", canonicalWrites: 0 }, null, 2));

function read(...parts: string[]) {
  return fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
}
