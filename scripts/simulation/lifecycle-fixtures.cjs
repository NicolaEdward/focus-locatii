"use strict";

// Local fictional files only. This module has no network or database access.
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

const companyTitles = {
  FOCUS_MEDIA: "SIM-OOH FOCUS MEDIA OUTDOOR S.R.L.",
  EXCELLENCE_MEDIA: "SIM-OOH EXCELLENCE MEDIA PRODUCTION S.R.L.",
  FOCUS_BG: "SIM-OOH FOCUS MEDIA - EOOD Bulgaria",
};

function dateText(value) {
  const text = value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : String(value || "").slice(0, 10);
  const date = new Date(text + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error("SYNTHETIC_FILE_DATE_REQUIRED");
  return text.slice(8, 10) + "." + text.slice(5, 7) + "." + text.slice(0, 4);
}

function cents(value) {
  const text = String(value ?? "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error("SYNTHETIC_FILE_MONEY_REQUIRED");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

function money(value) {
  return (value / 100n).toString() + "." + (value % 100n).toString().padStart(2, "0");
}

function outputDirectory(out) {
  const folder = path.resolve(out);
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  return folder;
}

function fixtureName(value, fallback) {
  const text = String(value || fallback);
  if (!/^SIM[-_A-Z0-9.]+$/i.test(text) || text.includes("..")) throw new Error("SYNTHETIC_FILE_NAME_INVALID");
  return text;
}

/** Export a fictional externally-issued-invoice ledger in the application's
 * accepted Excel layout. It creates local files, never a fiscal document in an
 * external accounting system. A caller must provide the verified synthetic VAT
 * basis explicitly. Each row represents one invoice, not an invoice line. */
function generateInvoiceFile(input, out) {
  if (!String(input.companyName || "").startsWith("SIM-OOH") || !/^SIM[A-Z0-9]+$/i.test(String(input.taxId || ""))) throw new Error("SYNTHETIC_CLIENT_IDENTITY_REQUIRED");
  const companyCode = input.companyCode || "FOCUS_MEDIA";
  if (!companyTitles[companyCode]) throw new Error("SYNTHETIC_ISSUER_INVALID");
  const rawRows = input.rows?.length ? input.rows : [input];
  const rows = rawRows.map((raw, index) => {
    const net = cents(raw.netAmount ?? input.netAmount);
    const bps = raw.vatRateBps ?? input.vatRateBps;
    if (raw.vatAmount == null && input.vatAmount == null && (!Number.isInteger(bps) || bps < 0 || bps > 10000)) throw new Error("SYNTHETIC_EXPLICIT_VAT_REQUIRED");
    const vat = raw.vatAmount != null || input.vatAmount != null ? cents(raw.vatAmount ?? input.vatAmount) : (net * BigInt(bps) + 5000n) / 10000n;
    const gross = raw.grossAmount != null ? cents(raw.grossAmount) : net + vat;
    if (gross !== net + vat || gross <= 0n) throw new Error("SYNTHETIC_FISCAL_TOTAL_MISMATCH");
    const number = fixtureName(raw.invoiceNumber || (rawRows.length === 1 ? input.invoiceNumber : `${input.invoicePrefix || 'SIM-OOH-INVOICE'}-${String(index + 1).padStart(3, '0')}`), "SIM-OOH-INVOICE-001");
    return {
      invoiceNumber: number,
      invoiceDate: raw.invoiceDate || input.invoiceDate,
      dueDate: raw.dueDate || input.dueDate,
      currency: raw.currency || input.currency,
      clientName: input.companyName,
      taxId: input.taxId,
      locationCode: raw.locationCode || input.locationCode || "",
      campaignName: raw.campaignName || input.campaignName || "",
      netAmount: money(net), vatAmount: money(vat), grossAmount: money(gross),
      billingItemId: raw.billingItemId || null,
      periodStart: raw.periodStart || input.periodStart || null,
      periodEnd: raw.periodEnd || input.periodEnd || null,
    };
  });
  if (new Set(rows.map(row => row.invoiceNumber)).size !== rows.length) throw new Error("SYNTHETIC_INVOICE_NUMBERS_MUST_BE_DISTINCT");
  for (const row of rows) if (!["RON", "EUR"].includes(row.currency)) throw new Error("SYNTHETIC_CURRENCY_REQUIRED");
  const workbook = XLSX.utils.book_new();
  const grid = [
    [companyTitles[companyCode]],
    ["SIM-OOH FICTIONAL SALES SIMULATION. NO REAL FISCAL ISSUANCE."],
    ["LISTA ÎNCASĂRI"],
    ["NR. FACTURĂ", "DATA FACTURĂ", "CLIENT", "CUI", "DATA SCADENȚEI", "MONEDA", "SUMA FACTURATĂ", "ÎNCASAT", "REST DE ÎNCASAT", "LOCAȚIE", "DETALII CAMPANIE"],
    ...rows.map(row => [row.invoiceNumber, dateText(row.invoiceDate), row.clientName, row.taxId, dateText(row.dueDate), row.currency, row.grossAmount, "0.00", row.grossAmount, row.locationCode, row.campaignName]),
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(grid), companyCode === "FOCUS_BG" ? "Focus BG EOOD" : companyCode === "EXCELLENCE_MEDIA" ? "Excellence" : "Focus Media");
  const folder = outputDirectory(out);
  const file = path.join(folder, fixtureName(input.fileStem, "SIM-OOH-INVOICE-LEDGER") + ".xlsx");
  fs.writeFileSync(file, XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }), { mode: 0o600 });
  const evidenceFile = file.replace(/\.xlsx$/, ".json");
  fs.writeFileSync(evidenceFile, JSON.stringify({ synthetic: true, purpose: "Fictional external invoice ledger imported through UI; not real fiscal issuance", companyCode, rows }, null, 2) + "\n", { mode: 0o600 });
  return { path: file, evidencePath: evidenceFile, companyCode, rows };
}

function writeSyntheticPdf(file, lines) {
  const ascii = text => String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, " ").replace(/[()\\]/g, "\\$&");
  const safeLines = ["SIM-OOH - FICTIONAL TEST DOCUMENT - NO REAL BUSINESS EFFECT", ...lines].slice(0, 30).map(ascii);
  const stream = `BT /F1 10 Tf 42 795 Td ${safeLines.map((line, index) => `${index ? "0 -21 Td " : ""}(${line}) Tj`).join("\n")} ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(file, Buffer.from(pdf), { mode: 0o600 });
  return file;
}

function generateContractFile(input, out) {
  if (!String(input.companyName || "").startsWith("SIM-OOH")) throw new Error("SYNTHETIC_CLIENT_IDENTITY_REQUIRED");
  const reference = fixtureName(input.reference, "SIM-OOH-CONTRACT-001");
  const file = path.join(outputDirectory(out), reference + ".pdf");
  const lines = [
    `Fictional contract reference: ${reference}`,
    `Fictional client: ${input.companyName}`,
    `Synthetic tax ID: ${input.taxId || 'SIM-UNVERIFIED'}`,
    `Application issuer configuration key: ${input.companyEntity || 'UNSPECIFIED'}`,
    `Fictional campaign: ${input.campaignName || ''}`,
    `Location(s): ${(input.locationCodes || [input.locationCode]).filter(Boolean).join(', ')}`,
    `Inclusive period: ${dateText(input.periodStart)} - ${dateText(input.periodEnd)}`,
    `Monthly negotiated rate: ${input.monthlyRate || 'see explicit price schedule'} ${input.currency || ''}`,
    `Payment / billing terms: ${input.paymentTerms || 'see verified fictional campaign record'}`,
    "This fixture only exercises upload, authorization and workflow linkage.",
    "It is not signed, does not establish real facts and must never certify a real rental.",
    ...(input.lines || []),
  ];
  return { path: writeSyntheticPdf(file, lines), reference };
}

function generateFiscalEvidenceFile(input, out) {
  if (!String(input.companyName || "").startsWith("SIM-OOH") || !/^SIM[A-Z0-9]+$/i.test(String(input.taxId || ""))) throw new Error("SYNTHETIC_CLIENT_IDENTITY_REQUIRED");
  const reference = fixtureName(input.invoiceNumber, "SIM-OOH-INVOICE-001");
  const file = path.join(outputDirectory(out), reference + ".pdf");
  const net = cents(input.netAmount), vat = cents(input.vatAmount), gross = cents(input.grossAmount);
  if (net + vat !== gross) throw new Error("SYNTHETIC_FISCAL_TOTAL_MISMATCH");
  return { path: writeSyntheticPdf(file, [
    "Fictional invoice evidence fixture. NO real fiscal issuance.",
    `Synthetic invoice: ${reference}`,
    `Fictional client: ${input.companyName}`,
    `Synthetic tax ID: ${input.taxId}`,
    `Net: ${money(net)} ${input.currency}`,
    `VAT: ${money(vat)} ${input.currency}`,
    `Gross: ${money(gross)} ${input.currency}`,
    `Invoice date: ${dateText(input.invoiceDate)}`,
    `Due date: ${dateText(input.dueDate)}`,
    `Synthetic campaign: ${input.campaignName || ''}`,
    "For local UI verification only; never send to a customer or accounting provider.",
  ]), reference };
}

module.exports = { generateInvoiceFile, generateContractFile, generateFiscalEvidenceFile };
