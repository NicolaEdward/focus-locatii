const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

const {
  assertReceivablePaymentStatus,
  calculateReceivablePayment,
  matchingFinancialIssueIds,
  resolveFinancialRowEdit,
  validateReceivableDuplicateMerge
} = loadTsModule(path.join(process.cwd(), "src", "lib", "financial-integrity.ts"), {
  "@/lib/prisma": { prisma: {} }
});

const futureDueDate = new Date();
futureDueDate.setUTCDate(futureDueDate.getUTCDate() + 30);
futureDueDate.setUTCHours(0, 0, 0, 0);

const excludedPreserved = resolveFinancialRowEdit({
  kind: "receivable",
  existingIncludedInReport: false,
  existingStatus: "excluded",
  existingAmount: 100,
  existingPaidOrCollected: 0,
  existingRemaining: 100,
  currency: "RON"
});
assert.equal(excludedPreserved.includeInReport, false, "excluded row remains excluded when includeInReport is omitted");
assert.equal(excludedPreserved.status, "excluded", "excluded status is preserved when includeInReport is omitted");

const explicitReinclude = resolveFinancialRowEdit({
  kind: "receivable",
  existingIncludedInReport: false,
  existingStatus: "excluded",
  existingAmount: 100,
  existingPaidOrCollected: 0,
  existingRemaining: 100,
  includeInReport: true,
  dueDate: futureDueDate,
  currency: "RON"
});
assert.equal(explicitReinclude.includeInReport, true, "explicit re-include works only when includeInReport is true");
assert.equal(explicitReinclude.status, "in_term", "re-included row gets derived active status");

const amountEdit = resolveFinancialRowEdit({
  kind: "receivable",
  existingIncludedInReport: true,
  existingStatus: "in_term",
  existingAmount: 100,
  existingPaidOrCollected: 20,
  existingRemaining: 80,
  amount: 150,
  existingDueDate: futureDueDate,
  currency: "RON"
});
assert.equal(amountEdit.remaining, 130, "amount edit recomputes remaining");

const collectedEdit = resolveFinancialRowEdit({
  kind: "receivable",
  existingIncludedInReport: true,
  existingStatus: "in_term",
  existingAmount: 150,
  existingPaidOrCollected: 20,
  existingRemaining: 130,
  paidOrCollected: 60,
  existingDueDate: futureDueDate,
  currency: "RON"
});
assert.equal(collectedEdit.remaining, 90, "paid/collected edit recomputes remaining");

assert.throws(
  () => resolveFinancialRowEdit({
    kind: "payable",
    existingIncludedInReport: true,
    existingStatus: "in_term",
    existingAmount: 100,
    existingPaidOrCollected: 0,
    existingRemaining: 100,
    status: "whatever",
    currency: "RON"
  }),
  /Status financiar invalid/,
  "invalid status is rejected"
);

const rowIdentity = {
  uploadId: "upload-1",
  companyCode: "FOCUS_MEDIA",
  companyName: "Focus Media",
  rawRowJson: { rowNumber: 10, sheetName: "Focus", invoicedAmount: "100", clientName: "Client A" }
};
const issueIds = matchingFinancialIssueIds(rowIdentity, [
  issue("issue-focus", "upload-1", "FOCUS_MEDIA", "Focus Media", "Focus", 10, { sheetName: "Focus", invoicedAmount: "100" }),
  issue("issue-bg", "upload-1", "FOCUS_BG", "Focus BG", "Focus BG", 10, { sheetName: "Focus BG", invoicedAmount: "100" })
]);
assert.deepEqual(issueIds, ["issue-focus"], "duplicate row numbers in other sheets/companies do not resolve the wrong issue");

assert.throws(
  () => calculateReceivablePayment({ invoiceAmount: 100, previousCollected: 80, paymentAmount: 30, mode: "add", dueDate: futureDueDate }),
  /nu poate depasi/,
  "overpayment rejected"
);
const partialPayment = calculateReceivablePayment({ invoiceAmount: 100, previousCollected: 20, paymentAmount: 30, mode: "add", dueDate: futureDueDate });
assert.equal(partialPayment.collected, 50, "partial payment updates collected amount");
assert.equal(partialPayment.remaining, 50, "partial payment recomputes remaining");
assert.equal(partialPayment.status, "collected_partial", "partial payment status derived");
const fullPayment = calculateReceivablePayment({ invoiceAmount: 100, previousCollected: 20, paymentAmount: 100, mode: "set", dueDate: futureDueDate });
assert.equal(fullPayment.remaining, 0, "full payment remaining becomes zero");
assert.equal(fullPayment.status, "collected", "full payment status derived");
assert.throws(
  () => calculateReceivablePayment({ invoiceAmount: 100, previousCollected: 20, paymentAmount: -1, mode: "add", dueDate: futureDueDate }),
  /negativa/,
  "negative payment rejected"
);
assert.throws(() => assertReceivablePaymentStatus("nonsense"), /Status financiar invalid/, "invalid payment row status rejected");

const duplicateA = receivable({ id: "a" });
const duplicateB = receivable({ id: "b" });
assert.doesNotThrow(() => validateReceivableDuplicateMerge(duplicateA, duplicateB), "true duplicate merge accepted");
assert.throws(
  () => validateReceivableDuplicateMerge(duplicateA, receivable({ id: "c", clientId: "client-2", clientName: "Other Client" })),
  /clienti diferiti/,
  "same invoice number but different client rejected"
);
assert.throws(
  () => validateReceivableDuplicateMerge(duplicateA, receivable({ id: "d", currency: "EUR" })),
  /monede diferite/,
  "same invoice number but different currency rejected"
);
assert.throws(
  () => validateReceivableDuplicateMerge(duplicateA, receivable({ id: "e", normalizedInvoiceNumber: "other" })),
  /numar de factura/,
  "unrelated invoice merge rejected"
);

const rowRoute = read("src", "app", "api", "admin", "financial", "rows", "[kind]", "[id]", "route.ts");
const paymentRoute = read("src", "app", "api", "admin", "receivables", "[id]", "payment", "route.ts");
const paymentService = read("src", "lib", "receivables-payment-service.ts");
const mergeRoute = read("src", "app", "api", "admin", "receivables", "merge", "route.ts");
assert(rowRoute.includes("matchingFinancialIssueIds"), "row edit route must use stable issue matching");
assert(rowRoute.includes("where: { id: { in: issueIds }, resolvedAt: null }"), "row edit route must resolve only matched issue ids");
assert(!/financialImportIssue\.updateMany\(\{\s*where:\s*\{\s*uploadId:\s*row\.uploadId,\s*rowNumber/s.test(rowRoute), "row edit route must not update issues by rowNumber alone");
assert(paymentRoute.includes(".strict()"), "payment route must reject unexpected status/body fields");
assert(paymentRoute.includes("recordReceivablePayment"), "payment route must use the canonical payment ledger");
assert(paymentService.includes("auditLog.create"), "payment update must write audit");
assert(paymentService.includes("prisma.$transaction"), "payment update must be transactional");
assert(paymentService.includes("financialReceivablePayment.create"), "payment update must create an immutable ledger entry");
assert(mergeRoute.includes("validateReceivableDuplicateMerge(primary, duplicate)"), "merge route must validate duplicates before archiving");
assert(mergeRoute.includes("prisma.$transaction"), "merge route must archive transactionally");
assert(mergeRoute.includes("recordAudit"), "successful merge must write audit");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "excluded row remains excluded when includeInReport omitted",
    "explicit re-include works",
    "amount and payment edits recompute remaining",
    "invalid financial status rejected",
    "import issue resolution uses stable row identity",
    "overpayment and negative payment rejected",
    "partial/full payment status derived",
    "duplicate merge validation rejects unrelated invoices"
  ]
}, null, 2));

function issue(id, uploadId, companyCode, companyName, sheetName, rowNumber, rawRowJson) {
  return { id, uploadId, companyCode, companyName, sheetName, rowNumber, rawRowJson, resolvedAt: null };
}

function receivable(overrides = {}) {
  return {
    id: "receivable",
    uploadId: "upload-1",
    companyCode: "FOCUS_MEDIA",
    companyName: "Focus Media",
    normalizedInvoiceNumber: "fm123",
    invoiceNumber: "FM 123",
    clientId: "client-1",
    clientName: "Client A",
    currency: "RON",
    invoicedAmount: 100,
    invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides
  };
}

function read(...parts) {
  return fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
}
