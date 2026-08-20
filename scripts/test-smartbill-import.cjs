const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");
const { loadTsModule } = require("./load-ts-module.cjs");

const repoRoot = process.cwd();
const smartbill = loadTsModule(path.join(repoRoot, "src/lib/smartbill-import.ts"), {
  "@/lib/clients": {
    normalizeClientName(value) {
      return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\b(s\.?r\.?l\.?|s\.?a\.?|ltd|llc|eood|srl|sa)\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
    },
    normalizeInvoiceNumber(value) {
      return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\b(factura|fact|nr|numar|number|invoice|inv)\b/g, "")
        .replace(/[^a-z0-9]+/g, "")
        .trim();
    }
  },
  "@/lib/company-entities": {
    companyEntities: [
      { value: "Focus Media", label: "Focus Media", code: "FOCUS_MEDIA" },
      { value: "Excellence Media", label: "Excellence Media", code: "EXCELLENCE_MEDIA" },
      { value: "Focus BG / Focus Media LLC EOOD", label: "Focus BG / Focus Media LLC EOOD", code: "FOCUS_BG" }
    ],
    companyEntityOrThrow(value) {
      const normalized = String(value || "").trim().toLowerCase();
      if (normalized === "focus media" || normalized === "focus") return "Focus Media";
      if (normalized === "excellence media" || normalized === "excellence") return "Excellence Media";
      if (normalized === "focus bg / focus media llc eood" || normalized === "focus bg") return "Focus BG / Focus Media LLC EOOD";
      throw new Error("Firma contractanta trebuie aleasa din lista.");
    },
    companyCodeForEntity(value) {
      if (value === "Focus Media") return "FOCUS_MEDIA";
      if (value === "Excellence Media") return "EXCELLENCE_MEDIA";
      if (value === "Focus BG / Focus Media LLC EOOD") return "FOCUS_BG";
      return null;
    }
  },
  "@/lib/financial-review": {
    financialStatus({ kind, remainingAmount, paidOrCollected, dueDate, now = new Date("2026-06-29T00:00:00.000Z"), soonDays = 7 }) {
      const remaining = Number(remainingAmount || 0);
      const paid = Number(paidOrCollected || 0);
      if (remaining <= 0) return kind === "payable" ? "paid" : "collected";
      if (!dueDate) return "needs_review";
      const due = new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate()));
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      if (due < today) return "overdue";
      if (due.getTime() === today.getTime()) return "due_today";
      if (Math.ceil((due.getTime() - today.getTime()) / 86400000) <= soonDays) return "due_soon";
      if (paid > 0) return kind === "payable" ? "paid_partial" : "collected_partial";
      return "in_term";
    }
  },
  "@/lib/money": {
    roundMoney(value) {
      return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    }
  }
});

const focusCompany = smartbill.resolveSmartBillCompanyContext("Focus Media");
const excellenceCompany = smartbill.resolveSmartBillCompanyContext("Excellence Media");
assert.equal(focusCompany.companyCode, "FOCUS_MEDIA");
assert.equal(excellenceCompany.companyCode, "EXCELLENCE_MEDIA");
assert.throws(() => smartbill.resolveSmartBillCompanyContext(""), /Firma contractanta|trebuie aleasa/);

function workbookBuffer(rows, sheetName = "Sheet1") {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

function customerWorkbook() {
  return workbookBuffer([
    [null, "Facturi incepand din data de 01/05/2026 pana in data de 31/05/2026"],
    [null, "*raportul nu include documentele anulate si ciornele"],
    ["Nr. crt.", "Client", "CIF", "Adresa", "Factura", "Data emiterii", "Data scadentei", "Status", "Moneda", "Valoare fara TVA", "Valoare TVA", "Valoare Totala", "Aviz insotire", "Observatii", "Index SPV"],
    [1, "BEST ADVERTISING & CONSULT SRL", "RO15116098", "Bucuresti", "EMP0361", "01/05/2026", "16/05/2026", "depasita", "RON", "39076,92", "8206,15", "47283,07", "", "OOH", ""],
    [2, "CLIENT NOU SRL", "RO 999-888", "Cluj", "EMP0362", "02/05/2026", "17/05/2026", "incasata", "RON", 100, 19, 119, "", "", ""]
  ], "sheet 1");
}

function negativeCustomerWorkbook() {
  return workbookBuffer([
    ["Nr. crt.", "Client", "CIF", "Adresa", "Factura", "Data emiterii", "Data scadentei", "Status", "Moneda", "Valoare fara TVA", "Valoare TVA", "Valoare Totala", "Aviz insotire", "Observatii", "Index SPV"],
    [1, "BEST ADVERTISING & CONSULT SRL", "RO15116098", "Bucuresti", "STORNO1", "20/05/2026", "20/05/2026", "emisa", "RON", "-100,00", "-19,00", "-119,00", "", "Storno factura EMP0361", ""]
  ]);
}

function negativeSupplierWorkbook() {
  return workbookBuffer([
    ["Document", "Denumire furnizor", "CIF", "Data doc", "Data scadentei", "Categoria", "Valoare fara TVA", "TVA", "Valoare totala", "Moneda", "Observatii", "Status"],
    ["NC1", "ASOCIATIA DE PROPRIETARI TURN T3", "28993486", "25/05/2026", "10/06/2026", "Storno", "-100,00", "-19,00", "-119,00", "RON", "Storno document T3.564", "Nesalvata"]
  ]);
}

function sameReportAdjustmentWorkbook() {
  return workbookBuffer([
    ["Nr. crt.", "Client", "CIF", "Adresa", "Factura", "Data emiterii", "Data scadentei", "Status", "Moneda", "Valoare fara TVA", "Valoare TVA", "Valoare Totala", "Aviz insotire", "Observatii", "Index SPV"],
    [1, "KEPI CONSULT SRL", "RO16252985", "Bucuresti", "EMP0367", "20/05/2026", "04/06/2026", "depasita", "RON", "35221,61", "6692,11", "41913,72", "", "OOH", ""],
    [2, "KEPI CONSULT SRL", "RO16252985", "Bucuresti", "EMP0368", "29/05/2026", "29/05/2026", "emisa", "RON", "-3201,97", "-608,37", "-3810,34", "", "Discount suplimentar", ""]
  ]);
}

function supplierWorkbook() {
  return workbookBuffer([
    ["IQ OUTDOOR MEDIA S.R.L."],
    ["CIF: RO29522177"],
    ["Documente furnizor"],
    ["Filtru: Perioada: 01/05/2026 - 31/05/2026"],
    ["Document", "Denumire furnizor", "CIF", "Data doc", "Data scadentei", "Categoria", "Valoare fara TVA", "TVA", "Valoare totala", "Moneda", "Observatii", "Status"],
    ["T3.564", "ASOCIATIA DE PROPRIETARI TURN T3", "28993486", "25/05/2026", "10/06/2026", "Chirie", 317.52, 60.33, 377.85, "RON", "", "Nesalvata"],
    ["T3.565", "FURNIZOR NOU SRL", "RO 123 456", "26/05/2026", "11/06/2026", "Servicii", "100,00", "19,00", "119,00", "RON", "", "Platita"]
  ]);
}

void (async () => {
assert.equal(smartbill.normalizeFiscalCode("RO15116098"), "15116098");
assert.equal(smartbill.normalizeFiscalCode("ro 15116098"), "15116098");
assert.equal(smartbill.normalizeFiscalCode("15116098"), "15116098");
assert.equal(smartbill.normalizeSmartBillDate("01/05/2026").toISOString().slice(0, 10), "2026-05-01");
assert.equal(smartbill.normalizeSmartBillMoney("1.234,56"), 1234.56);
assert.equal(smartbill.normalizeSmartBillMoney("(1.234,56)"), -1234.56);
assert.equal(smartbill.mapSmartBillCustomerInvoiceStatus("incasata", { totalAmount: 100 }).status, "needs_review");
assert.equal(smartbill.mapSmartBillCustomerInvoiceStatus("incasata", { totalAmount: 100 }).collectedAmount, 0);
assert.equal(smartbill.mapSmartBillCustomerInvoiceStatus("anulata", { totalAmount: 100 }).ignored, true);
assert.equal(smartbill.mapSmartBillSupplierDocumentStatus("platita", { totalAmount: 100 }).status, "needs_review");
assert.equal(smartbill.mapSmartBillSupplierDocumentStatus("platita", { totalAmount: 100 }).paidAmount, 0);
assert.equal(smartbill.mapSmartBillSupplierDocumentStatus("status strain", { totalAmount: 100 }).status, "needs_review");

const customerParsed = await smartbill.parseSmartBillCustomerInvoices(customerWorkbook());
assert.equal(customerParsed.rows.length, 2);
assert.deepEqual(customerParsed.detectedColumns.slice(0, 5), ["Nr. crt.", "Client", "CIF", "Adresa", "Factura"]);
assert.equal(customerParsed.rows[0].clientName, "BEST ADVERTISING & CONSULT SRL");
assert.equal(customerParsed.rows[0].normalizedFiscalCode, "15116098");
assert.equal(customerParsed.rows[0].invoiceNumber, "EMP0361");
assert.equal(customerParsed.rows[0].issueDate.toISOString().slice(0, 10), "2026-05-01");
assert.equal(customerParsed.rows[0].totalAmount, 47283.07);
assert.notEqual(customerParsed.rows[1].status, "collected");
assert.equal(customerParsed.rows[1].sourceStatus, "incasata");

const negativeCustomerParsed = await smartbill.parseSmartBillCustomerInvoices(negativeCustomerWorkbook());
assert.equal(negativeCustomerParsed.rows[0].issues.some((issue) => issue.includes("negativa")), false);
assert.equal(smartbill.classifySmartBillAdjustment(negativeCustomerParsed.rows[0]), "STORNO");
const negativePreview = smartbill.buildSmartBillPreview({
  parsed: negativeCustomerParsed,
  fileName: "Facturi_negative.xls",
  companyContext: focusCompany,
  context: {},
  includeToken: false
});
assert.equal(negativePreview.summary.invalidCount, 0);
assert.equal(negativePreview.summary.adjustmentNeedsReviewCount, 1);

const supplierParsed = await smartbill.parseSmartBillSupplierDocuments(supplierWorkbook());
assert.equal(supplierParsed.rows.length, 2);
assert.deepEqual(supplierParsed.detectedColumns.slice(0, 4), ["Document", "Denumire furnizor", "CIF", "Data doc"]);
assert.equal(supplierParsed.rows[0].supplierName, "ASOCIATIA DE PROPRIETARI TURN T3");
assert.equal(supplierParsed.rows[0].normalizedFiscalCode, "28993486");
assert.equal(supplierParsed.rows[0].documentNumber, "T3.564");
assert.notEqual(supplierParsed.rows[1].status, "paid");
assert.equal(supplierParsed.rows[1].sourceStatus, "Platita");
const negativeSupplierParsed = await smartbill.parseSmartBillSupplierDocuments(negativeSupplierWorkbook());
assert.equal(negativeSupplierParsed.rows[0].issues.some((issue) => issue.includes("negativa")), false);
assert.equal(smartbill.classifySmartBillAdjustment(negativeSupplierParsed.rows[0]), "STORNO");
const negativeSupplierPreview = smartbill.buildSmartBillPreview({
  parsed: negativeSupplierParsed,
  fileName: "Furnizori_negative.xls",
  companyContext: focusCompany,
  context: {},
  includeToken: false
});
assert.equal(negativeSupplierPreview.summary.adjustmentNeedsReviewCount, 1);
assert.equal(negativeSupplierPreview.rows[0].proposedAction, "ADJUSTMENT_NEEDS_REVIEW");

const clients = [
  { id: "client-1", name: "Best Advertising Consult", normalizedName: "best advertising consult", taxId: "15116098" }
];
const suppliers = [
  { id: "supplier-1", name: "Asociatia de Proprietari Turn T3", normalizedName: "asociatia de proprietari turn t3", taxId: "28993486" }
];
assert.equal(smartbill.matchSmartBillEntity(customerParsed.rows[0], clients).entity.id, "client-1");
assert.equal(smartbill.matchSmartBillEntity(customerParsed.rows[1], clients).kind, "none");
assert.equal(smartbill.matchSmartBillEntity(supplierParsed.rows[0], suppliers).entity.id, "supplier-1");
assert.equal(smartbill.matchSmartBillEntity(customerParsed.rows[0], [...clients, { id: "client-2", name: "Alt", normalizedName: "alt", taxId: "15116098" }]).kind, "ambiguous");

const existingReceivable = {
  id: "receivable-1",
  companyName: "Focus Media",
  companyCode: "FOCUS_MEDIA",
  normalizedInvoiceNumber: customerParsed.rows[0].normalizedInvoiceNumber,
  invoiceNumber: customerParsed.rows[0].invoiceNumber,
  invoiceDate: customerParsed.rows[0].issueDate,
  dueDate: customerParsed.rows[0].dueDate,
  clientId: "client-1",
  amount: customerParsed.rows[0].totalAmount,
  remainingAmount: customerParsed.rows[0].totalAmount,
  paidOrCollectedAmount: 0,
  entityTaxId: "15116098",
  entityNormalizedName: "best advertising consult",
  currency: "RON",
  rawRowJson: { source: "manual" },
  includedInReport: true,
  status: "overdue"
};
assert.equal(smartbill.findSmartBillDuplicate(customerParsed.rows[0], [existingReceivable], focusCompany).id, "receivable-1");
assert.equal(smartbill.isSmartBillSourceDuplicate(existingReceivable, customerParsed.rows[0].dedupeKey), false);
const otherCompanyReceivable = { ...existingReceivable, id: "receivable-other-company", companyName: "Excellence Media", companyCode: "EXCELLENCE_MEDIA" };
assert.equal(smartbill.findSmartBillDuplicate(customerParsed.rows[0], [otherCompanyReceivable], focusCompany), null);
const conflictingReceivable = { ...existingReceivable, id: "receivable-conflict", amount: 10 };
assert.equal(smartbill.findSmartBillDocumentConflict(customerParsed.rows[0], [conflictingReceivable], focusCompany).id, "receivable-conflict");

const adjustmentMatch = smartbill.findSmartBillAdjustmentMatch(negativeCustomerParsed.rows[0], [existingReceivable], focusCompany);
assert.equal(adjustmentMatch.kind, "auto");
assert.equal(adjustmentMatch.linkedRow.id, "receivable-1");
assert.equal(adjustmentMatch.matchConfidence, "high");
const adjustmentCandidates = smartbill.findSmartBillAdjustmentCandidates(negativeCustomerParsed.rows[0], [existingReceivable], focusCompany);
assert.equal(adjustmentCandidates.length, 1);
assert.equal(adjustmentCandidates[0].id, "receivable-1");
assert.equal(adjustmentCandidates[0].remainingAmount, 47283.07);
const adjustmentApplication = smartbill.calculateSmartBillReceivableAdjustment({
  row: negativeCustomerParsed.rows[0],
  receivable: existingReceivable,
  now: new Date("2026-06-29T00:00:00.000Z")
});
assert.equal(adjustmentApplication.remainingAmount, 47164.07);
assert.equal(adjustmentApplication.originalInvoicedAmount, 47283.07);
assert.equal(existingReceivable.amount, 47283.07);

const multipleAdjustmentMatch = smartbill.findSmartBillAdjustmentMatch(
  { ...negativeCustomerParsed.rows[0], notes: "Storno discount fara referinta", raw: { Observatii: "Storno discount fara referinta" } },
  [existingReceivable, { ...existingReceivable, id: "receivable-2", invoiceNumber: "EMP0999", normalizedInvoiceNumber: "emp0999" }],
  focusCompany
);
assert.equal(multipleAdjustmentMatch.kind, "review");
const tooLargeAdjustmentMatch = smartbill.findSmartBillAdjustmentMatch(
  { ...negativeCustomerParsed.rows[0], totalAmount: -999999 },
  [existingReceivable],
  focusCompany
);
assert.equal(tooLargeAdjustmentMatch.kind, "review");
const wrongCompanyAdjustmentMatch = smartbill.findSmartBillAdjustmentMatch(negativeCustomerParsed.rows[0], [{ ...existingReceivable, companyName: "Excellence Media", companyCode: "EXCELLENCE_MEDIA" }], focusCompany);
assert.equal(wrongCompanyAdjustmentMatch.kind, "review");

const preview = smartbill.buildSmartBillPreview({
  parsed: customerParsed,
  fileName: "Facturi_29_06_2026.xls",
  companyContext: focusCompany,
  context: { clients, receivables: [existingReceivable] },
  includeToken: false
});
assert.equal(preview.companyName, "Focus Media");
assert.equal(preview.companyCode, "FOCUS_MEDIA");
assert.equal(preview.summary.rowCount, 2);
assert.equal(preview.summary.duplicateCount, 1);
assert.equal(preview.summary.createClientCount, 1);
assert.equal(preview.summary.totalReceivable, 119);
assert.equal(preview.rows.find((row) => row.documentNumber === "EMP0361").proposedAction, "DUPLICATE");
assert.equal(preview.rows.find((row) => row.documentNumber === "EMP0362").proposedAction, "PROPOSE_CREATE_CLIENT");

const autoAdjustmentPreview = smartbill.buildSmartBillPreview({
  parsed: negativeCustomerParsed,
  fileName: "Facturi_negative.xls",
  companyContext: focusCompany,
  context: { clients, receivables: [existingReceivable] },
  includeToken: false
});
assert.equal(autoAdjustmentPreview.summary.autoLinkedAdjustmentCount, 1);
assert.equal(autoAdjustmentPreview.rows[0].proposedAction, "AUTO_LINK_ADJUSTMENT");
assert.equal(autoAdjustmentPreview.rows[0].linkedFinancialRowId, "receivable-1");
assert.equal(autoAdjustmentPreview.rows[0].adjustmentCandidates.length, 1);

const duplicateAdjustmentPreview = smartbill.buildSmartBillPreview({
  parsed: negativeCustomerParsed,
  fileName: "Facturi_negative.xls",
  companyContext: focusCompany,
  context: {
    clients,
    receivables: [
      existingReceivable,
      {
        id: "adjustment-existing",
        companyName: "Focus Media",
        companyCode: "FOCUS_MEDIA",
        normalizedInvoiceNumber: negativeCustomerParsed.rows[0].normalizedInvoiceNumber,
        invoiceNumber: negativeCustomerParsed.rows[0].invoiceNumber,
        invoiceDate: negativeCustomerParsed.rows[0].issueDate,
        amount: negativeCustomerParsed.rows[0].totalAmount,
        remainingAmount: 0,
        currency: "RON",
        rawRowJson: { smartBillDedupeKey: negativeCustomerParsed.rows[0].dedupeKey },
        includedInReport: true,
        status: "collected"
      }
    ]
  },
  includeToken: false
});
assert.equal(duplicateAdjustmentPreview.rows[0].proposedAction, "DUPLICATE");

const sameReportAdjustmentParsed = await smartbill.parseSmartBillCustomerInvoices(sameReportAdjustmentWorkbook());
const sameReportAdjustmentPreview = smartbill.buildSmartBillPreview({
  parsed: sameReportAdjustmentParsed,
  fileName: "Facturi_same_report_negative.xls",
  companyContext: focusCompany,
  context: {},
  includeToken: false
});
assert.equal(sameReportAdjustmentPreview.rows.find((row) => row.documentNumber === "EMP0368").proposedAction, "AUTO_LINK_ADJUSTMENT");
assert.equal(sameReportAdjustmentPreview.rows.find((row) => row.documentNumber === "EMP0368").linkedDocumentNumber, "EMP0367");

const conflictPreview = smartbill.buildSmartBillPreview({
  parsed: customerParsed,
  fileName: "Facturi_29_06_2026.xls",
  companyContext: focusCompany,
  context: { clients, receivables: [conflictingReceivable] },
  includeToken: false
});
assert.equal(conflictPreview.rows.find((row) => row.documentNumber === "EMP0361").proposedAction, "NEEDS_REVIEW");

const token = smartbill.createSmartBillImportToken({
  version: 1,
  reportType: "customer_invoices",
  companyName: focusCompany.companyName,
  companyCode: focusCompany.companyCode,
  fileName: "Facturi_29_06_2026.xls",
  fileHash: customerParsed.fileHash,
  generatedAt: new Date("2026-06-29T00:00:00.000Z").toISOString(),
  rows: customerParsed.rows
}, "01234567890123456789012345678901");
const verified = smartbill.verifySmartBillImportToken(token, "01234567890123456789012345678901", { now: new Date("2026-06-29T00:30:00.000Z") });
assert.equal(verified.companyName, "Focus Media");
assert.equal(verified.companyCode, "FOCUS_MEDIA");
assert.equal(verified.rows[0].issueDate instanceof Date, true);
assert.equal(verified.rows[0].dedupeKey, customerParsed.rows[0].dedupeKey);
assert.throws(
  () => smartbill.verifySmartBillImportToken(token, "01234567890123456789012345678901", { now: new Date("2026-06-30T00:00:00.000Z"), maxAgeMs: 60 * 60 * 1000 }),
  /expirat/
);

const receivableData = smartbill.smartBillCustomerReceivableData({
  row: customerParsed.rows[1],
  uploadId: "upload-1",
  companyContext: excellenceCompany,
  clientId: "client-new",
  reviewedByUserId: "user-1"
});
assert.equal(receivableData.companyName, "Excellence Media");
assert.equal(receivableData.companyCode, "EXCELLENCE_MEDIA");
assert.equal(receivableData.remainingAmount, 119);
assert.notEqual(receivableData.status, "collected");
assert.equal(receivableData.sourceStatus, "incasata");
assert.equal(receivableData.rawRowJson.source, "SmartBill");
assert.equal(receivableData.rawRowJson.companyCode, "EXCELLENCE_MEDIA");
assert.equal(receivableData.rawRowJson.smartBillDedupeKey, customerParsed.rows[1].dedupeKey);

const payableData = smartbill.smartBillSupplierPayableData({
  row: supplierParsed.rows[1],
  uploadId: "upload-1",
  companyContext: excellenceCompany,
  supplierId: "supplier-new",
  reviewedByUserId: "user-1"
});
assert.equal(payableData.companyName, "Excellence Media");
assert.equal(payableData.companyCode, "EXCELLENCE_MEDIA");
assert.equal(payableData.rawRowJson.companyCode, "EXCELLENCE_MEDIA");

const supplierPreview = smartbill.buildSmartBillPreview({
  parsed: supplierParsed,
  fileName: "Raport_document_furnizori_29_06_2026.xls",
  companyContext: focusCompany,
  context: {
    suppliers,
    payables: [{
      id: "payable-1",
      companyName: "Focus Media",
      companyCode: "FOCUS_MEDIA",
      normalizedInvoiceNumber: supplierParsed.rows[0].normalizedInvoiceNumber,
      invoiceDate: supplierParsed.rows[0].issueDate,
      amount: supplierParsed.rows[0].totalAmount,
      rawRowJson: { smartBillDedupeKey: supplierParsed.rows[0].dedupeKey },
      includedInReport: true,
      status: "in_term"
    }]
  },
  includeToken: false
});
assert.equal(supplierPreview.summary.matchedCount, 1);
assert.equal(supplierPreview.summary.createSupplierCount, 1);
assert.equal(supplierPreview.summary.duplicateCount, 0);

const realCustomerFile = path.join(process.env.USERPROFILE || "", "Downloads", "Facturi_29_06_2026.xls");
const realSupplierFile = path.join(process.env.USERPROFILE || "", "Downloads", "Raport_document_furnizori_29_06_2026 (1) (1).xls");
if (fs.existsSync(realCustomerFile)) {
  const realCustomerParsed = await smartbill.parseSmartBillCustomerInvoices(fs.readFileSync(realCustomerFile), { fileName: realCustomerFile });
  const wrongTypeCustomerParsed = await smartbill.parseSmartBillSupplierDocuments(fs.readFileSync(realCustomerFile), { fileName: realCustomerFile });
  const realCustomerPreview = smartbill.buildSmartBillPreview({
    parsed: realCustomerParsed,
    fileName: "Facturi_29_06_2026.xls",
    companyContext: focusCompany,
    context: {},
    includeToken: false
  });
  assert.equal(realCustomerParsed.rows.length, 11, "Real SmartBill customer file must ignore the report total/footer row.");
  assert.equal(realCustomerParsed.rows.filter((row) => !row.issues.length).length, 11, "Real SmartBill customer file must keep 11 valid rows.");
  assert.equal(realCustomerPreview.summary.invalidCount, 0, "Report total/footer rows must not enter the import preview.");
  assert.equal(realCustomerPreview.rows.filter((row) => row.totalAmount < 0).length, 3, "Real SmartBill customer file must keep three negative adjustment rows.");
  assert.equal(realCustomerPreview.summary.autoLinkedAdjustmentCount, 2, "Kepi negative rows must auto-link to the same-report open invoice.");
  assert.equal(realCustomerPreview.summary.adjustmentNeedsReviewCount, 1, "Rentea negative row must stay in review.");
  assert.equal(realCustomerPreview.rows.find((row) => row.documentNumber === "EMP0364").linkedDocumentNumber, "EMP0367");
  assert.equal(realCustomerPreview.rows.find((row) => row.documentNumber === "EMP0368").linkedDocumentNumber, "EMP0367");
  assert.equal(realCustomerPreview.rows.find((row) => row.documentNumber === "EMP0365").proposedAction, "ADJUSTMENT_NEEDS_REVIEW");
  assert.equal(wrongTypeCustomerParsed.rows.length, 0, "Wrong report type must not manufacture supplier documents from a customer report.");
}

if (fs.existsSync(realSupplierFile)) {
  const realSupplierParsed = await smartbill.parseSmartBillSupplierDocuments(fs.readFileSync(realSupplierFile), { fileName: realSupplierFile });
  const realSupplierPreview = smartbill.buildSmartBillPreview({
    parsed: realSupplierParsed,
    fileName: "Raport_document_furnizori_29_06_2026.xls",
    companyContext: focusCompany,
    context: {},
    includeToken: false
  });
  assert.equal(realSupplierParsed.rows.length, 40, "Real SmartBill supplier file must keep 40 parsed rows.");
  assert.equal(realSupplierParsed.rows.filter((row) => !row.issues.length).length, 40, "Real SmartBill supplier file must keep 40 valid rows.");
  assert.equal(realSupplierPreview.summary.invalidCount, 0, "Real SmartBill supplier file must not produce invalid rows.");
  assert.equal(realSupplierPreview.rows.filter((row) => row.totalAmount < 0).length, 1, "Real SmartBill supplier file must keep one negative supplier document.");
  assert.equal(realSupplierPreview.summary.adjustmentNeedsReviewCount, 1, "Negative supplier document must stay review-only.");
  assert.equal(realSupplierPreview.rows.find((row) => row.totalAmount < 0).proposedAction, "ADJUSTMENT_NEEDS_REVIEW");
}

const previewRouteSource = fs.readFileSync(path.join(repoRoot, "src/app/api/admin/financial/smartbill/preview/route.ts"), "utf8");
assert.ok(previewRouteSource.includes("companyNameSchema"), "SmartBill preview route must require a company context.");
assert.ok(previewRouteSource.includes("resolveSmartBillCompanyContext"), "SmartBill preview route must validate the selected company.");
assert.ok(previewRouteSource.includes("parseSmartBillReportWithDetection"), "SmartBill preview route must auto-detect a clearly mismatched report type.");
assert.ok(previewRouteSource.includes("report_type_auto_detected"), "SmartBill preview route must log report type auto-detection.");
assert.equal(previewRouteSource.includes("recordAudit"), false, "SmartBill preview must not write audit rows because preview is read-only.");
assert.equal(/\.create\s*\(/.test(previewRouteSource), false, "SmartBill preview route must not create DB rows.");
assert.equal(/\.update\s*\(/.test(previewRouteSource), false, "SmartBill preview route must not update DB rows.");
assert.equal(/\.delete\s*\(/.test(previewRouteSource), false, "SmartBill preview route must not delete DB rows.");

const confirmRouteSource = fs.readFileSync(path.join(repoRoot, "src/app/api/admin/financial/smartbill/confirm/route.ts"), "utf8");
assert.ok(confirmRouteSource.includes("prisma.$transaction"), "SmartBill confirm should write in a transaction.");
assert.ok(confirmRouteSource.includes("financial.smartbill_import_confirmed"), "SmartBill confirm should write an audit log.");
assert.ok(confirmRouteSource.includes("activeVersion: !existingActiveUpload"), "SmartBill confirm must not replace an existing active finance upload.");
assert.ok(confirmRouteSource.includes("companyName: z.string()"), "SmartBill confirm must require company context.");
assert.ok(confirmRouteSource.includes("body.reportType !== payload.reportType"), "SmartBill confirm must reject report type mismatch.");
assert.ok(confirmRouteSource.includes("Firma aleasa nu corespunde"), "SmartBill confirm must reject company mismatch.");
assert.ok(confirmRouteSource.includes("smartbill-${companyContext.companyCode}-${payload.fileHash}"), "SmartBill upload metadata must include selected company context.");
assert.ok(confirmRouteSource.includes("!importableAction(previewRow.proposedAction)"), "SmartBill confirm must skip invalid, review, duplicate and ignored rows.");
assert.ok(confirmRouteSource.includes('previewRow.proposedAction === "AUTO_LINK_ADJUSTMENT"'), "SmartBill confirm must apply only auto-linked negative adjustments.");
assert.ok(confirmRouteSource.includes("applySmartBillCustomerAdjustment"), "SmartBill confirm must recheck adjustment links before writing.");
assert.ok(confirmRouteSource.includes("remainingAmount: application.remainingAmount"), "SmartBill confirm must reduce only the linked remaining amount.");
assert.ok(confirmRouteSource.includes("manualActions"), "SmartBill confirm must accept reviewed manual actions.");
assert.ok(confirmRouteSource.includes("buildSmartBillConfirmPlan"), "SmartBill confirm must build a deterministic plan before opening the write transaction.");
assert.ok(confirmRouteSource.includes("validateManualSmartBillAdjustmentLink"), "SmartBill confirm must revalidate manual storno links server-side.");
assert.ok(confirmRouteSource.includes("SKIP_MANUAL"), "SmartBill confirm must support explicit manual skips.");
assert.ok(confirmRouteSource.includes("maxWait: 10000") && confirmRouteSource.includes("timeout: 30000"), "SmartBill confirm must use an explicit longer interactive transaction timeout.");
assert.ok(confirmRouteSource.includes("transaction_start") && confirmRouteSource.includes("transaction_end"), "SmartBill confirm must log transaction boundaries.");
const applyAdjustmentSource = confirmRouteSource.slice(confirmRouteSource.indexOf("async function applySmartBillCustomerAdjustment"), confirmRouteSource.indexOf("async function ensureSupplierForSmartBillRow"));
assert.equal(applyAdjustmentSource.includes("findMany"), false, "SmartBill adjustment application must not re-query all receivables inside every adjustment.");
assert.ok(confirmRouteSource.includes("createdReceivableIdByDedupeKey"), "SmartBill confirm should preserve same-file adjustment idempotency.");

const financePanelSource = fs.readFileSync(path.join(repoRoot, "src/components/admin/FinancialDashboardPanel.tsx"), "utf8");
assert.ok(financePanelSource.includes("Firma import"), "SmartBill UI must show a required company selector.");
assert.ok(financePanelSource.includes("Alege firma"), "SmartBill UI must not silently default the company.");
assert.ok(financePanelSource.includes('form.set("companyName", smartBillCompanyName)'), "SmartBill preview request must include company context.");
assert.ok(financePanelSource.includes("setSmartBillReportType(payload.preview.reportType)"), "SmartBill UI must sync the selector when the preview auto-detects report type.");
assert.ok(financePanelSource.includes("smartBillPreview.companyName === smartBillCompanyName"), "SmartBill confirm must be disabled on company mismatch.");
assert.ok(financePanelSource.includes("CIF/CUI original") && financePanelSource.includes("CIF/CUI normalizat"), "SmartBill preview must show original and normalized fiscal codes.");
assert.ok(financePanelSource.includes("Firma selectata"), "SmartBill preview summary must show the selected company.");
assert.ok(financePanelSource.includes("Tip raport"), "SmartBill preview summary must show the report type.");
assert.ok(financePanelSource.includes("Total clienti importabil pe moneda") && financePanelSource.includes("Total furnizori importabil pe moneda"), "SmartBill preview must show total value by currency.");
assert.ok(financePanelSource.includes("Se vor asocia automat"), "SmartBill preview must group auto-matched rows.");
assert.ok(financePanelSource.includes("Se vor crea clienti/furnizori noi"), "SmartBill preview must group create-new rows.");
assert.ok(financePanelSource.includes("Storno / discounturi legate automat"), "SmartBill preview must group auto-linked negative adjustments.");
assert.ok(financePanelSource.includes("Storno / discounturi necesita verificare"), "SmartBill preview must group negative adjustments that need review.");
assert.ok(financePanelSource.includes("Factura legata") && financePanelSource.includes("Incredere"), "SmartBill adjustment preview must show linked invoice and match confidence.");
assert.ok(financePanelSource.includes("Corectate manual"), "SmartBill UI must show manually corrected rows separately.");
assert.ok(financePanelSource.includes("Exclude din import"), "SmartBill UI must let the user skip review rows explicitly.");
assert.ok(financePanelSource.includes("Potriveste cu existent"), "SmartBill UI must let the user match a row to an existing client/supplier.");
assert.ok(financePanelSource.includes("Creeaza nou explicit"), "SmartBill UI must let the user force-create an unmatched client/supplier.");
assert.ok(financePanelSource.includes("Leaga storno la factura"), "SmartBill UI must let the user manually link customer storno rows.");
assert.ok(financePanelSource.includes("manualActions: Object.values(smartBillManualActions)"), "SmartBill confirm request must include manual actions.");
assert.ok(financePanelSource.includes("smartBillReviewState.invalidManualRows === 0"), "SmartBill confirm must be disabled when a manual correction is incomplete.");
assert.ok(financePanelSource.includes("Duplicate detectate"), "SmartBill preview must group duplicates.");
assert.ok(financePanelSource.includes("Necesita verificare"), "SmartBill preview must group review rows.");
assert.ok(financePanelSource.includes("Randuri invalide"), "SmartBill preview must group invalid rows.");
assert.ok(financePanelSource.includes("Ignorate"), "SmartBill preview must group ignored rows.");
assert.ok(financePanelSource.includes("Confirma importul SmartBill"), "SmartBill confirm must use a final confirmation modal.");
assert.ok(financePanelSource.includes("Randurile invalide sau de review nu se importa automat"), "SmartBill confirm modal must explain review/invalid exclusion.");
assert.ok(financePanelSource.includes("disabled={busy || !canConfirm}"), "SmartBill final confirm button must be disabled without a valid token/company preview.");

const dashboardSource = fs.readFileSync(path.join(repoRoot, "src/lib/financial-dashboard.ts"), "utf8");
assert.ok(dashboardSource.includes('fileHash: { startsWith: "smartbill-" }'), "Finance dashboard should include confirmed SmartBill uploads.");
assert.ok(dashboardSource.includes("buildCompanyRows(clearPayables, clearReceivables, issues)"), "Finance dashboard company totals should include SmartBill rows.");

const publicApiSource = fs.readFileSync(path.join(repoRoot, "src/app/api/locations/route.ts"), "utf8");
assert.equal(publicApiSource.includes("smartbill"), false, "SmartBill import must not be exposed by public locations API.");

console.log("SmartBill import tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
