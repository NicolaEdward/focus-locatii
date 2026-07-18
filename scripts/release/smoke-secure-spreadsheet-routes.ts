import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import accounts from "./preview-accounts.json";

const baseUrl = String(process.env.SMOKE_BASE_URL || "http://127.0.0.1:3017").replace(/\/$/, "");
const password = process.env.PREVIEW_TEST_PASSWORD || "";
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "";
if (!password) throw new Error("PREVIEW_TEST_PASSWORD is missing.");

const prisma = new PrismaClient();

async function main() {
  const before = await counts();
  const financeCookie = await login(requiredAccount("FINANCE_OPERATOR").email);
  const cooCookie = await login(requiredAccount("COO").email);

  const valid = smartBillFixture();
  const preview = await postFile("/api/admin/financial/smartbill/preview", financeCookie, valid, {
    reportType: "customer_invoices",
    companyName: "Focus Media"
  });
  assert.equal(preview.response.status, 200, `SmartBill sterile preview returned ${preview.response.status}: ${preview.text.slice(0, 300)}`);
  const payload = JSON.parse(preview.text);
  assert.equal(payload.preview?.rows?.length, 1);
  assert.equal(preview.text.includes("SUM(2000,2000)"), false, "formula source must never be returned by preview");

  const malicious = excessiveColumnFixture();
  const rejected = [];
  const rejectionCases: Array<{ route: string; cookie: string; fields: Record<string, string> }> = [
    { route: "/api/admin/financial/smartbill/preview", cookie: financeCookie, fields: { reportType: "customer_invoices", companyName: "Focus Media" } },
    { route: "/api/admin/receivables-import", cookie: financeCookie, fields: {} },
    { route: "/api/admin/financial/upload", cookie: financeCookie, fields: {} },
    { route: "/api/import/excel", cookie: cooCookie, fields: {} }
  ];
  for (const item of rejectionCases) {
    const result = await postFile(item.route, item.cookie, malicious, item.fields);
    assert.equal(result.response.status, 400, `${item.route} must reject excessive columns before writes: ${result.response.status} ${result.text.slice(0, 200)}`);
    rejected.push({ route: item.route, status: result.response.status });
  }

  const after = await counts();
  assert.deepEqual(after, before, "preview and rejected uploads must not write staging or canonical records");
  console.log(JSON.stringify({ ok: true, baseUrl, sterilePreviewRows: 1, rejected, before, after }, null, 2));
}

async function counts() {
  const [locations, importBatches, reportUploads, importRows, receivables, payments] = await Promise.all([
    prisma.location.count(),
    prisma.importBatch.count(),
    prisma.financialReportUpload.count(),
    prisma.financialReceivableImportRow.count(),
    prisma.financialReceivable.count(),
    prisma.financialReceivablePayment.count()
  ]);
  return { locations, importBatches, reportUploads, importRows, receivables, payments };
}

async function login(email: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: withPreviewBypass({ "content-type": "application/json" }),
    body: JSON.stringify({ email, password })
  });
  assert.equal(response.status, 200, `Login failed for ${email}: ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

async function postFile(route: string, cookie: string, buffer: Buffer, fields: Record<string, string>) {
  const form = new FormData();
  const bytes = new Uint8Array(buffer.length);
  bytes.set(buffer);
  form.set("file", new File([bytes], "synthetic-security.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await fetch(`${baseUrl}${route}`, { method: "POST", headers: withPreviewBypass({ cookie }), body: form });
  return { response, text: await response.text() };
}

function withPreviewBypass(headers: Record<string, string>) {
  return bypassSecret
    ? { ...headers, "x-vercel-protection-bypass": bypassSecret }
    : headers;
}

function smartBillFixture() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Client", "CIF", "Adresa", "Factura", "Data emiterii", "Data scadentei", "Valoare fara TVA", "TVA", "Valoare totala", "Moneda", "Status"],
    ["Client Sintetic Preview SRL", "ROPREVIEW999", "Adresă sintetică", "PV-SEC-001", "19.07.2026", "19.08.2026", 3_361.34, 638.66, 4_000, "RON", "Emisa"]
  ]);
  sheet.I2 = { t: "n", v: 4_000, f: "SUM(2000,2000)" };
  return workbook(sheet);
}

function excessiveColumnFixture() {
  const sheet: XLSX.WorkSheet = {
    A1: { t: "s", v: "Client" },
    DY1: { t: "s", v: "Coloană excesivă" },
    "!ref": "A1:DY1"
  };
  return workbook(sheet);
}

function workbook(sheet: XLSX.WorkSheet) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Date");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

function requiredAccount(role: string) {
  const account = accounts.find((item) => item.role === role);
  if (!account) throw new Error(`Preview account is missing for ${role}.`);
  return account;
}

void main().finally(() => prisma.$disconnect()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
