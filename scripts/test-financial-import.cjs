const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require("tsx/cjs");

const { parseFinancialWorkbook } = require("../src/lib/financial-import.ts");

const defaultWorkbook = "C:/Users/edwar/Desktop/Raport Incasari _ Plati_ 23.06.2026.xlsx";
const workbookPath = process.argv[2] || defaultWorkbook;

assert(fs.existsSync(workbookPath), `Workbook not found: ${workbookPath}`);
void (async () => {
const parsed = await parseFinancialWorkbook({
  buffer: fs.readFileSync(workbookPath),
  fileName: path.basename(workbookPath),
  now: new Date(Date.UTC(2026, 5, 23))
});

assert.equal(parsed.summary.companyCount, 3, "Should detect all three companies");
assert(parsed.summary.payableRows > 0, "Should detect payable rows");
assert(parsed.summary.receivableRows > 0, "Should detect receivable rows");
assert(parsed.summary.totalPayable >= 0, "Payable total should be numeric");
assert(parsed.summary.totalReceivable >= 0, "Receivable total should be numeric");
assert(parsed.companies.some((company) => company.companyCode === "FOCUS_MEDIA"), "Focus Media company missing");
assert(parsed.companies.some((company) => company.companyCode === "EXCELLENCE_MEDIA"), "Excellence Media company missing");
assert(parsed.companies.some((company) => company.companyCode === "FOCUS_BG"), "Focus BG company missing");

console.log(JSON.stringify({
  ok: true,
  reportDate: parsed.reportDate?.toISOString().slice(0, 10) || null,
  summary: parsed.summary,
  companies: parsed.companies.map((company) => ({
    companyCode: company.companyCode,
    payableRows: company.payableRows,
    receivableRows: company.receivableRows,
    remainingPayable: company.remainingPayable,
    remainingReceivable: company.remainingReceivable,
    issueCount: company.issueCount
  }))
}, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
