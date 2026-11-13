import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { NextRequest } from "next/server";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
import { prisma } from "../src/lib/prisma";
import { ADMIN_COOKIE, createSessionToken } from "../src/lib/auth";
import { createAuthSessionRecord } from "../src/lib/auth-sessions";
import { POST as previewRoute } from "../src/app/api/admin/financial/smartbill/preview/route";
import { POST as confirmRoute } from "../src/app/api/admin/financial/smartbill/confirm/route";
import { receivableNetAmount, receivableAdjustmentEntries } from "../src/lib/receivable-adjustments";
import { recordReceivablePayment } from "../src/lib/receivables-payment-service";
import { attestInvoiceTaxSplit } from "../src/lib/campaign-finance";
import { mergeSmartBillSourceMetadata } from "../src/lib/smartbill-source-metadata";
import { assertSmartBillHistoryComplete } from "../src/lib/smartbill-import";
import { currentFinancialReportScope } from "../src/lib/financial-report-scope";

loadEnvFile();
assertSyntheticEnvironment();
const databaseUrl = new URL(process.env.DATABASE_URL || "");
assert.ok(["127.0.0.1", "localhost"].includes(databaseUrl.hostname), "Route regression is restricted to a local synthetic database");
process.env.MFA_ENFORCEMENT_MODE = "off";
const tag = `smartbill-ledger-${randomUUID()}`;
const base = "http://localhost:3111";
const taxId = `9${Date.now().toString().slice(-8)}`;
const series = `TEST${Date.now()}`;
const actorId = `${tag}-actor`, clientId = `${tag}-client`, oldUploadId = `${tag}-old-upload`;
let cookie = "";
const invoiceIds: string[] = [];
const headers = ["Nr. crt.", "Client", "CIF", "Adresa", "Factura", "Data emiterii", "Data scadentei", "Status", "Moneda", "Valoare fara TVA", "Valoare TVA", "Valoare Totala", "Aviz insotire", "Observatii", "Index SPV"];
function row(number: string, gross: number, status = "emisa", net = gross * 0.8, vat = gross * 0.2) {
  return [1, "Synthetic Invoice Fixture SRL", taxId, "", number, "01/11/2026", "01/12/2026", status, "RON", net, vat, gross, "", "", ""];
}
function request(path: string, body: BodyInit, contentType?: string) {
  return new NextRequest(base + path, { method: "POST", headers: { origin: base, cookie, ...(contentType ? { "content-type": contentType } : {}) }, body });
}
async function preview(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), "Synthetic");
  const content = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const form = new FormData();
  form.set("companyName", "Focus Media");
  form.set("reportType", "customer_invoices");
  form.set("file", new File([content], `${tag}.xlsx`, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const response = await previewRoute(request("/api/admin/financial/smartbill/preview", form));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.preview;
}
async function confirm(rows: unknown[][], linkedAdjustment?: { documentNumber: string; linkedFinancialRowId: string }) {
  const current = await preview(rows);
  const response = await confirmRoute(request("/api/admin/financial/smartbill/confirm", JSON.stringify({ importToken: current.importToken, companyName: "Focus Media", reportType: "customer_invoices", manualActions: linkedAdjustment ? current.rows.filter((r: any) => r.documentNumber === linkedAdjustment.documentNumber).map((r: any) => ({ dedupeKey: r.dedupeKey, rowNumber: r.rowNumber, action: "link_adjustment", linkedFinancialRowId: linkedAdjustment.linkedFinancialRowId, reason: "Synthetic explicit original invoice proof" })) : [] }), "application/json"));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return { preview: current, body };
}
async function main() {
  assert.doesNotThrow(() => assertSmartBillHistoryComplete(Array(10000)));
  assert.throws(() => assertSmartBillHistoryComplete(Array(10001)), /limita sigură/);
  const reserved = { smartBillAdjustments: [{ adjustmentAmount: 200 }], fiscalTaxSplitAttestation: { verified: true }, ledgerProvenance: { requestKey: "fixture" }, source: "old", raw: { oldColumn: true } };
  const merged = mergeSmartBillSourceMetadata(reserved, { source: "SmartBill", raw: { newColumn: true }, smartBillAdjustments: [], fiscalTaxSplitAttestation: null, ledgerProvenance: null });
  assert.deepEqual(merged.smartBillAdjustments, reserved.smartBillAdjustments);
  assert.deepEqual(merged.fiscalTaxSplitAttestation, reserved.fiscalTaxSplitAttestation);
  assert.deepEqual(merged.ledgerProvenance, reserved.ledgerProvenance);
  assert.deepEqual(merged.raw, { newColumn: true });
  const actor = await prisma.user.create({ data: { id: actorId, email: `${tag}@synthetic.test`, name: "Synthetic Invoice Reviewer", role: "COO", passwordHash: "unusable-synthetic", active: true } });
  const session = await createAuthSessionRecord(actor.id, new NextRequest(base));
  cookie = `${ADMIN_COOKIE}=${createSessionToken({ ...actor, sessionId: session.id })}`;
  await prisma.clientAccount.create({ data: { id: clientId, companyName: "Synthetic Invoice Fixture SRL", normalizedName: `synthetic-invoice-${tag}`, taxId } });
  await prisma.financialReportUpload.create({ data: { id: oldUploadId, originalFileName: `${tag}-old.xlsx`, fileHash: `${tag}-old`, status: "confirmed", activeVersion: false } });
  const inactiveStates = [{ status: "archived", includedInReport: false }, { status: "cancelled", includedInReport: true }, { status: "in_term", includedInReport: false }];
  const inactiveRows = [];
  for (const [index, state] of inactiveStates.entries()) {
    const number = `${series}8${index}`;
    const item = await prisma.financialReceivable.create({ data: { uploadId: oldUploadId, companyName: "Focus Media", companyCode: "FOCUS_MEDIA", clientId, clientName: "Synthetic Invoice Fixture SRL", invoiceNumber: number, normalizedInvoiceNumber: number.toLowerCase(), invoiceDate: new Date("2026-11-01Z"), dueDate: new Date("2026-12-01Z"), currency: "RON", invoicedAmount: "50", collectedAmount: "0", remainingAmount: "50", ...state, needsReview: false } });
    invoiceIds.push(item.id);
    inactiveRows.push(row(number, 50));
  }
  const priorActive = await prisma.financialReceivable.create({ data: { uploadId: oldUploadId, companyName: "Focus Media", companyCode: "FOCUS_MEDIA", clientId, clientName: "Synthetic Invoice Fixture SRL", invoiceNumber: `${series}89`, normalizedInvoiceNumber: `${series}89`.toLowerCase(), invoiceDate: new Date("2026-11-01Z"), dueDate: new Date("2026-12-01Z"), currency: "RON", invoicedAmount: "50", collectedAmount: "0", remainingAmount: "50", includedInReport: true, needsReview: false, status: "in_term" } });
  invoiceIds.push(priorActive.id);
  const negativeSource = row(`${series}02`, -200);
  negativeSource[13] = `Storno ${series}01`;
  const rows = [row(`${series}01`, 1000), negativeSource, row(`${series}03`, 100, "incasata"), ...inactiveRows, row(`${series}89`, 50)];
  const first = await confirm(rows);
  assert.equal(first.preview.rows.filter((r: any) => r.proposedAction === "DUPLICATE").length, 4, "Inactive records and older-upload existing invoices must never be recreated");
  const original = await prisma.financialReceivable.findFirstOrThrow({ where: { companyCode: "FOCUS_MEDIA", invoiceNumber: `${series}01` } });
  const negative = await prisma.financialReceivable.findFirstOrThrow({ where: { companyCode: "FOCUS_MEDIA", invoiceNumber: `${series}02` } });
  const paidLabel = await prisma.financialReceivable.findFirstOrThrow({ where: { companyCode: "FOCUS_MEDIA", invoiceNumber: `${series}03` } });
  invoiceIds.push(original.id, negative.id, paidLabel.id);
  assert.equal(receivableNetAmount(original.invoicedAmount, original.rawRowJson).toFixed(2), "800.00");
  assert.equal(original.remainingAmount?.toFixed(2), "800.00");
  assert.equal(paidLabel.collectedAmount?.toFixed(2), "0.00", "Source paid-status snapshot is not a cash movement");
  assert.equal(paidLabel.collectedAt, null, "No actual receipt date can be inferred from invoice issue/due date");
  assert.equal(negative.collectedAt, null, "Noncash negative adjustment must not claim a cash receipt date");
  assert.equal(await prisma.financialReceivablePayment.count({ where: { receivableId: paidLabel.id } }), 0);
  const actorSession = { ...actor, sessionId: session.id } as any;
  await recordReceivablePayment({ receivableId: original.id, amount: "100", receivedAt: new Date("2026-11-02Z"), requestKey: `${tag}-cash`, actor: actorSession });
  await prisma.financialReceivable.update({ where: { id: original.id }, data: { rawRowJson: { ...(original.rawRowJson as Prisma.JsonObject), fiscalTaxSplitAttestation: { fixture: true }, ledgerProvenance: { fixture: true } } } });
  await attestInvoiceTaxSplit({ receivableId: original.id, netAmount: "850", vatAmount: "150", evidenceReference: "synthetic-source-fiscal-proof", actor: actorSession });
  const fiscalAttestationBefore = (await prisma.financialReceivable.findUniqueOrThrow({ where: { id: original.id } })).rawRowJson as any;
  const paymentsBefore = await prisma.financialReceivablePayment.findMany({ where: { receivableId: original.id }, orderBy: { id: "asc" } });
  for (let index = 0; index < 2; index++) {
    await confirm(rows);
    const after = await prisma.financialReceivable.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(receivableNetAmount(after.invoicedAmount, after.rawRowJson).toFixed(2), "800.00");
    assert.equal(after.remainingAmount?.toFixed(2), "700.00");
    assert.equal(after.collectedAmount?.toFixed(2), "100.00");
    assert.equal(receivableAdjustmentEntries(after.rawRowJson).length, 1, "Existing negative duplicate remains skipped without erasing its parent link");
    assert.deepEqual((after.rawRowJson as any).fiscalTaxSplitAttestation, fiscalAttestationBefore.fiscalTaxSplitAttestation);
    assert.deepEqual((after.rawRowJson as any).ledgerProvenance, { fixture: true });
    assert.equal(after.netAmount?.toFixed(2), "850.00", "Human-attested net/VAT split survives source refresh");
    assert.equal(after.vatAmount?.toFixed(2), "150.00");
    assert.equal(after.needsReview, true, "Source fiscal disagreement is visible for review");
    assert.deepEqual(await prisma.financialReceivablePayment.findMany({ where: { receivableId: original.id }, orderBy: { id: "asc" } }), paymentsBefore);
    if (index === 0) await prisma.auditLog.deleteMany({ where: { userId: actorId, entityId: original.id, action: "financial.invoice_tax_split_attested" } });
  }
  await attestInvoiceTaxSplit({ receivableId: original.id, netAmount: "850", vatAmount: "150", evidenceReference: "synthetic-explicit-fiscal-review", actor: actorSession });
  const reviewed = await prisma.financialReceivable.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(reviewed.needsReview, false, "Explicit human fiscal review can resolve the source discrepancy");
  assert.equal((reviewed.rawRowJson as any).sourceFiscalReview, null);
  assert.equal(receivableAdjustmentEntries(reviewed.rawRowJson).length, 1);
  assert.deepEqual(await prisma.financialReceivablePayment.findMany({ where: { receivableId: original.id }, orderBy: { id: "asc" } }), paymentsBefore);
  const extraNegative = row(`${series}04`, -50);
  extraNegative[13] = `Storno ${series}01`;
  await confirm([...rows, extraNegative], { documentNumber: `${series}04`, linkedFinancialRowId: original.id });
  const extraAdjustment = await prisma.financialReceivable.findFirstOrThrow({ where: { companyCode: "FOCUS_MEDIA", invoiceNumber: `${series}04` } });
  invoiceIds.push(extraAdjustment.id);
  const afterAdditionalAdjustment = await prisma.financialReceivable.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(receivableAdjustmentEntries(afterAdditionalAdjustment.rawRowJson).length, 2);
  assert.equal(receivableNetAmount(afterAdditionalAdjustment.invoicedAmount, afterAdditionalAdjustment.rawRowJson).toFixed(2), "750.00");
  assert.equal((afterAdditionalAdjustment.rawRowJson as any).sourceFiscalReview.status, "open", "A new adjustment must append to fresh metadata written by the positive refresh in the same import");
  assert.equal(afterAdditionalAdjustment.needsReview, true);
  assert.deepEqual(await prisma.financialReceivablePayment.findMany({ where: { receivableId: original.id }, orderBy: { id: "asc" } }), paymentsBefore);
  for (const [index, state] of inactiveStates.entries()) {
    const record = await prisma.financialReceivable.findUniqueOrThrow({ where: { id: invoiceIds[index] } });
    assert.equal(record.status, state.status);
    assert.equal(record.includedInReport, state.includedInReport);
    assert.equal(await prisma.financialReceivable.count({ where: { companyCode: "FOCUS_MEDIA", invoiceNumber: record.invoiceNumber } }), 1);
  }
  assert.equal(await prisma.financialReceivable.count({ where: { companyCode: "FOCUS_MEDIA", invoiceNumber: `${series}02` } }), 1);
  const scope = await currentFinancialReportScope();
  assert.ok(scope.uploadIds.includes(original.uploadId), "Confirmed SmartBill imports remain visible independently of an older active legacy report");
  console.log(JSON.stringify({ ok: true, syntheticOnly: true, scenario: "smartbill-reimport-ledger", originalGross: "1000.00", adjustment: "200.00", netBeforeAfter: "800.00", activeCashBeforeAfter: "100.00", remainingBeforeAfter: "700.00", repeatImports: 2, inactiveDocumentsPreserved: 3, olderUploadInvoicePreserved: 1, fiscalAttestationPreserved: true, additionalStornoPreservesFreshFiscalReview: true, paidSnapshotCreatesNoCashOrDate: true }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await prisma.financialReceivablePayment.deleteMany({ where: { receivableId: { in: invoiceIds } } });
  await prisma.financialClientCredit.deleteMany({ where: { receivableId: { in: invoiceIds } } });
  await prisma.financialReceivable.deleteMany({ where: { id: { in: invoiceIds } } });
  await prisma.financialReportUpload.deleteMany({ where: { originalFileName: { startsWith: tag } } });
  await prisma.financialPartnerRole.deleteMany({ where: { clientId } });
  await prisma.financialPartner.deleteMany({ where: { taxIdNormalized: taxId } });
  await prisma.clientAccount.deleteMany({ where: { id: clientId } });
  await prisma.auditLog.deleteMany({ where: { userId: actorId } });
  await prisma.user.deleteMany({ where: { id: actorId } });
  await prisma.$disconnect();
}).catch(error => { console.error(error); process.exitCode = 1; });
