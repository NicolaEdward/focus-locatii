import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { parseBankStatement, type BcrGeorgeStatementPreview, type BcrGeorgeTransactionRow } from "@/lib/bcr-george-import";
import { parseSmartBillCustomerInvoices, type SmartBillCustomerInvoiceRow } from "@/lib/smartbill-import";
import { invoiceNumberComparisonKey, normalizeClientName } from "@/lib/clients";
import { canonicalTaxId, isUsableTaxId } from "@/lib/tax-id";
import { detectFinancialEntity, normalizedIban } from "@/lib/financial-partners";

export class BankReceiptEvidenceError extends Error { constructor(readonly code: string) { super(code); } }
export function receiptAssert(value: unknown, code: string): asserts value { if (!value) throw new BankReceiptEvidenceError(code); }
const digest = (value: Buffer) => crypto.createHash("sha256").update(value).digest("hex");
type Company = "FOCUS_MEDIA" | "EXCELLENCE_MEDIA";
export type ReceiptBankSource = Readonly<{ sha256: string }>;
export type ReceiptInvoiceSource = Readonly<{ sha256: string }>;
const banks = new WeakMap<ReceiptBankSource, BcrGeorgeStatementPreview>();
const invoices = new WeakMap<ReceiptInvoiceSource, { companyCode: Company; rows: SmartBillCustomerInvoiceRow[] }>();
type SourceInput = { bytes: Buffer; fileName: string; expectedHash: string; companyCode: Company };

export function verifyReceiptBankSource(input: SourceInput): ReceiptBankSource {
  receiptAssert(/^[a-f0-9]{64}$/.test(input.expectedHash) && digest(input.bytes) === input.expectedHash, "RECEIPT_BANK_SOURCE_HASH");
  const parsed = parseBankStatement(input.bytes, input.fileName, input.companyCode);
  receiptAssert(parsed.companyCode === input.companyCode && parsed.fileHash === input.expectedHash, "RECEIPT_BANK_SOURCE_SCOPE");
  const token = Object.freeze({ sha256: input.expectedHash }); banks.set(token, parsed); return token;
}
export async function verifyReceiptInvoiceSource(input: SourceInput & {issuerBinding:"owner-approved-source-sha256"}): Promise<ReceiptInvoiceSource> {
  receiptAssert(/^[a-f0-9]{64}$/.test(input.expectedHash) && digest(input.bytes) === input.expectedHash, "RECEIPT_INVOICE_SOURCE_HASH");
  const parsed = await parseSmartBillCustomerInvoices(input.bytes, { fileName: input.fileName });
  // Some owner-provided SmartBill exports have no issuer header. In that case
  // only an explicitly approved hash-to-company binding may supply the issuer.
  receiptAssert(input.issuerBinding==="owner-approved-source-sha256"&&parsed.fileHash === input.expectedHash && (!parsed.detectedCompanyCode || parsed.detectedCompanyCode === input.companyCode), "RECEIPT_INVOICE_SOURCE_SCOPE");
  receiptAssert(parsed.sheets.length===1,"RECEIPT_INVOICE_EXTRA_WORKSHEETS");
  receiptAssert(parsed.rows.filter(r=>r.totalAmount<0).every(r=>r.issues.length===0&&r.currency&&isUsableTaxId(canonicalTaxId(r.normalizedFiscalCode||r.fiscalCode))),"RECEIPT_NEGATIVE_SOURCE_IDENTITY_INVALID");
  const token = Object.freeze({ sha256: input.expectedHash });
  invoices.set(token, { companyCode: input.companyCode, rows: parsed.rows.filter((r): r is SmartBillCustomerInvoiceRow => r.kind === "customer_invoice") });
  return token;
}
export const isReceiptBankSource = (value: unknown): value is ReceiptBankSource => Boolean(value && typeof value === "object" && banks.has(value as ReceiptBankSource));
export const isReceiptInvoiceSource = (value: unknown): value is ReceiptInvoiceSource => Boolean(value && typeof value === "object" && invoices.has(value as ReceiptInvoiceSource));
function plain(value: string) { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Full series+number only; numeric-only and neighboring alphanumerics cannot match. */
export function boundedReceiptReferences(texts: readonly (string | null | undefined)[], keys: readonly string[]) {
  const text = plain(texts.filter(Boolean).join(" "));
  const matches = new Set<string>(); let abbreviatedList = false;const seriesSeen=new Set<string>();
  for (const key of new Set(keys)) {
    const parts = key.match(/^([a-z]+)(\d+)$/);
    receiptAssert(parts, "RECEIPT_INVOICE_KEY_UNSUPPORTED");
    if(seriesSeen.has(parts[1]))continue;seriesSeen.add(parts[1]);
    const series = parts[1].split("").map(escape).join("[\\s./_-]*");
    const pattern = `(?<![a-z0-9])${series}[\\s./_-]*(\\d+)(?![a-z0-9])`;
    for(const match of text.matchAll(new RegExp(pattern,"gi")))matches.add(parts[1]+match[1].replace(/^0+(?=\d)/,""));
    if (new RegExp(`${pattern}\\s*(?:[,;+&/\\-]|\\b(?:si|and)\\b)\\s*(?:[a-z]{2,12}[\\s./_-]*)?\\d`, "i").test(text)) abbreviatedList = true;
  }
  // Explicitly named unknown invoice series must not disappear merely because
  // the corresponding invoice is absent from the provided source workbook.
  for(const match of text.matchAll(/\b(?:factura|facturi|invoice|invoices|inv|fact|plata)[\s.:#-]*(?:nr[\s.:#-]*)?([a-z]{2,12})[\s./_-]*(\d+)(?![a-z0-9])/gi))matches.add(match[1]+match[2].replace(/^0+(?=\d)/,""));
  return { keys: [...matches].sort(), abbreviatedList };
}
export function receiptPayerIdentity(bank: Pick<BcrGeorgeTransactionRow,"payerTaxId"|"payerName">, invoice: Pick<SmartBillCustomerInvoiceRow,"normalizedFiscalCode"|"fiscalCode"|"clientName">) {
  const sourceTax = canonicalTaxId(invoice.normalizedFiscalCode || invoice.fiscalCode);
  receiptAssert(isUsableTaxId(sourceTax), "RECEIPT_INVOICE_TAX_MISSING");
  const payerTax = canonicalTaxId(bank.payerTaxId);
  if (payerTax) {
    receiptAssert(payerTax === sourceTax, "RECEIPT_PAYER_TAX_MISMATCH");
    return "tax_id_exact" as const;
  }
  const payerName = normalizeClientName(bank.payerName || ""), invoiceName = normalizeClientName(invoice.clientName);
  receiptAssert(payerName && invoiceName && payerName === invoiceName, "RECEIPT_PAYER_NAME_MISMATCH");
  return "name_exact" as const;
}

export function proveReceiptEvidence(input: {
  bankSource: ReceiptBankSource; invoiceSource: ReceiptInvoiceSource; companyCode: Company;
  bankSourceHash: string; invoiceSourceHash: string;
  bankRowNumber: number; bankFingerprint: string; invoiceRowNumber: number; invoiceDedupeKey: string;
}) {
  receiptAssert(isReceiptBankSource(input.bankSource) && isReceiptInvoiceSource(input.invoiceSource), "RECEIPT_SOURCE_TOKEN_INVALID");
  const bank = banks.get(input.bankSource)!, report = invoices.get(input.invoiceSource)!;
  receiptAssert(input.bankSource.sha256 === input.bankSourceHash && input.invoiceSource.sha256 === input.invoiceSourceHash && bank.companyCode === input.companyCode && report.companyCode === input.companyCode, "RECEIPT_SOURCE_SCOPE");
  const bankRows = bank.rows.filter(r => r.rowNumber === input.bankRowNumber && r.fingerprint === input.bankFingerprint);
  const invoiceRows = report.rows.filter(r => r.rowNumber === input.invoiceRowNumber && r.dedupeKey === input.invoiceDedupeKey);
  receiptAssert(bankRows.length === 1 && invoiceRows.length === 1, "RECEIPT_SOURCE_ROW_AMBIGUOUS");
  const row = bankRows[0], invoice = invoiceRows[0];
  receiptAssert(row.warnings.length === 0 && row.classification === "customer_receipt_candidate" && new Prisma.Decimal(row.creditAmount).gt(0) && new Prisma.Decimal(row.debitAmount).equals(0), "RECEIPT_BANK_NOT_CUSTOMER_CREDIT");
  receiptAssert(!invoice.ignored && invoice.issues.length === 0 && invoice.issueDate && invoice.currency === row.currency && new Prisma.Decimal(invoice.totalAmount).gt(0), "RECEIPT_INVOICE_INVALID");
  receiptAssert(new Prisma.Decimal(row.creditAmount).equals(invoice.totalAmount) && row.bookedAt >= invoice.issueDate, "RECEIPT_FULL_AMOUNT_OR_DATE_MISMATCH");
  const key = invoiceNumberComparisonKey(invoice.invoiceNumber);
  const references = boundedReceiptReferences([row.description,row.paymentDetails,row.documentReference], report.rows.map(r => invoiceNumberComparisonKey(r.invoiceNumber)));
  receiptAssert(references.keys.length === 1 && references.keys[0] === key && !references.abbreviatedList, "RECEIPT_REFERENCE_NOT_UNIQUE");
  receiptAssert(report.rows.filter(r => invoiceNumberComparisonKey(r.invoiceNumber) === key && r.currency === invoice.currency).length === 1, "RECEIPT_ORIGINAL_INVOICE_AMBIGUOUS");
  const payerBasis = receiptPayerIdentity(row, invoice);
  const taxId = canonicalTaxId(invoice.normalizedFiscalCode || invoice.fiscalCode);
  if (payerBasis === "name_exact") {
    const taxes = new Set(report.rows.filter(r => normalizeClientName(r.clientName) === normalizeClientName(row.payerName || "")).map(r => canonicalTaxId(r.normalizedFiscalCode || r.fiscalCode)));
    receiptAssert(taxes.size === 1 && taxes.has(taxId), "RECEIPT_PAYER_NAME_AMBIGUOUS");
  }
  const account = bank.accounts.find(a => a.accountKey === row.accountKey);
  receiptAssert(account, "RECEIPT_SOURCE_ACCOUNT_MISSING");
  if (bank.bankProvider === "bcr_george") {
    const cells = new Map(Object.entries(row.raw).map(([k,v]) => [plain(k).replace(/[^a-z0-9]+/g," ").trim(),v]));
    receiptAssert(normalizedIban(cells.get("contul pentru care s a generat extrasul")) === account.iban && cells.get("valuta")?.trim().toUpperCase() === row.currency, "RECEIPT_MIXED_BANK_METADATA");
    receiptAssert(detectFinancialEntity({legalName:cells.get("titular cont")}).code === input.companyCode, "RECEIPT_MIXED_BANK_METADATA");
  }
  // Copies prevent a caller from mutating the private parsed source cache.
  return {
    bankRow: structuredClone(row), account: structuredClone(account), invoice: structuredClone(invoice), invoiceKey:key,taxId,payerBasis,
    samePartyNegativeRows: structuredClone(report.rows.filter(r => r.totalAmount < 0 && r.currency === invoice.currency && canonicalTaxId(r.normalizedFiscalCode || r.fiscalCode) === taxId))
  };
}
