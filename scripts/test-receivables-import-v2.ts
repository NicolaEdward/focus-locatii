import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { hasPermission } from "../src/lib/rbac";
import {
  matchClientCandidates,
  normalizeReceivableInvoiceNumber,
  receivableCanonicalKey,
  receivableLedgerSnapshot,
  receivableStatus,
  reconcileReceivableAmounts
} from "../src/lib/receivables-domain";
import { parseReceivablesWorkbook } from "../src/lib/receivables-import-parser";

async function main() {
const workbook = XLSX.utils.book_new();
appendSheet(workbook, "Focus Media", [
  ["FOCUS MEDIA OUTDOOR S.R.L."],
  ["LISTA PLĂȚI"],
  ["Furnizor", "SUMA"],
  ["Furnizor ignorat", 999],
  ["LISTA ÎNCASĂRI"],
  ["NR. FACTURĂ", "DATA FACTURĂ", "CLIENT", "DATA SCADENȚEI", "MONEDA", "SUMA FACTURATĂ", "ÎNCASAT", "REST DE ÎNCASAT", "LOCAȚIE", "DETALII CAMPANIE"],
  ["FSCM 1369 / 01.07.2026", "01.07.2026", "NEW AGE S.R.L.", "31.07.2026", "RON", "4.000,00", "1.000,00", "3.000,00", "B01", "Campanie test"],
  ["SUBTOTAL", "", "NEW AGE S.R.L.", "", "RON", "4.000,00", "1.000,00", "3.000,00", "", ""]
]);
appendSheet(workbook, "Excellence", [
  ["EXCELLENCE MEDIA PRODUCTION S.R.L."],
  ["LISTA INCASARI"],
  ["FACTURA", "DENUMIRE CLIENT", "DATA SCADENTA", "VALOARE FACTURA", "SUMA INCASATA", "REST INCASAT", "CURRENCY", "CAMPANIE"],
  ["EMP 99", "UNITED MEDIA SERVICES", "10-08-2026", 2500, 500, 2000, "RON", "OOH"]
]);
appendSheet(workbook, "Focus BG EOOD", [
  ["FOCUS MEDIA - EOOD Bulgaria"],
  ["LISTA ÎNCASĂRI"],
  ["NR FACTURĂ", "CLIENT", "DATA SCADENTĂ", "SUMA FACTURATĂ", "ÎNCASAT", "REST DE ÎNCASAT", "MONEDA", "LOCAȚIE"],
  ["FMBG-56", "Client BG A", "01.08.2026", 1000, 0, 1000, "EUR", "Sofia 1"],
  ["FMBG-59", "Client BG B", "13.07.2026", 500, 0, 500, "EUR", "Sofia 2"],
  ["FMBG-52", "Client BG C", "01.07.2026", 1000, 1061.45, -61.45, "EUR", "Sofia 3"],
  ["TOTAL", "", "", 1500, 1061.45, 438.55, "EUR", ""]
]);

const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
const parsed = await parseReceivablesWorkbook({ buffer, fileName: "Raport Incasari 16.07.2026.xlsx" });
assert.equal(parsed.rows.length, 5, "only LISTA INCASARI rows must be parsed");
assert.deepEqual(new Set(parsed.rows.map((row) => row.companyCode)), new Set(["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"]));
assert.equal(parsed.rows.some((row) => row.clientNameRaw === "Furnizor ignorat"), false, "LISTA PLATI must never be imported");
assert.ok(parsed.declaredTotals.some((total) => total.normalizedClientName === "new age"), "client subtotals must be tracked separately from company totals");
assert.equal(parsed.rows.find((row) => row.rawInvoiceNumber.startsWith("FSCM"))?.normalizedInvoiceNumber, "fcsm136901072026", "source typo is normalized without losing raw value");

const fmbg56 = parsed.rows.find((row) => row.rawInvoiceNumber === "FMBG-56");
const fmbg59 = parsed.rows.find((row) => row.rawInvoiceNumber === "FMBG-59");
const fmbg52 = parsed.rows.find((row) => row.rawInvoiceNumber === "FMBG-52");
assert.ok(fmbg56);
assert.ok(fmbg59?.dueDate);
assert.equal(receivableStatus({ invoiceAmount: fmbg59.invoiceAmount, collectedAmount: fmbg59.reportCollectedAmount, dueDate: fmbg59.dueDate, now: new Date("2026-07-16T00:00:00.000Z") }), "overdue", "FMBG-59 is overdue on 16.07.2026");
assert.equal(fmbg52?.rowState, "credit");
assert.equal(fmbg52?.reportRemainingAmount, "-61.45");
assert.equal(parsed.summaries.find((summary) => summary.companyCode === "FOCUS_BG")?.creditAmount, "61.45");
assert.ok(parsed.issues.some((issue) => issue.type === "declared_total_mismatch" && issue.severity === "critical"), "FMBG-56 omission from declared total must be detected");

const bgOnly = await parseReceivablesWorkbook({ buffer, fileName: "Raport.xlsx", selectedCompanyCode: "FOCUS_BG" });
assert.equal(bgOnly.rows.length, 3, "manual company selection must ignore other company sheets");
assert.equal(bgOnly.issues.some((issue) => issue.type === "company_conflict"), false);

assert.equal(normalizeReceivableInvoiceNumber("FSCM 1369"), "fcsm1369");
assert.equal(receivableCanonicalKey({ companyCode: "FOCUS_MEDIA", normalizedInvoiceNumber: "fcsm1369", currency: "RON", clientId: "client-1" }), "focus_media|fcsm1369|ron|client-1");

const partial = reconcileReceivableAmounts({ invoiceAmount: "4000", ledgerCollectedAmount: "1000", reportCollectedAmount: "1500" });
assert.equal(partial.state, "payment_delta");
assert.equal(partial.importDelta.toFixed(2), "500.00");
assert.equal(partial.remainingAmount.toFixed(2), "2500.00");
const futureOldReport = reconcileReceivableAmounts({ invoiceAmount: "4000", ledgerCollectedAmount: "1500", reportCollectedAmount: "1000" });
assert.equal(futureOldReport.state, "conflict", "an older/incomplete report cannot erase manual payments");
const overpaymentBlocked = reconcileReceivableAmounts({ invoiceAmount: "1000", ledgerCollectedAmount: "0", reportCollectedAmount: "1061.45" });
assert.equal(overpaymentBlocked.state, "overpayment_confirmation");
const overpaymentAccepted = reconcileReceivableAmounts({ invoiceAmount: "1000", ledgerCollectedAmount: "0", reportCollectedAmount: "1061.45", allowOverpayment: true });
assert.equal(overpaymentAccepted.creditAmount.toFixed(2), "61.45");
const partialLedger = receivableLedgerSnapshot({ invoiceAmount: "1000", payments: [{ amount: "250", status: "active" }, { amount: "100", status: "cancelled" }] });
assert.equal(partialLedger.collectedAmount.toFixed(2), "250.00", "cancelled payments are excluded from totals");
assert.equal(partialLedger.remainingAmount.toFixed(2), "750.00");
assert.equal(partialLedger.status, "collected_partial");
const fullLedger = receivableLedgerSnapshot({ invoiceAmount: "1000", payments: [{ amount: "250", status: "active" }, { amount: "750", status: "active" }] });
assert.equal(fullLedger.status, "collected", "multiple payments can fully settle an invoice");
const correctedLedger = receivableLedgerSnapshot({ invoiceAmount: "1000", payments: [{ amount: "250", status: "cancelled" }, { amount: "300", status: "active" }] });
assert.equal(correctedLedger.collectedAmount.toFixed(2), "300.00", "a correction replaces the cancelled payment in the active ledger");

const aliasMatch = matchClientCandidates({
  clientName: "NEW AGE",
  companyCode: "FOCUS_MEDIA",
  clients: [{ id: "client-1", companyName: "NEW AGE ADVERTISING", normalizedName: "new age advertising" }],
  aliases: [{ companyCode: "FOCUS_MEDIA", normalizedAlias: "new age", clientId: "client-1" }]
});
assert.equal(aliasMatch.level, "safe");
assert.deepEqual(aliasMatch.clientIds, ["client-1"]);
const fuzzyMatch = matchClientCandidates({
  clientName: "UNITED MEDIA SERVCES",
  companyCode: "FOCUS_MEDIA",
  clients: [{ id: "client-2", companyName: "UNITED MEDIA SERVICES", normalizedName: "united media services" }],
  aliases: []
});
assert.equal(fuzzyMatch.level, "probable", "fuzzy names are proposals, never automatic aliases");

assert.equal(hasPermission("FINANCE_OPERATOR", "finance.upload"), true);
assert.equal(hasPermission("FINANCE_OPERATOR", "finance.validate"), true);
assert.equal(hasPermission("FINANCE_OPERATOR", "finance.confirm"), true);
assert.equal(hasPermission("SALES_AGENT", "finance.view"), false);
assert.equal(hasPermission("COO", "leads.view"), true);
assert.equal(hasPermission("COO", "leads.manage"), false);

const root = path.resolve(process.cwd());
const service = read("src/lib/receivables-import-service.ts");
const payments = read("src/lib/receivables-payment-service.ts");
const manualFinancialRoute = read("src/app/api/admin/financial/manual/route.ts");
const workspace = read("src/components/admin/ReceivablesWorkspace.tsx");
const dashboard = read("src/lib/dashboard/coo-dashboard.ts");
const commandCenter = read("src/components/admin/CooCommandCenter.tsx");
const notifications = read("src/lib/notifications.ts");
const rowRoute = read("src/app/api/admin/receivables-import/[id]/rows/[rowId]/route.ts");
const publicApi = read("src/app/api/locations/route.ts");
const migration = read("prisma/migrations/20260719000000_receivables_import_reconciliation/migration.sql");
assert.match(service, /\$transaction/);
assert.match(service, /TransactionIsolationLevel\.Serializable/);
assert.match(service, /sourceImportRowId/);
assert.match(service, /legacy_opening_balance/);
assert.match(payments, /financialReceivablePayment\.create/);
assert.match(payments, /status:\s*"cancelled"/);
assert.match(payments, /confirmOverpayment/);
assert.match(manualFinancialRoute, /financialReceivablePayment\.create/, "legacy manual receivable entry must also use the payment ledger");
assert.match(manualFinancialRoute, /receivableCanonicalKey/, "manual receivables must use the same canonical identity");
assert.match(workspace, /Înregistrează plată/);
assert.match(workspace, /Facturi clienți/);
assert.match(workspace, /Toate firmele/);
assert.match(workspace, /Toate monedele/);
assert.match(workspace, /Scad în 7 zile/);
assert.match(workspace, /Încasat anterior/);
assert.match(workspace, /După această plată/);
assert.match(workspace, /Încasează tot soldul/);
assert.match(service, /companyCode: input\.companyCode/);
assert.match(service, /currency: input\.currency/);
assert.match(service, /buildReceivableSummary/);
assert.match(dashboard, /financialReceivable\.groupBy/, "COO totals must use the canonical customer-invoice registry");
assert.match(commandCenter, /\/admin\/financiar\/incasari/, "COO finance summaries must link to Facturi clienti");
assert.doesNotMatch(commandCenter, /CustomerInvoicePanel/, "the full invoice workspace must not be loaded inside the dashboard");
assert.doesNotMatch(commandCenter, /<FinancialDashboardPanel/);
assert.match(notifications, /canonicalKey: \{ not: null \}/, "financial notifications must read the new customer-invoice ledger");
assert.match(workspace, /LISTA ÎNCASĂRI/);
assert.match(workspace, /Aliasuri clienți/);
assert.match(workspace, /Moneda rândului \(RON sau EUR\)/);
assert.match(rowRoute, /currency: z\.enum\(\["RON", "EUR"\]\)/);
assert.match(service, /Motivul corectării monedei este obligatoriu/);
assert.match(service, /previousCurrency: row\.currency, currency/);
assert.match(service, /maxWait: 10_000/);
assert.match(service, /timeout: 120_000/);
assert.match(service, /receivable\.payments\.reduce/);
assert.doesNotMatch(service, /financialReceivablePayment\.aggregate/);
assert.match(read("src/app/api/admin/receivables-import/[id]/confirm/route.ts"), /maxDuration = 180/);
assert.match(workspace, /allocationMutationRef\.current/);
assert.doesNotMatch(publicApi, /FinancialReceivablePayment|financialReceivablePayment|FinancialClientCredit|financialClientCredit/);
assert.doesNotMatch(migration, /\b(DROP\s+(?:TABLE|COLUMN|INDEX)|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i, "migration must be additive");

const optionalRealFixture = "C:\\Users\\edwar\\Desktop\\Raport Incasari _ Plati_ 23.06.2026.xlsx";
if (fs.existsSync(optionalRealFixture)) {
  const real = await parseReceivablesWorkbook({ buffer: fs.readFileSync(optionalRealFixture), fileName: path.basename(optionalRealFixture) });
  assert.equal(real.rows.length, 72);
  assert.deepEqual(new Set(real.rows.map((row) => row.companyCode)), new Set(["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"]));
  assert.equal(real.rows.filter((row) => row.rowState === "credit").length, 1);
}

console.log("Receivables import v2 tests passed: parser, Bulgaria anomalies, decimal reconciliation, aliases, RBAC, transaction and privacy.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function appendSheet(book: XLSX.WorkBook, name: string, rows: unknown[][]) {
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
}

function read(relativePath: string) {
  return fs.readFileSync(path.join(path.resolve(process.cwd()), relativePath), "utf8");
}
