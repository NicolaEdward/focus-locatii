import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { classifyBankTransaction, createBankImportToken, parseBankStatement, parseBcrGeorgeStatement, parseBankMoney, parseRevolutStatement, verifyBankImportToken } from "../src/lib/bcr-george-import";
import { scoreReconciliationCandidate } from "../src/lib/financial-reconciliation";
import { immediatePaymentRuleApplies } from "../src/lib/payables-payment-service";
import { receivableAdjustmentEntries, receivableAdjustmentTotal, receivableNetAmount, receivableNetRemaining } from "../src/lib/receivable-adjustments";
import {
  assertSmartBillCompanyMatchesReport,
  findSmartBillDocumentConflict,
  findSmartBillDuplicate,
  matchSmartBillEntity,
  parseSmartBillCustomerInvoices,
  parseSmartBillSupplierDocuments
} from "../src/lib/smartbill-import";

assert.equal(parseBankMoney("41,377.33"), "41377.33");
assert.equal(parseBankMoney("1.234,56"), "1234.56");
assert.throws(() => parseBankMoney("1e12"), /invalida/);

const bankClassificationBase = {
  debitAmount: "0.00",
  creditAmount: "1000.00",
  description: "Transfer bancar",
  currentTaxId: "40766474",
  currentCompanyCode: "FOCUS_MEDIA"
};
assert.equal(classifyBankTransaction({
  ...bankClassificationBase,
  payerName: "FOCUS MEDIA OUTDOOR S.R.L.",
  paymentDetails: "Fonduri proprii"
}), "internal_transfer", "Transferul Revolut-BCR al aceleiasi firme este informativ.");
assert.equal(classifyBankTransaction({
  ...bankClassificationBase,
  payerName: "EXCELLENCE MEDIA PRODUCTION S.R.L.",
  paymentDetails: "Ctr imprumut"
}), "intercompany_transfer", "Imprumutul intre firmele grupului este transfer intercompany.");
assert.equal(classifyBankTransaction({
  ...bankClassificationBase,
  payerName: null,
  description: "Virament automat din cont RO00TEST pentru recuperare creante restante produs RO00DEST"
}), "internal_transfer", "Viramentul automat intre subconturile bancii nu cere reconciliere comerciala.");
assert.equal(classifyBankTransaction({
  ...bankClassificationBase,
  debitAmount: "2500.00",
  creditAmount: "0.00",
  beneficiaryName: "PERSOANA TEST",
  paymentDetails: "Dr autor"
}), "copyright_payment", "Abrevierea uzuala dr autor este clasificata CDA.");
assert.equal(classifyBankTransaction({
  ...bankClassificationBase,
  debitAmount: "2500.00",
  creditAmount: "0.00",
  beneficiaryName: "FIRMA EXTERNA SRL",
  paymentDetails: "Ctr imprumut"
}), "supplier_payment_candidate", "Un imprumut extern nu este declarat automat transfer intre firmele grupului.");
assert.equal(classifyBankTransaction({
  ...bankClassificationBase,
  debitAmount: "100.00",
  creditAmount: "0.00",
  transactionType: "card",
  description: "Apple Pay, Tranzactie comerciant. Comision: 0 RON"
}), "card_purchase", "Textul Comision: 0 dintr-o plata cu cardul nu transforma plata in comision bancar.");

const adjustmentMetadata = { smartBillAdjustments: [
  { adjustmentReceivableId: "storno-1", adjustmentAmount: "119.00" },
  { adjustmentReceivableId: "storno-1", adjustmentAmount: "119.00" },
  { adjustmentReceivableId: "discount-1", adjustmentAmount: "50.00" }
] };
assert.equal(receivableAdjustmentTotal(adjustmentMetadata).toFixed(2), "169.00", "Aceeași ajustare nu se aplică de două ori.");
assert.deepEqual(receivableAdjustmentEntries(adjustmentMetadata).map((entry) => entry.receivableId), ["storno-1", "discount-1"]);
assert.equal(receivableNetAmount("1000.00", adjustmentMetadata).toFixed(2), "831.00");
assert.equal(receivableNetRemaining({ invoicedAmount: "1000.00", collectedAmount: "800.00", rawRowJson: adjustmentMetadata }).toFixed(2), "31.00");

const score = scoreReconciliationCandidate({
  transaction: {
    amount: "119.00",
    bookedAt: new Date("2026-08-20T09:00:00Z"),
    paymentDetails: "Plata factura EMP0388",
    payerTaxId: "RO12345678",
    payerName: "CLIENT TEST SRL"
  },
  candidate: {
    amountRemaining: "119.00",
    invoiceNumber: "EMP0388",
    issueDate: new Date("2026-08-19T00:00:00Z"),
    taxId: "12345678",
    partnerName: "CLIENT TEST SRL"
  },
  direction: "receivable"
});
assert.ok(score.score >= 140);
assert.deepEqual(new Set(score.reasons), new Set(["invoice_number_exact", "tax_id_exact", "amount_exact", "partner_name_match", "date_within_3_days"]));

const amountOnly = scoreReconciliationCandidate({
  transaction: { amount: "119.00", bookedAt: new Date("2026-08-20T09:00:00Z") },
  candidate: { amountRemaining: "119.00" },
  direction: "payable"
});
assert.equal(amountOnly.score, 30, "Suma singura nu poate produce auto-match.");

const baseRule = {
  ruleMode: "presume_paid_if_immediate",
  documentType: null,
  supplierCategory: null,
  requireSameDayDueDate: true,
  maxDueDays: 0,
  amountLimit: null as Prisma.Decimal | null
};
assert.equal(immediatePaymentRuleApplies(baseRule, {
  documentType: "unknown", documentDescription: "Wolt", invoiceDate: new Date("2026-07-04"), dueDate: new Date("2026-07-04"), amountToPay: new Prisma.Decimal("85.50")
}), true);
assert.equal(immediatePaymentRuleApplies(baseRule, {
  documentType: "invoice", documentDescription: "Factura lunara flota", invoiceDate: new Date("2026-07-01"), dueDate: new Date("2026-07-16"), amountToPay: new Prisma.Decimal("5000")
}), false, "Factura periodica de combustibil cu termen viitor ramane neachitata.");
assert.equal(immediatePaymentRuleApplies({ ...baseRule, ruleMode: "never_auto" }, {
  documentType: "receipt", documentDescription: "Retail", invoiceDate: new Date("2026-07-04"), dueDate: new Date("2026-07-04"), amountToPay: new Prisma.Decimal("20")
}), false);

const downloads = path.join(process.env.USERPROFILE || "", "Downloads");
const supplierFile = path.join(downloads, "Raport_document_furnizori_20_08_2026.xls");
const issuedFile = path.join(downloads, "Facturi_20_08_2026.xls");
const bankFile = path.join(downloads, "20260820903249.csv");
const revolutFile = path.join(downloads, "account-statement_01-Jan-2026_20-Aug-2026 (1).csv");

async function runFixtureTests() {
if (fs.existsSync(supplierFile)) {
  const parsed = await parseSmartBillSupplierDocuments(fs.readFileSync(supplierFile), { fileName: path.basename(supplierFile) });
  assert.equal(parsed.headerRow, 7);
  assert.equal(parsed.detectedCompanyCode, "FOCUS_MEDIA");
  assert.equal(parsed.detectedCompanyTaxId, "40766474");
  assert.doesNotThrow(() => assertSmartBillCompanyMatchesReport(parsed, { companyName: "Focus Media", companyCode: "FOCUS_MEDIA" }));
  assert.throws(() => assertSmartBillCompanyMatchesReport(parsed, { companyName: "Excellence Media", companyCode: "EXCELLENCE_MEDIA" }), /nu corespunde emitentului/i);
  assert.equal(parsed.rows.length, 81);
  assert.equal(parsed.rows.filter((row) => !row.issues.length).length, 81);
  assert.equal(new Set(parsed.rows.map((row) => row.normalizedFiscalCode || (row.kind === "supplier_document" ? row.supplierName : ""))).size, 37);
  assert.equal(parsed.rows.every((row) => row.kind === "supplier_document" && typeof row.documentNumber === "string"), true);
  assert.equal(parsed.rows.every((row) => row.sourceStatus === "Nesalvata"), true);
  assert.equal(parsed.rows.every((row) => row.status !== "paid"), true);
}

if (fs.existsSync(issuedFile)) {
  const parsed = await parseSmartBillCustomerInvoices(fs.readFileSync(issuedFile), { fileName: path.basename(issuedFile) });
  assert.equal(parsed.headerRow, 4);
  assert.equal(parsed.detectedCompanyCode, null, "Raportul emis fara identitatea firmei necesita selectare manuala.");
  assert.equal(parsed.rows.length, 15, "Randul de total nu este factura.");
  assert.equal(parsed.rows.filter((row) => !row.issues.length).length, 15);
  assert.equal(parsed.rows.every((row) => row.kind === "customer_invoice" && typeof row.spvIndex === "string"), true);
  assert.equal(parsed.rows.every((row) => row.status !== "collected"), true, "Statusul SmartBill nu suprascrie registrul de incasari.");
  const first = parsed.rows.find((row) => row.kind === "customer_invoice")!;
  const sameDocument = {
    id: "existing-same-client",
    companyCode: "FOCUS_MEDIA",
    invoiceNumber: first.invoiceNumber,
    invoiceDate: first.issueDate,
    currency: first.currency,
    amount: first.totalAmount,
    entityTaxId: first.normalizedFiscalCode,
    includedInReport: true,
    status: "in_term"
  };
  assert.equal(findSmartBillDuplicate(first, [sameDocument], { companyName: "Focus Media", companyCode: "FOCUS_MEDIA" })?.id, sameDocument.id);
  const otherClient = { ...sameDocument, id: "existing-other-client", entityTaxId: "99999999" };
  assert.equal(findSmartBillDuplicate(first, [otherClient], { companyName: "Focus Media", companyCode: "FOCUS_MEDIA" }), null, "Acelasi numar pe alt client nu este ascuns ca duplicat.");
  assert.equal(findSmartBillDocumentConflict(first, [otherClient], { companyName: "Focus Media", companyCode: "FOCUS_MEDIA" })?.id, otherClient.id);
  assert.equal(matchSmartBillEntity(first, [{ id: "wrong-cif", name: first.clientName, taxId: "99999999" }]).kind, "ambiguous", "Numele identic nu poate ocoli un CIF diferit.");
}

if (fs.existsSync(bankFile)) {
  const parsed = parseBcrGeorgeStatement(fs.readFileSync(bankFile), path.basename(bankFile));
  assert.equal(parsed.detectedColumns.length, 22);
  assert.equal(parsed.rows.length, 26);
  assert.equal(parsed.companyCode, "EXCELLENCE_MEDIA");
  assert.ok(parsed.rows.some((row) => row.debitAmount === "41377.33"));
  assert.ok(parsed.rows.some((row) => row.classification === "internal_transfer"));
  assert.ok(parsed.rows.some((row) => row.classification === "bank_fee"));
  assert.ok(parsed.rows.some((row) => row.classification === "tax_payment"));
  assert.ok(parsed.rows.some((row) => row.classification === "card_purchase"));
  assert.equal(new Set(parsed.rows.map((row) => row.fingerprint)).size, 26);
  const references = parsed.rows.reduce((map, row) => {
    if (row.documentReference) map.set(row.documentReference, [...(map.get(row.documentReference) || []), row]);
    return map;
  }, new Map<string, typeof parsed.rows>());
  const repeatedReference = [...references.values()].find((rows) => rows.length > 1);
  assert.ok(repeatedReference, "Fisierul real pastreaza plata si comisionul cu aceeasi referinta.");
  assert.equal(new Set(repeatedReference!.map((row) => row.fingerprint)).size, repeatedReference!.length);
  assert.throws(() => parseBcrGeorgeStatement(fs.readFileSync(bankFile), path.basename(bankFile), "FOCUS_MEDIA"), /nu corespunde titularului/i);
}

if (fs.existsSync(revolutFile)) {
  const source = fs.readFileSync(revolutFile);
  assert.throws(() => parseBankStatement(source, path.basename(revolutFile)), /selecteaz[aă] entitatea/i);
  const parsed = parseRevolutStatement(source, path.basename(revolutFile), "FOCUS_MEDIA");
  const token = createBankImportToken(parsed);
  const verified = verifyBankImportToken(token);
  assert.ok(token.startsWith("v2."), "bank preview token should use the compressed envelope");
  assert.ok(token.length < JSON.stringify(parsed).length, "compressed token should be smaller than the raw preview");
  assert.equal(verified.rows.length, parsed.rows.length, "compressed token must preserve all bank rows");
  assert.equal(parsed.bankProvider, "revolut");
  assert.equal(parsed.sourceRowCount, 332);
  assert.equal(parsed.rows.length, 333, "Comisionul de procesare inclus în total este separat de transferul principal.");
  assert.deepEqual(parsed.accounts.map((account) => [account.label, account.currency, account.rowCount]), [["EUR Main", "EUR", 7], ["RON Main", "RON", 326]]);
  assert.equal(new Set(parsed.rows.map((row) => row.fingerprint)).size, 333);
  const counts = parsed.rows.reduce<Record<string, number>>((result, row) => {
    result[row.classification] = (result[row.classification] || 0) + 1;
    return result;
  }, {});
  assert.equal(counts.bank_fee, 6);
  assert.equal(counts.supplier_payment_candidate, 96);
  assert.equal(counts.internal_transfer, 34);
  assert.equal(counts.intercompany_transfer, 14);
  assert.equal(counts.payroll_payment, 2);
  assert.equal(counts.employee_payment, 2);
  assert.equal(counts.dividend_payment, 1);
  assert.equal(counts.copyright_payment, 35);
  const eurTransfer = parsed.rows.find((row) => row.currency === "EUR" && row.debitAmount === "2020.00");
  const processingFee = parsed.rows.find((row) => row.currency === "EUR" && row.classification === "bank_fee" && row.debitAmount === "23.56");
  assert.ok(eurTransfer, "Transferul EUR păstrează suma comercială fără comision.");
  assert.ok(processingFee, "Comisionul de procesare este o mișcare ignorată distinctă.");
  assert.equal(parsed.accounts.every((account) => account.periodStart.toISOString().slice(0, 10) === "2026-01-01"), true);
  assert.equal(parsed.accounts.every((account) => account.periodEnd.toISOString().slice(0, 10) === "2026-08-20"), true);
}
}

const repoRoot = process.cwd();
const schemaSource = fs.readFileSync(path.join(repoRoot, "prisma/schema.prisma"), "utf8");
const mutationSource = fs.readFileSync(path.join(repoRoot, "src/lib/financial-reconciliation-mutations.ts"), "utf8");
const receivablePaymentSource = fs.readFileSync(path.join(repoRoot, "src/lib/receivables-payment-service.ts"), "utf8");
const previewSource = fs.readFileSync(path.join(repoRoot, "src/app/api/admin/financial/bank-statements/preview/route.ts"), "utf8");
const bankConfirmSource = fs.readFileSync(path.join(repoRoot, "src/app/api/admin/financial/bank-statements/confirm/route.ts"), "utf8");
const importWorkspaceSource = fs.readFileSync(path.join(repoRoot, "src/components/admin/FinancialImportWorkspace.tsx"), "utf8");
const reconciliationWorkspaceSource = fs.readFileSync(path.join(repoRoot, "src/components/admin/FinancialReconciliationWorkspace.tsx"), "utf8");
const reconciliationSource = fs.readFileSync(path.join(repoRoot, "src/lib/financial-reconciliation.ts"), "utf8");
const reclassificationSource = fs.readFileSync(path.join(repoRoot, "scripts/reclassify-bank-transactions.ts"), "utf8");
const smartBillConfirmSource = fs.readFileSync(path.join(repoRoot, "src/app/api/admin/financial/smartbill/confirm/route.ts"), "utf8");
const migrationSource = fs.readFileSync(
  path.join(repoRoot, "prisma/migrations/20260820090000_financial_bank_reconciliation/migration.sql"),
  "utf8",
);
assert.match(schemaSource, /model FinancialBankStatement/);
assert.match(schemaSource, /model FinancialBankTransaction/);
assert.match(schemaSource, /model FinancialPartnerRole/);
assert.match(schemaSource, /model FinancialPayablePayment/);
assert.match(schemaSource, /model SupplierPaymentRule/);
assert.match(schemaSource, /sourceFingerprint\s+String\?\s+@unique/);
assert.match(mutationSource, /document\.legalEntityId !== transaction\.legalEntityId/);
assert.match(mutationSource, /document\.currency !== transaction\.currency/);
assert.match(mutationSource, /Serializable/);
assert.match(mutationSource, /supersedePresumedPayablePayments/);
assert.match(receivablePaymentSource, /receivableNetAmount\(receivable\.invoicedAmount, receivable\.rawRowJson\)/);
assert.match(receivablePaymentSource, /synchronizeAdjustmentCredits/);
assert.equal(/recordAudit|auditLog\.(create|update)/.test(previewSource), false, "Preview-ul bancar nu scrie audit sau date de business.");
assert.match(previewSource, /parseBankStatement/);
assert.match(bankConfirmSource, /RevolutBusinessStatementImporter/);
assert.match(bankConfirmSource, /excludedBankClassification\(row\.classification\)/);
assert.match(importWorkspaceSource, /Revolut Business/);
assert.match(importWorkspaceSource, /Transfer între conturi proprii/);
assert.match(importWorkspaceSource, /Drepturi de autor \(CDA\)/);
assert.match(importWorkspaceSource, /Leagă storno la factură/);
assert.match(importWorkspaceSource, /linkedFinancialRowId/);
assert.match(reconciliationWorkspaceSource, /Plăți și încasări de alocat/);
assert.match(reconciliationWorkspaceSource, /ignored: "informativă"/);
assert.match(reconciliationSource, /classification: \{ notIn: \[\.\.\.INFORMATIONAL_BANK_CLASSIFICATIONS\] \}/);
assert.match(reclassificationSource, /receivablePayments: \{ none: \{ status: ACTIVE \} \}/);
assert.match(reclassificationSource, /payablePayments: \{ none: \{ status: ACTIVE \} \}/);
assert.match(reclassificationSource, /financial\.bank_transaction_auto_classified/);
const receivableSourceUpdate = smartBillConfirmSource.split("function smartBillReceivableUpdateData")[1]?.split("function smartBillPayableUpdateData")[0] || "";
const payableSourceUpdate = smartBillConfirmSource.split("function smartBillPayableUpdateData")[1]?.split("function inferReportDate")[0] || "";
assert.doesNotMatch(receivableSourceUpdate, /collectedAmount|remainingAmount|collectedAt|status:/, "Reimportul SmartBill nu poate rescrie registrul de încasări.");
assert.doesNotMatch(payableSourceUpdate, /amountPaid|remainingAmount|paidAt|status:/, "Reimportul SmartBill nu poate rescrie registrul de plăți.");
assert.match(smartBillConfirmSource, /bootstrapLegacyReceivablePayment\(tx, updated, session\.id\)[\s\S]*synchronizeReceivableLedger\(tx, updated\.id\)/);
assert.match(smartBillConfirmSource, /bootstrapLegacyPayablePayment\(tx, updated, session\.id\)[\s\S]*synchronizePayableLedger\(tx, updated\.id\)/);
assert.doesNotMatch(
  migrationSource,
  /DEFAULT CHARACTER SET|COLLATE\s+/i,
  "Tabelele financiare noi trebuie sa mosteneasca charset-ul si collation-ul bazei existente.",
);

runFixtureTests().then(() => console.log("Financial bank reconciliation tests passed."));
