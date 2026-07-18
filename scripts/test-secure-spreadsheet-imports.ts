import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { parseInventoryWorkbook } from "../src/lib/import-excel";
import { parseReceivablesWorkbook } from "../src/lib/receivables-import-parser";
import {
  parseSecureSpreadsheet,
  SPREADSHEET_LIMITS,
  SpreadsheetSecurityError,
  validateSpreadsheetEnvelope
} from "../src/lib/secure-spreadsheet";
import { escapeSpreadsheetFormula, sanitizeSpreadsheetRows } from "../src/lib/spreadsheet-export";

async function main() {
  assert.equal(XLSX.version, "0.20.3", "security tests must run against the patched parser");

  const valid = workbookBuffer("Date import", [
    ["Cod", "Oraș", "Valoare", "Dată"],
    ["B01", "București", 4_000, new Date("2026-07-19T00:00:00.000Z")]
  ]);
  const parsed = await parseSecureSpreadsheet({ buffer: valid, fileName: "valid.xlsx", mimeType: xlsxMime(), purpose: "test" });
  assert.equal(parsed.sheets.length, 1);
  assert.equal(parsed.sheets[0].rows[1][1], "București");
  assert.equal(parsed.sheets[0].rows[1][2], 4_000);
  assert.ok(parsed.sheets[0].rows[1][3] instanceof Date);

  await expectSecurityCode(
    () => parseSecureSpreadsheet({ buffer: workbookBuffer("Gol", []), fileName: "gol.xlsx", purpose: "test" }),
    "EMPTY_WORKBOOK"
  );
  await expectSecurityCode(
    () => parseSecureSpreadsheet({ buffer: valid, fileName: "valid.xls", purpose: "test" }),
    "MAGIC_MISMATCH"
  );
  await expectSecurityCode(
    () => parseSecureSpreadsheet({ buffer: valid, fileName: "valid.xlsx", mimeType: "text/html", purpose: "test" }),
    "UNSUPPORTED_MIME"
  );
  await expectSecurityCode(
    () => parseSecureSpreadsheet({ buffer: Buffer.from("PK\u0003\u0004corupt"), fileName: "corupt.xlsx", purpose: "test" }),
    "CORRUPT_ZIP"
  );
  assert.throws(
    () => validateSpreadsheetEnvelope({ buffer: Buffer.alloc(SPREADSHEET_LIMITS.maxCompressedBytes + 1), fileName: "mare.xlsx", purpose: "test" }),
    (error: unknown) => error instanceof SpreadsheetSecurityError && error.code === "FILE_TOO_LARGE"
  );
  const exactBoundary = Buffer.alloc(SPREADSHEET_LIMITS.maxCompressedBytes);
  exactBoundary.writeUInt32LE(0x04034b50, 0);
  assert.throws(
    () => validateSpreadsheetEnvelope({ buffer: exactBoundary, fileName: "limita.xlsx", purpose: "test" }),
    (error: unknown) => error instanceof SpreadsheetSecurityError && error.code !== "FILE_TOO_LARGE",
    "exactly 20 MiB reaches structural validation rather than the size rejection"
  );

  const zipBomb = mutateFirstCentralEntry(valid, (buffer, offset) => buffer.writeUInt32LE(SPREADSHEET_LIMITS.maxSingleEntryBytes + 1, offset + 24));
  await expectSecurityCode(
    () => parseSecureSpreadsheet({ buffer: zipBomb, fileName: "zip-bomb.xlsx", purpose: "test" }),
    "ZIP_ENTRY_TOO_LARGE"
  );
  const encrypted = mutateFirstCentralEntry(valid, (buffer, offset) => buffer.writeUInt16LE(buffer.readUInt16LE(offset + 8) | 1, offset + 8));
  await expectSecurityCode(
    () => parseSecureSpreadsheet({ buffer: encrypted, fileName: "encrypted.xlsx", purpose: "test" }),
    "ENCRYPTED_WORKBOOK"
  );

  await expectSecurityCode(
    () => parseSecureSpreadsheet({ buffer: sparseWorkbook("A1:A25001", "A25001"), fileName: "rows.xlsx", purpose: "test" }),
    "TOO_MANY_ROWS"
  );
  await expectSecurityCode(
    () => parseSecureSpreadsheet({ buffer: sparseWorkbook("A1:DY1", "DY1"), fileName: "columns.xlsx", purpose: "test" }),
    "TOO_MANY_COLUMNS"
  );
  await expectSecurityCode(
    () => parseSecureSpreadsheet({ buffer: workbookBuffer("prototype", [["x"]]), fileName: "prototype.xlsx", purpose: "test" }),
    "UNSAFE_SHEET_NAME"
  );

  const formulaSheet = XLSX.utils.aoa_to_sheet([["Valoare"], [4_000]]);
  formulaSheet.A2 = { t: "n", v: 4_000, f: "SUM(2000,2000)" };
  const formulaBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(formulaBook, formulaSheet, "Date");
  const formulaParsed = await parseSecureSpreadsheet({ buffer: writeBook(formulaBook), fileName: "formula.xlsx", purpose: "test" });
  assert.equal(formulaParsed.metadata.formulaCellCount, 1);
  assert.equal(formulaParsed.sheets[0].rows[1][0], 4_000, "only the inert cached value is returned");
  assert.equal(JSON.stringify(formulaParsed).includes("SUM(2000,2000)"), false, "formula source must not leave the worker");

  const longInput = "a".repeat(30_000);
  const longStarted = performance.now();
  const longParsed = await parseSecureSpreadsheet({ buffer: workbookBuffer("Date", [[longInput]]), fileName: "long.xlsx", purpose: "test" });
  assert.equal(longParsed.sheets[0].rows[0][0], longInput);
  assert.ok(performance.now() - longStarted < SPREADSHEET_LIMITS.parseTimeoutMs, "long input must stay below the parser deadline");

  const aborted = new AbortController();
  aborted.abort();
  await expectSecurityCode(
    () => parseSecureSpreadsheet({ buffer: valid, fileName: "cancelled.xlsx", purpose: "test", signal: aborted.signal }),
    "PARSE_CANCELLED"
  );

  assert.equal(escapeSpreadsheetFormula("=HYPERLINK(\"https://invalid\")"), "'=HYPERLINK(\"https://invalid\")");
  assert.equal(escapeSpreadsheetFormula("  @SUM(A1:A2)"), "'  @SUM(A1:A2)");
  assert.equal(escapeSpreadsheetFormula(4_000), 4_000);
  const safeExportRows = sanitizeSpreadsheetRows([{ Client: "+cmd", Valoare: 100 }]);
  assert.equal(safeExportRows[0].Client, "'+cmd");
  assert.equal(safeExportRows[0].Valoare, 100);

  const inventoryBook = XLSX.utils.book_new();
  const inventorySheet = XLSX.utils.aoa_to_sheet([
    ["Nr", "City", "Address", "GPS", "Photo Link", "Availability"],
    ["B01", "București", "Piața Presei", "Maps", "Photo", "Disponibil"]
  ]);
  inventorySheet.D2.l = { Target: "https://maps.google.com/?q=44.4800,26.0700" };
  inventorySheet.E2.l = { Target: "https://example.test/photo.jpg" };
  XLSX.utils.book_append_sheet(inventoryBook, inventorySheet, "Panouri");
  const inventoryPlan = await parseInventoryWorkbook({ buffer: writeBook(inventoryBook), fileName: "inventory.xlsx", mimeType: xlsxMime() });
  assert.equal(inventoryPlan.length, 1);
  assert.equal(inventoryPlan[0].code, "B01");
  assert.match(inventoryPlan[0].data.mapsUrl, /^https:\/\//);

  const missingSection = await parseReceivablesWorkbook({
    buffer: workbookBuffer("Focus Media", [["FOCUS MEDIA"], ["Alt raport"], ["Client", "Sumă"]]),
    fileName: "receivables.xlsx"
  });
  assert.equal(missingSection.rows.length, 0);
  assert.ok(missingSection.issues.some((issue) => issue.type === "missing_receivables_section"));

  const root = path.resolve(process.cwd());
  const secureSource = fs.readFileSync(path.join(root, "src/lib/secure-spreadsheet.ts"), "utf8");
  const inventorySource = fs.readFileSync(path.join(root, "src/lib/import-excel.ts"), "utf8");
  const smartBillPreview = fs.readFileSync(path.join(root, "src/app/api/admin/financial/smartbill/preview/route.ts"), "utf8");
  const jsonImport = fs.readFileSync(path.join(root, "src/app/api/import/json/route.ts"), "utf8");
  const styledExport = fs.readFileSync(path.join(root, "src/lib/styled-xlsx.ts"), "utf8");
  const csvExport = fs.readFileSync(path.join(root, "src/app/api/export/csv/route.ts"), "utf8");
  const financialExport = fs.readFileSync(path.join(root, "src/app/api/admin/financial/export/route.ts"), "utf8");
  const crmExport = fs.readFileSync(path.join(root, "src/app/api/admin/crm/export.xlsx/route.ts"), "utf8");
  const decorationExport = fs.readFileSync(path.join(root, "src/lib/decoration-billing.ts"), "utf8");
  assert.doesNotMatch(secureSource, /@\/lib\/prisma|prisma\./, "the common parser must stay DB-independent");
  assert.ok(inventorySource.indexOf("parseInventoryWorkbook") < inventorySource.indexOf("prisma.importBatch.create"), "inventory validation must finish before the first import write");
  assert.doesNotMatch(smartBillPreview, /\.(create|update|upsert|delete)\(/, "SmartBill preview must remain read-only");
  assert.match(jsonImport, /MAX_JSON_BYTES/);
  assert.match(jsonImport, /UNSAFE_KEYS/);
  assert.ok(jsonImport.indexOf("const plan = locations.map") < jsonImport.indexOf("for (const item of plan)"), "JSON rows must all validate before writes");
  assert.match(styledExport, /escapeSpreadsheetFormula/);
  assert.match(csvExport, /escapeSpreadsheetFormula/);
  assert.match(financialExport, /sanitizeSpreadsheetRows/);
  assert.match(crmExport, /sanitizeSpreadsheetRows/);
  assert.match(decorationExport, /escapeSpreadsheetFormula/);
  const sourceFiles = listSourceFiles(path.join(root, "src"));
  const directReads = sourceFiles.filter((file) => file !== path.join(root, "src/lib/secure-spreadsheet.ts") && /XLSX\.read\s*\(/.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(directReads, [], "all production spreadsheet reads must use the common secure gateway");

  const optionalRealFixture = "C:/Users/edwar/Desktop/Raport Incasari _ Plati_ 23.06.2026.xlsx";
  if (fs.existsSync(optionalRealFixture)) {
    const beforeRss = process.memoryUsage().rss;
    const startedAt = performance.now();
    const real = await parseSecureSpreadsheet({
      buffer: fs.readFileSync(optionalRealFixture),
      fileName: path.basename(optionalRealFixture),
      purpose: "test"
    });
    const durationMs = Math.round(performance.now() - startedAt);
    const rssDeltaMb = Math.max(0, Math.round((process.memoryUsage().rss - beforeRss) / 1024 / 1024));
    assert.equal(real.sheets.length, 3);
    assert.ok(durationMs < SPREADSHEET_LIMITS.parseTimeoutMs);
    console.log(JSON.stringify({ realFixture: { durationMs, rssDeltaMb, rows: real.metadata.rowCount, cells: real.metadata.cellCount } }));
  }

  console.log("Secure spreadsheet tests passed: envelope, ZIP, limits, formulas, cancellation, exports and canonical parser regressions.");
}

function workbookBuffer(name: string, rows: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  return writeBook(book);
}

function sparseWorkbook(ref: string, farCell: string) {
  const book = XLSX.utils.book_new();
  const sheet: XLSX.WorkSheet = { A1: { t: "s", v: "start" }, [farCell]: { t: "s", v: "end" }, "!ref": ref };
  XLSX.utils.book_append_sheet(book, sheet, "Date");
  return writeBook(book);
}

function writeBook(book: XLSX.WorkBook) {
  return XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

function mutateFirstCentralEntry(source: Buffer, mutate: (copy: Buffer, offset: number) => void) {
  const copy = Buffer.from(source);
  const eocd = findSignatureBackwards(copy, 0x06054b50);
  assert.ok(eocd >= 0);
  const central = copy.readUInt32LE(eocd + 16);
  assert.equal(copy.readUInt32LE(central), 0x02014b50);
  mutate(copy, central);
  return copy;
}

function findSignatureBackwards(buffer: Buffer, signature: number) {
  for (let offset = buffer.length - 4; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  return -1;
}

async function expectSecurityCode(action: () => Promise<unknown>, expectedCode: string) {
  await assert.rejects(action, (error: unknown) => error instanceof SpreadsheetSecurityError && error.code === expectedCode);
}

function xlsxMime() {
  return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function listSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? listSourceFiles(absolute) : /\.(ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
