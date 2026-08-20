import crypto from "node:crypto";
import { authSecret, base64Url, secureEqual } from "@/lib/security-secrets";
import { companyEntities } from "@/lib/company-entities";
import { detectFinancialEntity, normalizedIban } from "@/lib/financial-partners";
import { normalizeFiscalCode } from "@/lib/smartbill-import";

const MAX_CSV_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 100_000;
const MAX_COLUMNS = 128;
const MAX_CELL_TEXT = 32_767;
const TOKEN_MAX_AGE_MS = 30 * 60 * 1000;

const columns = {
  issuedDate: ["data emitere extras"],
  issuedTime: ["ora emitere extras"],
  periodStart: ["data inceput"],
  periodEnd: ["data finala"],
  currency: ["valuta"],
  accountIban: ["contul pentru care s a generat extrasul"],
  accountHolder: ["titular cont"],
  openingBalance: ["sold contabil initial"],
  bookedDate: ["data finalizarii tranzactiei"],
  bookedTime: ["ora finalizare tranzactie"],
  description: ["tranzactii finalizate detalii"],
  documentReference: ["referinta oper document"],
  debit: ["debit suma"],
  credit: ["credit suma"],
  closingBalance: ["sold contabil final"]
} as const;

export type BankTransactionClassification =
  | "customer_receipt_candidate"
  | "supplier_payment_candidate"
  | "card_purchase"
  | "bank_fee"
  | "tax_payment"
  | "internal_transfer"
  | "intercompany_transfer"
  | "other"
  | "needs_review";

export type BcrGeorgeTransactionRow = {
  rowNumber: number;
  bookedAt: Date;
  valueDate: Date | null;
  debitAmount: string;
  creditAmount: string;
  currency: string;
  description: string;
  documentReference: string | null;
  bankReference: string | null;
  payerName: string | null;
  payerIban: string | null;
  payerTaxId: string | null;
  beneficiaryName: string | null;
  beneficiaryIban: string | null;
  beneficiaryTaxId: string | null;
  paymentDetails: string | null;
  merchantName: string | null;
  maskedCard: string | null;
  transactionType: string | null;
  classification: BankTransactionClassification;
  fingerprint: string;
  openingBalance: string | null;
  closingBalance: string | null;
  raw: Record<string, string>;
  warnings: string[];
};

export type BcrGeorgeStatementPreview = {
  version: 1;
  fileHash: string;
  fileName: string;
  fileSize: number;
  companyCode: string;
  legalName: string;
  accountHolder: string;
  accountIban: string;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date | null;
  openingBalance: string | null;
  closingBalance: string | null;
  headerRow: number;
  detectedColumns: string[];
  rows: BcrGeorgeTransactionRow[];
  warnings: string[];
};

export function parseBcrGeorgeStatement(input: Buffer, fileName: string, selectedCompanyCode?: string | null): BcrGeorgeStatementPreview {
  if (input.length > MAX_CSV_BYTES) throw new Error("Extrasul bancar depaseste limita de 20 MB.");
  if (input.includes(0)) throw new Error("Fisierul incarcat nu este un CSV text valid.");
  const text = decodeCsv(input);
  const parsed = parseQuotedCsv(text);
  if (!parsed.length) throw new Error("Extrasul bancar este gol.");
  const headerIndex = findHeaderRow(parsed);
  if (headerIndex < 0) throw new Error("Nu am gasit antetul BCR/George asteptat.");
  const header = parsed[headerIndex].map(cleanCell);
  const map = mapColumns(header);
  const sourceRows = parsed.slice(headerIndex + 1);
  const first = sourceRows.find((row) => cleanCell(row[map.accountIban]) && cleanCell(row[map.accountHolder]));
  if (!first) throw new Error("Extrasul nu contine titularul si contul bancar.");
  const accountHolder = cleanCell(first[map.accountHolder]);
  let detectedEntity;
  try {
    detectedEntity = detectFinancialEntity({ legalName: accountHolder });
  } catch (error) {
    if (!selectedCompanyCode) throw error;
    detectedEntity = detectFinancialEntity({ companyCode: selectedCompanyCode });
  }
  if (selectedCompanyCode && selectedCompanyCode !== detectedEntity.code) {
    throw new Error("Entitatea selectata nu corespunde titularului detectat in extrasul bancar.");
  }
  const accountIban = normalizedIban(first[map.accountIban]);
  const currency = normalizeCurrency(first[map.currency]);
  const periodStart = parseDate(first[map.periodStart]);
  const periodEnd = parseDate(first[map.periodEnd]);
  if (!accountIban || !currency || !periodStart || !periodEnd) throw new Error("Metadatele extrasului sunt incomplete.");

  const rows = sourceRows.flatMap((source, index) => {
    const rowNumber = headerIndex + index + 2;
    const description = cleanCell(source[map.description]);
    const bookedDate = cleanCell(source[map.bookedDate]);
    const debit = parseBankMoney(source[map.debit]);
    const credit = parseBankMoney(source[map.credit]);
    if (!description && !bookedDate && debit === "0.00" && credit === "0.00") return [];
    if (!description || !bookedDate) return [];
    const bookedAt = parseBucharestDateTime(bookedDate, cleanCell(source[map.bookedTime]) || "00:00");
    if (!bookedAt) return [];
    const details = parseDescription(description);
    const warnings: string[] = [];
    if (debit !== "0.00" && credit !== "0.00") warnings.push("debit_and_credit_positive");
    const classification = classifyTransaction({
      debit,
      credit,
      description,
      details,
      currentTaxId: detectedEntity.taxId
    });
    const documentReference = cleanCell(source[map.documentReference]) || null;
    const openingBalance = nullableMoney(source[map.openingBalance]);
    const closingBalance = nullableMoney(source[map.closingBalance]);
    const fingerprint = hash([
      detectedEntity.code,
      accountIban,
      bookedAt.toISOString(),
      debit,
      credit,
      currency,
      documentReference || "",
      normalizeText(description),
      openingBalance || "",
      closingBalance || ""
    ].join("|"));
    return [{
      rowNumber,
      bookedAt,
      valueDate: details.valueDate,
      debitAmount: debit,
      creditAmount: credit,
      currency,
      description,
      documentReference,
      bankReference: details.bankReference,
      payerName: details.payerName,
      payerIban: details.payerIban,
      payerTaxId: details.payerTaxId,
      beneficiaryName: details.beneficiaryName,
      beneficiaryIban: details.beneficiaryIban,
      beneficiaryTaxId: details.beneficiaryTaxId,
      paymentDetails: details.paymentDetails,
      merchantName: details.merchantName,
      maskedCard: details.maskedCard,
      transactionType: details.transactionType,
      classification,
      fingerprint,
      openingBalance,
      closingBalance,
      raw: Object.fromEntries(header.map((key, column) => [key || `column_${column + 1}`, cleanCell(source[column])])),
      warnings
    } satisfies BcrGeorgeTransactionRow];
  });
  const issuedAt = parseBucharestDateTime(cleanCell(first[map.issuedDate]), cleanCell(first[map.issuedTime]) || "00:00");
  return {
    version: 1,
    fileHash: hash(input),
    fileName,
    fileSize: input.length,
    companyCode: detectedEntity.code,
    legalName: detectedEntity.legalName,
    accountHolder,
    accountIban,
    currency,
    periodStart,
    periodEnd,
    issuedAt,
    openingBalance: rows[0]?.openingBalance || nullableMoney(first[map.openingBalance]),
    closingBalance: [...rows].reverse().find((row) => row.closingBalance)?.closingBalance || null,
    headerRow: headerIndex + 1,
    detectedColumns: header.filter(Boolean),
    rows,
    warnings: rows.flatMap((row) => row.warnings.map((warning) => `Rand ${row.rowNumber}: ${warning}`))
  };
}

export function createBankImportToken(preview: BcrGeorgeStatementPreview) {
  const payload = base64Url(JSON.stringify({ generatedAt: new Date().toISOString(), preview }));
  const signature = base64Url(crypto.createHmac("sha256", tokenSecret()).update(payload).digest());
  return `${payload}.${signature}`;
}

export function verifyBankImportToken(token: string): BcrGeorgeStatementPreview {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new Error("Tokenul preview-ului bancar este invalid.");
  const expected = base64Url(crypto.createHmac("sha256", tokenSecret()).update(payload).digest());
  if (!secureEqual(expected, signature)) throw new Error("Tokenul preview-ului bancar este invalid.");
  const parsed = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  if (!parsed.generatedAt || Date.now() - new Date(parsed.generatedAt).getTime() > TOKEN_MAX_AGE_MS) {
    throw new Error("Preview-ul bancar a expirat. Reincarca fisierul.");
  }
  const preview = parsed.preview as BcrGeorgeStatementPreview;
  preview.periodStart = new Date(preview.periodStart);
  preview.periodEnd = new Date(preview.periodEnd);
  preview.issuedAt = preview.issuedAt ? new Date(preview.issuedAt) : null;
  preview.rows = preview.rows.map((row) => ({ ...row, bookedAt: new Date(row.bookedAt), valueDate: row.valueDate ? new Date(row.valueDate) : null }));
  return preview;
}

export function parseBankMoney(value: unknown) {
  const text = cleanCell(value).replace(/\s/g, "");
  if (!text) return "0.00";
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  const normalized = lastComma >= 0 && lastDot >= 0
    ? lastComma > lastDot
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "")
    : lastComma >= 0
      ? text.replace(/\./g, "").replace(",", ".")
      : text;
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error("Valoare bancara invalida.");
  const [whole, fraction = ""] = normalized.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

function nullableMoney(value: unknown) {
  const text = cleanCell(value);
  return text ? parseBankMoney(text) : null;
}

function parseQuotedCsv(text: string) {
  const delimiter = detectCsvDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; continue; }
      if (char === '"') { quoted = false; continue; }
      cell += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === delimiter) { row.push(cell); cell = ""; continue; }
    if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.length > MAX_COLUMNS) throw new Error("Extrasul are prea multe coloane.");
      rows.push(row);
      if (rows.length > MAX_ROWS) throw new Error("Extrasul are prea multe randuri.");
      row = []; cell = ""; continue;
    }
    cell += char;
    if (cell.length > MAX_CELL_TEXT) throw new Error("Extrasul contine o celula prea lunga.");
  }
  if (quoted) throw new Error("CSV corupt: ghilimele neinchise.");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function detectCsvDelimiter(text: string) {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  let lines = 0;
  for (let index = 0; index < text.length && lines < 3; index += 1) {
    const char = text[index];
    if (char === '"' && text[index + 1] === '"' && quoted) { index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === ",") commas += 1;
    if (!quoted && char === ";") semicolons += 1;
    if (!quoted && char === "\n") lines += 1;
  }
  return semicolons > commas ? ";" : ",";
}

function decodeCsv(input: Buffer) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(input).replace(/^\uFEFF/, "");
  if (!utf8.includes("\uFFFD")) return utf8;
  return new TextDecoder("windows-1250").decode(input).replace(/^\uFEFF/, "");
}

function findHeaderRow(rows: string[][]) {
  return rows.findIndex((row) => {
    const values = new Set(row.map(normalizeHeader));
    return columns.bookedDate.some((value) => values.has(value)) && columns.description.some((value) => values.has(value)) && columns.debit.some((value) => values.has(value)) && columns.credit.some((value) => values.has(value));
  });
}

function mapColumns(header: string[]) {
  return Object.fromEntries(Object.entries(columns).map(([key, aliases]) => {
    const index = header.findIndex((value) => (aliases as readonly string[]).includes(normalizeHeader(value)));
    if (index < 0) throw new Error(`Coloana obligatorie lipseste: ${aliases[0]}.`);
    return [key, index];
  })) as Record<keyof typeof columns, number>;
}

function parseDescription(description: string) {
  const payer = party(description, "Platitor");
  const beneficiary = party(description, "Beneficiar");
  const valueDateMatch = description.match(/data valutei\s+(\d{2})-(\d{2})-(\d{4})/i);
  const reference = description.match(/Referinta\s+([A-Z0-9]+)/i)?.[1] || null;
  const details = description.match(/-Detalii:\s*([\s\S]*)$/i)?.[1]?.trim() || null;
  const merchant = description.match(/Locatie:\s*(.+?)(?:\.\s*Data_Ora:|$)/i)?.[1]?.trim() || null;
  const maskedCard = description.match(/Nr card\s+([0-9X]+)/i)?.[1] || description.match(/cardul\s+([0-9X]+)/i)?.[1] || null;
  return {
    payerName: payer.name,
    payerIban: payer.iban,
    payerTaxId: payer.taxId,
    beneficiaryName: beneficiary.name,
    beneficiaryIban: beneficiary.iban,
    beneficiaryTaxId: beneficiary.taxId,
    paymentDetails: details,
    bankReference: reference,
    merchantName: merchant,
    maskedCard,
    valueDate: valueDateMatch ? parseDate(`${valueDateMatch[1]}.${valueDateMatch[2]}.${valueDateMatch[3]}`) : null,
    transactionType: description.match(/Apple Pay|Tranzactie comerciant/i) ? "card" : description.match(/Ordin de plata|Plata Instant|Decontare/i) ? "bank_transfer" : description.match(/comision/i) ? "fee" : null
  };
}

function party(description: string, label: "Platitor" | "Beneficiar") {
  const next = label === "Platitor" ? "Beneficiar" : "Detalii";
  const match = description.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?:-${next}:|$)`, "i"));
  if (!match) return { name: null, iban: null, taxId: null };
  const parts = match[1].split(";").map((value) => value.trim()).filter(Boolean);
  const iban = parts.find((value) => /^[A-Z]{2}\d{2}[A-Z0-9]{10,}$/i.test(value)) || null;
  const tax = match[1].match(/CODFISC\s*([A-Z0-9]+)/i)?.[1] || null;
  const name = parts[0]?.replace(/^[-\s]+/, "") || null;
  return { name, iban: iban ? normalizedIban(iban) : null, taxId: normalizeFiscalCode(tax) };
}

function classifyTransaction(input: { debit: string; credit: string; description: string; details: ReturnType<typeof parseDescription>; currentTaxId: string | null }) {
  const debit = input.debit !== "0.00";
  const credit = input.credit !== "0.00";
  const text = normalizeText(input.description);
  if (debit && credit) return "needs_review";
  if (/tranzactie comerciant|apple pay|locatie:/.test(text)) return "card_purchase";
  if (/comision|administrare pachet|mentcard/.test(text)) return "bank_fee";
  if (/bugetul de stat|trezorer|trez\d/.test(text)) return "tax_payment";
  const ownTax = normalizeFiscalCode(input.currentTaxId);
  const sameTax = ownTax && (input.details.payerTaxId === ownTax || input.details.beneficiaryTaxId === ownTax);
  if (/conturi proprii/.test(text) || (input.details.payerTaxId && input.details.payerTaxId === input.details.beneficiaryTaxId) || (sameTax && /card\s/.test(text))) return "internal_transfer";
  const otherEntity = companyEntities.map((entity) => entity.taxId).filter(Boolean).find((taxId) => taxId !== ownTax && (input.details.payerTaxId === taxId || input.details.beneficiaryTaxId === taxId));
  if (otherEntity) return "intercompany_transfer";
  if (credit) return "customer_receipt_candidate";
  if (debit) return "supplier_payment_candidate";
  return "other";
}

function parseBucharestDateTime(dateValue: string, timeValue: string) {
  const date = dateParts(dateValue);
  const time = timeValue.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!date || !time) return null;
  const wallClock = Date.UTC(date.year, date.month - 1, date.day, Number(time[1]), Number(time[2]), Number(time[3] || 0));
  let candidate = new Date(wallClock);
  for (let attempt = 0; attempt < 3; attempt += 1) candidate = new Date(wallClock - bucharestOffset(candidate));
  return candidate;
}

function bucharestOffset(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second)) - value.getTime();
}

function parseDate(value: unknown) {
  const parts = dateParts(cleanCell(value));
  return parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day)) : null;
}

function dateParts(value: string) {
  const match = value.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (!match) return null;
  const parts = { day: Number(match[1]), month: Number(match[2]), year: Number(match[3]) };
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return date.getUTCFullYear() === parts.year && date.getUTCMonth() === parts.month - 1 && date.getUTCDate() === parts.day ? parts : null;
}

function normalizeCurrency(value: unknown) {
  const currency = cleanCell(value).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Moneda extrasului este invalida.");
  return currency;
}

function cleanCell(value: unknown) { return String(value ?? "").trim().replace(/\s+/g, " "); }
function normalizeHeader(value: unknown) { return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim(); }
function normalizeText(value: unknown) { return cleanCell(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function hash(value: Buffer | string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function tokenSecret() { return process.env.FINANCIAL_IMPORT_TOKEN_SECRET?.trim() || authSecret(); }
