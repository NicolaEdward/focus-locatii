import crypto from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { authSecret, base64Url, secureEqual } from "@/lib/security-secrets";
import { companyEntities } from "@/lib/company-entities";
import { detectFinancialEntity, normalizedIban } from "@/lib/financial-partners";
import { normalizeFiscalCode } from "@/lib/smartbill-import";

const MAX_CSV_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 100_000;
const MAX_COLUMNS = 128;
const MAX_CELL_TEXT = 32_767;
const TOKEN_MAX_AGE_MS = 30 * 60 * 1000;
const TOKEN_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

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

const revolutColumns = {
  completedDate: ["date completed utc"],
  id: ["id"],
  type: ["type"],
  state: ["state"],
  description: ["description"],
  reference: ["reference"],
  payer: ["payer"],
  cardNumber: ["card number"],
  paymentCurrency: ["payment currency"],
  amount: ["amount"],
  totalAmount: ["total amount"],
  fee: ["fee"],
  feeCurrency: ["fee currency"],
  balance: ["balance"],
  account: ["account"],
  internationalAccountNumber: ["international account number"],
  beneficiaryAccount: ["beneficiary account number"],
  beneficiaryIban: ["beneficiary iban"],
  beneficiaryName: ["beneficiary name"],
  senderAccount: ["sender account"],
  senderName: ["sender name"]
} as const;

export const BANK_TRANSACTION_CLASSIFICATIONS = [
  "customer_receipt_candidate",
  "supplier_payment_candidate",
  "card_purchase",
  "bank_fee",
  "tax_payment",
  "payroll_payment",
  "employee_payment",
  "associate_payment",
  "dividend_payment",
  "copyright_payment",
  "internal_transfer",
  "intercompany_transfer",
  "other",
  "needs_review"
] as const;

export type BankTransactionClassification = typeof BANK_TRANSACTION_CLASSIFICATIONS[number];

export type BankStatementProvider = "bcr_george" | "revolut";

export type BankStatementAccountPreview = {
  accountKey: string;
  storageIdentifier: string;
  label: string;
  iban: string | null;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  openingBalance: string | null;
  closingBalance: string | null;
  rowCount: number;
};

export type BcrGeorgeTransactionRow = {
  rowNumber: number;
  accountKey: string;
  accountLabel: string | null;
  accountIban: string | null;
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
  version: 2;
  bankProvider: BankStatementProvider;
  bankName: string;
  fileHash: string;
  fileName: string;
  fileSize: number;
  companyCode: string;
  legalName: string;
  accountHolder: string;
  accountIban: string;
  currency: string;
  sourceRowCount: number;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date | null;
  openingBalance: string | null;
  closingBalance: string | null;
  headerRow: number;
  detectedColumns: string[];
  accounts: BankStatementAccountPreview[];
  rows: BcrGeorgeTransactionRow[];
  warnings: string[];
};

export function parseBankStatement(input: Buffer, fileName: string, selectedCompanyCode?: string | null): BcrGeorgeStatementPreview {
  validateCsvInput(input);
  const parsed = parseQuotedCsv(decodeCsv(input));
  if (!parsed.length) throw new Error("Extrasul bancar este gol.");
  if (findRevolutHeaderRow(parsed) >= 0) return parseRevolutStatementRows(input, fileName, parsed, selectedCompanyCode);
  return parseBcrGeorgeStatementRows(input, fileName, parsed, selectedCompanyCode);
}

export function parseBcrGeorgeStatement(input: Buffer, fileName: string, selectedCompanyCode?: string | null): BcrGeorgeStatementPreview {
  validateCsvInput(input);
  const parsed = parseQuotedCsv(decodeCsv(input));
  if (!parsed.length) throw new Error("Extrasul bancar este gol.");
  return parseBcrGeorgeStatementRows(input, fileName, parsed, selectedCompanyCode);
}

function parseBcrGeorgeStatementRows(input: Buffer, fileName: string, parsed: string[][], selectedCompanyCode?: string | null): BcrGeorgeStatementPreview {
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
      accountKey: `bcr:${accountIban}:${currency}`,
      accountLabel: null,
      accountIban,
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
      raw: safeRawRecord(header, source),
      warnings
    } satisfies BcrGeorgeTransactionRow];
  });
  const issuedAt = parseBucharestDateTime(cleanCell(first[map.issuedDate]), cleanCell(first[map.issuedTime]) || "00:00");
  return {
    version: 2,
    bankProvider: "bcr_george",
    bankName: "BCR / George",
    fileHash: hash(input),
    fileName,
    fileSize: input.length,
    companyCode: detectedEntity.code,
    legalName: detectedEntity.legalName,
    accountHolder,
    accountIban,
    currency,
    sourceRowCount: rows.length,
    periodStart,
    periodEnd,
    issuedAt,
    openingBalance: rows[0]?.openingBalance || nullableMoney(first[map.openingBalance]),
    closingBalance: [...rows].reverse().find((row) => row.closingBalance)?.closingBalance || null,
    headerRow: headerIndex + 1,
    detectedColumns: header.filter(Boolean),
    accounts: [{
      accountKey: `bcr:${accountIban}:${currency}`,
      storageIdentifier: accountIban,
      label: accountIban,
      iban: accountIban,
      currency,
      periodStart,
      periodEnd,
      openingBalance: rows[0]?.openingBalance || nullableMoney(first[map.openingBalance]),
      closingBalance: [...rows].reverse().find((row) => row.closingBalance)?.closingBalance || null,
      rowCount: rows.length
    }],
    rows,
    warnings: rows.flatMap((row) => row.warnings.map((warning) => `Rand ${row.rowNumber}: ${warning}`))
  };
}

export function parseRevolutStatement(input: Buffer, fileName: string, selectedCompanyCode?: string | null): BcrGeorgeStatementPreview {
  validateCsvInput(input);
  const parsed = parseQuotedCsv(decodeCsv(input));
  if (!parsed.length) throw new Error("Extrasul bancar este gol.");
  return parseRevolutStatementRows(input, fileName, parsed, selectedCompanyCode);
}

function parseRevolutStatementRows(input: Buffer, fileName: string, parsed: string[][], selectedCompanyCode?: string | null): BcrGeorgeStatementPreview {
  const headerIndex = findRevolutHeaderRow(parsed);
  if (headerIndex < 0) throw new Error("Nu am gasit antetul Revolut Business asteptat.");
  if (!selectedCompanyCode) throw new Error("Selecteaza entitatea juridica pentru extrasul Revolut; fisierul nu contine un titular verificabil.");
  const detectedEntity = detectFinancialEntity({ companyCode: selectedCompanyCode });
  const header = parsed[headerIndex].map(cleanCell);
  const map = mapRevolutColumns(header);
  const sourceRows = parsed.slice(headerIndex + 1);
  const warnings: string[] = [];
  const sourceOperations: Array<{
    accountKey: string;
    accountLabel: string;
    accountIban: string | null;
    storageIdentifier: string;
    currency: string;
    bookedAt: Date;
    rowNumber: number;
    balance: string;
    signedTotal: string;
  }> = [];
  let completedSourceRows = 0;

  const rows = sourceRows.flatMap((source, index) => {
    const rowNumber = headerIndex + index + 2;
    if (source.every((cell) => !cleanCell(cell))) return [];
    const state = cleanCell(source[map.state]).toUpperCase();
    if (state !== "COMPLETED") {
      warnings.push(`Rand ${rowNumber}: tranzactia Revolut cu starea ${state || "necunoscuta"} nu este importata.`);
      return [];
    }
    completedSourceRows += 1;
    const bookedAt = parseUtcDateTime(cleanCell(source[map.completedDate]));
    const transactionId = cleanCell(source[map.id]);
    const transactionType = cleanCell(source[map.type]).toUpperCase();
    const description = cleanCell(source[map.description]);
    const documentReference = cleanCell(source[map.reference]) || null;
    const currency = normalizeCurrency(source[map.paymentCurrency]);
    const signedAmount = parseBankMoney(source[map.amount]);
    const signedTotal = parseBankMoney(source[map.totalAmount]);
    const signedFee = parseBankMoney(source[map.fee]);
    const feeCurrency = cleanCell(source[map.feeCurrency]) ? normalizeCurrency(source[map.feeCurrency]) : currency;
    const balance = parseBankMoney(source[map.balance]);
    const accountLabel = cleanCell(source[map.account]);
    const accountIban = normalizedIban(source[map.internationalAccountNumber]) || null;
    if (!bookedAt || !transactionId || !description || !accountLabel) {
      throw new Error(`Randul Revolut ${rowNumber} nu contine data, ID, descriere sau cont.`);
    }
    const accountKey = revolutAccountKey(accountLabel, currency, accountIban);
    const storageIdentifier = revolutStorageIdentifier(accountLabel, currency, accountIban);
    sourceOperations.push({ accountKey, accountLabel, accountIban, storageIdentifier, currency, bookedAt, rowNumber, balance, signedTotal });
    const payerName = cleanCell(source[map.senderName]) || cleanCell(source[map.payer]) || (isCredit(signedAmount) ? description.replace(/^Bani ad[ăa]uga[țt]i prin\s+/i, "") : detectedEntity.legalName);
    const payerIban = normalizedIban(source[map.senderAccount]) || null;
    const beneficiaryName = cleanCell(source[map.beneficiaryName]) || (isDebit(signedAmount) ? description.replace(/^C[ăa]tre\s+/i, "") : detectedEntity.legalName);
    const beneficiaryIban = normalizedIban(source[map.beneficiaryIban]) || normalizedIban(source[map.beneficiaryAccount]) || null;
    const classification = classifyRevolutTransaction({
      transactionType,
      description,
      reference: documentReference,
      signedAmount,
      payerName,
      beneficiaryName,
      selectedCompanyCode: detectedEntity.code
    });
    const mainRow = revolutTransactionRow({
      rowNumber,
      accountKey,
      accountLabel,
      accountIban,
      bookedAt,
      currency,
      signedAmount,
      description,
      documentReference,
      transactionId,
      payerName,
      payerIban,
      beneficiaryName,
      beneficiaryIban,
      merchantName: transactionType === "CARD_PAYMENT" ? description : null,
      maskedCard: cleanCell(source[map.cardNumber]) || null,
      transactionType,
      classification,
      balance,
      raw: safeRawRecord(header, source),
      companyCode: detectedEntity.code,
      fingerprintSuffix: "main"
    });
    const result = [mainRow];
    if (!isZeroMoney(signedFee)) {
      if (feeCurrency !== currency) throw new Error(`Randul ${rowNumber} are comision in ${feeCurrency}, diferit de moneda contului ${currency}.`);
      const expectedTotal = addMoney(signedAmount, signedFee);
      if (moneyCents(expectedTotal) !== moneyCents(signedTotal)) warnings.push(`Rand ${rowNumber}: suma totala Revolut nu este egala cu suma tranzactiei plus comisionul.`);
      const feeAccountKey = revolutAccountKey(accountLabel, feeCurrency, accountIban);
      result.push(revolutTransactionRow({
        rowNumber,
        accountKey: feeAccountKey,
        accountLabel,
        accountIban,
        bookedAt,
        currency: feeCurrency,
        signedAmount: signedFee,
        description: `Comision procesare Revolut pentru ${description}`,
        documentReference,
        transactionId: `${transactionId}:fee`,
        payerName: detectedEntity.legalName,
        payerIban: accountIban,
        beneficiaryName: "Revolut",
        beneficiaryIban: null,
        merchantName: null,
        maskedCard: null,
        transactionType: "FEE",
        classification: "bank_fee",
        balance,
        raw: safeRawRecord(header, source),
        companyCode: detectedEntity.code,
        fingerprintSuffix: "fee"
      }));
    }
    return result;
  });
  if (!rows.length) throw new Error("Extrasul Revolut nu contine tranzactii finalizate importabile.");
  const exportedPeriod = revolutPeriodFromFileName(fileName);
  const periodStart = exportedPeriod?.start || new Date(Math.min(...rows.map((row) => row.bookedAt.getTime())));
  const periodEnd = exportedPeriod?.end || new Date(Math.max(...rows.map((row) => row.bookedAt.getTime())));
  const operationsByAccount = new Map<string, typeof sourceOperations>();
  sourceOperations.forEach((operation) => operationsByAccount.set(operation.accountKey, [...(operationsByAccount.get(operation.accountKey) || []), operation]));
  const accounts = [...operationsByAccount.entries()].map(([accountKey, operations]) => {
    const sourceOrder = [...operations].sort((left, right) => left.rowNumber - right.rowNumber);
    const newest = sourceOrder[0];
    const oldest = sourceOrder[sourceOrder.length - 1];
    return {
      accountKey,
      storageIdentifier: newest.storageIdentifier,
      label: newest.accountLabel,
      iban: newest.accountIban,
      currency: newest.currency,
      periodStart,
      periodEnd,
      openingBalance: subtractMoney(oldest.balance, oldest.signedTotal),
      closingBalance: newest.balance,
      rowCount: rows.filter((row) => row.accountKey === accountKey).length
    } satisfies BankStatementAccountPreview;
  }).sort((left, right) => left.currency.localeCompare(right.currency));
  const firstAccount = accounts.find((account) => account.iban) || accounts[0];
  return {
    version: 2,
    bankProvider: "revolut",
    bankName: "Revolut Business",
    fileHash: hash(input),
    fileName,
    fileSize: input.length,
    companyCode: detectedEntity.code,
    legalName: detectedEntity.legalName,
    accountHolder: detectedEntity.legalName,
    accountIban: firstAccount.iban || firstAccount.label,
    currency: accounts.length === 1 ? firstAccount.currency : "MULTI",
    sourceRowCount: completedSourceRows,
    periodStart,
    periodEnd,
    issuedAt: null,
    openingBalance: accounts.length === 1 ? firstAccount.openingBalance : null,
    closingBalance: accounts.length === 1 ? firstAccount.closingBalance : null,
    headerRow: headerIndex + 1,
    detectedColumns: header.filter(Boolean),
    accounts,
    rows,
    warnings: [...warnings, ...rows.flatMap((row) => row.warnings.map((warning) => `Rand ${row.rowNumber}: ${warning}`))]
  };
}

export function createBankImportToken(preview: BcrGeorgeStatementPreview) {
  const payload = base64Url(deflateRawSync(JSON.stringify({ generatedAt: new Date().toISOString(), preview }), { level: 9 }));
  const signedPayload = `v2.${payload}`;
  const signature = base64Url(crypto.createHmac("sha256", tokenSecret()).update(signedPayload).digest());
  return `${signedPayload}.${signature}`;
}

export function verifyBankImportToken(token: string): BcrGeorgeStatementPreview {
  const parts = token.split(".");
  const compressed = parts.length === 3 && parts[0] === "v2";
  const payload = compressed ? parts[1] : parts[0];
  const signature = compressed ? parts[2] : parts[1];
  if (!payload || !signature) throw new Error("Tokenul preview-ului bancar este invalid.");
  const signedPayload = compressed ? `v2.${payload}` : payload;
  const expected = base64Url(crypto.createHmac("sha256", tokenSecret()).update(signedPayload).digest());
  if (!secureEqual(expected, signature)) throw new Error("Tokenul preview-ului bancar este invalid.");
  const encoded = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const body = compressed ? inflateRawSync(encoded, { maxOutputLength: TOKEN_MAX_OUTPUT_BYTES }) : encoded;
  const parsed = JSON.parse(body.toString("utf8"));
  if (!parsed.generatedAt || Date.now() - new Date(parsed.generatedAt).getTime() > TOKEN_MAX_AGE_MS) {
    throw new Error("Preview-ul bancar a expirat. Reincarca fisierul.");
  }
  const preview = parsed.preview as BcrGeorgeStatementPreview;
  preview.periodStart = new Date(preview.periodStart);
  preview.periodEnd = new Date(preview.periodEnd);
  preview.issuedAt = preview.issuedAt ? new Date(preview.issuedAt) : null;
  preview.accounts = preview.accounts.map((account) => ({
    ...account,
    periodStart: new Date(account.periodStart),
    periodEnd: new Date(account.periodEnd)
  }));
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

function validateCsvInput(input: Buffer) {
  if (input.length > MAX_CSV_BYTES) throw new Error("Extrasul bancar depaseste limita de 20 MB.");
  if (input.includes(0)) throw new Error("Fisierul incarcat nu este un CSV text valid.");
}

function moneyCents(value: string) {
  const normalized = parseBankMoney(value);
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction] = unsigned.split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction);
  return negative ? -cents : cents;
}

function moneyFromCents(value: bigint) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}

function addMoney(left: string, right: string) { return moneyFromCents(moneyCents(left) + moneyCents(right)); }
function subtractMoney(left: string, right: string) { return moneyFromCents(moneyCents(left) - moneyCents(right)); }
function isDebit(value: string) { return moneyCents(value) < BigInt(0); }
function isCredit(value: string) { return moneyCents(value) > BigInt(0); }
function isZeroMoney(value: string) { return moneyCents(value) === BigInt(0); }

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

function findRevolutHeaderRow(rows: string[][]) {
  return rows.findIndex((row) => {
    const values = new Set(row.map(normalizeHeader));
    return ["date completed utc", "id", "state", "payment currency", "amount", "account"].every((value) => values.has(value));
  });
}

function mapRevolutColumns(header: string[]) {
  return Object.fromEntries(Object.entries(revolutColumns).map(([key, aliases]) => {
    const index = header.findIndex((value) => (aliases as readonly string[]).includes(normalizeHeader(value)));
    if (index < 0) throw new Error(`Coloana Revolut obligatorie lipseste: ${aliases[0]}.`);
    return [key, index];
  })) as Record<keyof typeof revolutColumns, number>;
}

function revolutTransactionRow(input: {
  rowNumber: number;
  accountKey: string;
  accountLabel: string;
  accountIban: string | null;
  bookedAt: Date;
  currency: string;
  signedAmount: string;
  description: string;
  documentReference: string | null;
  transactionId: string;
  payerName: string | null;
  payerIban: string | null;
  beneficiaryName: string | null;
  beneficiaryIban: string | null;
  merchantName: string | null;
  maskedCard: string | null;
  transactionType: string;
  classification: BankTransactionClassification;
  balance: string;
  raw: Record<string, string>;
  companyCode: string;
  fingerprintSuffix: string;
}): BcrGeorgeTransactionRow {
  const cents = moneyCents(input.signedAmount);
  return {
    rowNumber: input.rowNumber,
    accountKey: input.accountKey,
    accountLabel: input.accountLabel,
    accountIban: input.accountIban,
    bookedAt: input.bookedAt,
    valueDate: input.bookedAt,
    debitAmount: cents < BigInt(0) ? moneyFromCents(-cents) : "0.00",
    creditAmount: cents > BigInt(0) ? moneyFromCents(cents) : "0.00",
    currency: input.currency,
    description: input.description,
    documentReference: input.documentReference,
    bankReference: input.transactionId,
    payerName: input.payerName,
    payerIban: input.payerIban,
    payerTaxId: null,
    beneficiaryName: input.beneficiaryName,
    beneficiaryIban: input.beneficiaryIban,
    beneficiaryTaxId: null,
    paymentDetails: input.documentReference,
    merchantName: input.merchantName,
    maskedCard: input.maskedCard,
    transactionType: input.transactionType,
    classification: input.classification,
    fingerprint: hash([
      "revolut",
      input.companyCode,
      input.accountKey,
      input.transactionId,
      input.fingerprintSuffix,
      input.currency,
      input.signedAmount
    ].join("|")),
    openingBalance: null,
    closingBalance: input.balance,
    raw: input.raw,
    warnings: cents === BigInt(0) ? ["zero_amount"] : []
  };
}

function classifyRevolutTransaction(input: {
  transactionType: string;
  description: string;
  reference: string | null;
  signedAmount: string;
  payerName: string | null;
  beneficiaryName: string | null;
  selectedCompanyCode: string;
}): BankTransactionClassification {
  const debit = isDebit(input.signedAmount);
  const credit = isCredit(input.signedAmount);
  const text = normalizeText([input.transactionType, input.description, input.reference].filter(Boolean).join(" "));
  if (input.transactionType === "FEE" || /comision|taxa procesare|processing fee|abonament revolut/.test(text)) return "bank_fee";
  if (input.transactionType === "EXCHANGE" || /\bmain\b.*\b(?:ron|eur)\b.*\bmain\b/.test(text)) return "internal_transfer";
  if (/bugetul de stat|trezorer|anaf|impozit|taxe si contributii/.test(text)) return "tax_payment";
  if (/\bcda\b|drepturi de autor|contract de drepturi/.test(text)) return "copyright_payment";
  if (/dividend/.test(text)) return "dividend_payment";
  if (/salariu|salarii|avans salarial|indemnizatie/.test(text)) return "payroll_payment";
  if (/decont angajat|cheltuieli angajat|avans spre decont|restituire angajat/.test(text)) return "employee_payment";
  if (/imprumut asociat|restituire asociat|aport asociat|plata asociat/.test(text)) return "associate_payment";
  const counterpartyCode = companyCodeForBankParty(credit ? input.payerName : input.beneficiaryName);
  if (counterpartyCode === input.selectedCompanyCode) return "internal_transfer";
  if (counterpartyCode && counterpartyCode !== input.selectedCompanyCode) return "intercompany_transfer";
  if (input.transactionType === "CARD_PAYMENT") return "card_purchase";
  if (credit) return "customer_receipt_candidate";
  if (debit) return "supplier_payment_candidate";
  return "other";
}

function companyCodeForBankParty(value: string | null) {
  const normalized = normalizeBankParty(value);
  if (!normalized) return null;
  return companyEntities.find((entity) => {
    const legalName = normalizeBankParty(entity.legalName);
    const shortName = normalizeBankParty(entity.value);
    return normalized === legalName || normalized === shortName || normalized.includes(legalName) || legalName.includes(normalized);
  })?.code || null;
}

function normalizeBankParty(value: unknown) {
  return normalizeText(value)
    .replace(/\b(s r l|srl|sa|s a|llc|eood)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function revolutAccountKey(label: string, currency: string, iban: string | null) {
  return `revolut:${iban || normalizeBankParty(label).replace(/\s+/g, "_")}:${currency}`;
}

function revolutStorageIdentifier(label: string, currency: string, iban: string | null) {
  return `REVO:${iban || normalizeBankParty(label).replace(/\s+/g, "_").toUpperCase()}:${currency}`;
}

function parseUtcDateTime(value: string) {
  const text = cleanCell(value);
  if (!text) return null;
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : new Date(text.endsWith("Z") ? text : `${text}Z`);
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function revolutPeriodFromFileName(fileName: string) {
  const match = fileName.match(/(\d{2})-([A-Za-z]{3})-(\d{4})_(\d{2})-([A-Za-z]{3})-(\d{4})/);
  if (!match) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const startMonth = months.indexOf(match[2].toLowerCase());
  const endMonth = months.indexOf(match[5].toLowerCase());
  if (startMonth < 0 || endMonth < 0) return null;
  const start = new Date(Date.UTC(Number(match[3]), startMonth, Number(match[1])));
  const end = new Date(Date.UTC(Number(match[6]), endMonth, Number(match[4])));
  return start <= end ? { start, end } : null;
}

function safeRawRecord(header: string[], source: string[]) {
  const result: Record<string, string> = Object.create(null);
  header.forEach((value, index) => {
    const original = cleanCell(value) || `column_${index + 1}`;
    const key = ["__proto__", "constructor", "prototype"].includes(original.toLowerCase()) ? `column_${index + 1}` : original;
    result[key] = cleanCell(source[index]);
  });
  return result;
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
  if (input.details.transactionType === "fee" || /^(incasare\s+)?comision|administrare pachet|mentcard/.test(text)) return "bank_fee";
  if (/tranzactie comerciant|apple pay|locatie:/.test(text)) return "card_purchase";
  if (/bugetul de stat|trezorer|trez\d/.test(text)) return "tax_payment";
  if (/\bcda\b|drepturi de autor|contract de drepturi/.test(text)) return "copyright_payment";
  if (/dividend/.test(text)) return "dividend_payment";
  if (/salariu|salarii|avans salarial|indemnizatie/.test(text)) return "payroll_payment";
  if (/decont angajat|cheltuieli angajat|avans spre decont|restituire angajat/.test(text)) return "employee_payment";
  if (/imprumut asociat|restituire asociat|aport asociat|plata asociat/.test(text)) return "associate_payment";
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
