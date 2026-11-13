import crypto from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { invoiceNumberComparisonKey, normalizeClientName } from "@/lib/clients";
import { normalizeFiscalCode, parseSmartBillCustomerInvoices, resolveSmartBillCompanyContext, smartBillCustomerReceivableData, smartBillRawJson, assertSmartBillHistoryComplete, type SmartBillCustomerInvoiceRow } from "@/lib/smartbill-import";
import { prepareSmartBillReceivableRefresh } from "@/lib/smartbill-financial-refresh";
import { receivableNetAmount } from "@/lib/receivable-adjustments";
import { receivableStatus } from "@/lib/receivables-domain";
import { hasUnresolvedSourceFiscalReview } from "@/lib/smartbill-source-metadata";

const hash = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const moneySchema = z.string().regex(/^-?\d+(?:\.\d{1,2})?$/).nullable();
const companySchema = z.enum(["FOCUS_MEDIA", "EXCELLENCE_MEDIA"]);
const expectedSchema = z.object({
  id: z.string().min(1), updatedAt: z.string().datetime(), companyCode: z.string().nullable(), companyName: z.string(),
  legalEntityId: z.string().nullable(), invoiceNumberKey: z.string().min(1), invoiceDate: z.string().datetime().nullable(),
  currency: z.string().nullable(), invoicedAmount: moneySchema, collectedAmount: moneySchema, remainingAmount: moneySchema,
  clientId: z.string().nullable(), includedInReport: z.boolean(), status: z.string(), sourceFingerprint: z.string().nullable()
}).strict();
const existingClient = z.object({ strategy: z.literal("existing"), id: z.string().min(1), taxId: z.string(), updatedAt: z.string().datetime(), status: z.string() }).strict();
const newClient = z.object({ strategy: z.literal("create_unassigned"), normalizedFiscalCode: z.string().min(1) }).strict();
export const invoiceEvidenceOperationSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(/^[A-Za-z0-9_-]{1,96}$/),
  type: z.enum(["create", "refresh", "negative_unlinked"]), sourceSha256: digestSchema,
  sourceRowNumber: z.number().int().positive(), sourceDedupeKey: z.string().min(1).max(512),
  expectedTarget: expectedSchema.nullable(), client: z.discriminatedUnion("strategy", [existingClient, newClient])
}).strict();
export type InvoiceEvidenceOperation = z.infer<typeof invoiceEvidenceOperationSchema>;
type VerifiedSource = { readonly sha256: string; readonly companyCode: "FOCUS_MEDIA" | "EXCELLENCE_MEDIA"; readonly fileName: string };
const verifiedSources = new WeakMap<object, { rows: readonly SmartBillCustomerInvoiceRow[] }>();
export type InvoiceEvidenceExecutionContext = {
  mode: "check" | "apply"; manifestHash: string; approvedOperationHash: string; runId: string; source: VerifiedSource
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function hashInvoiceEvidenceOperation(operation: unknown) { return hash(canonical(invoiceEvidenceOperationSchema.parse(operation))); }
export async function verifyInvoiceEvidenceSource(input: { bytes: Buffer; fileName: string; expectedHash: string; companyCode: string }): Promise<VerifiedSource> {
  const companyCode = companySchema.parse(input.companyCode), sha256 = digestSchema.parse(input.expectedHash);
  const bytes = Buffer.from(input.bytes);
  if (hash(bytes) !== sha256) throw new Error("Invoice source SHA-256 mismatch.");
  const report = await parseSmartBillCustomerInvoices(bytes, { fileName: input.fileName });
  if (report.fileHash !== sha256 || report.invalidRows.length || report.sheets.length !== 1) throw new Error("Invoice source is invalid, incomplete or has multiple sheets.");
  if (report.detectedCompanyCode && report.detectedCompanyCode !== companyCode) throw new Error("Invoice issuer differs from the approved company.");
  const source = Object.freeze({ sha256, companyCode, fileName: input.fileName });
  verifiedSources.set(source, { rows: report.rows as SmartBillCustomerInvoiceRow[] });
  return source;
}
const amount = (value: unknown) => new Prisma.Decimal(value == null ? 0 : String(value));
const iso = (value: Date | null) => value?.toISOString() || null;
function inactive(row: { includedInReport: boolean; status: string }) { return !row.includedInReport || ["cancelled", "archived", "excluded"].includes(row.status); }
function expectedMatches(row: any, expected: NonNullable<InvoiceEvidenceOperation["expectedTarget"]>) {
  for (const field of ["id", "companyCode", "companyName", "legalEntityId", "currency", "clientId", "includedInReport", "status", "sourceFingerprint"] as const) if (row[field] !== expected[field]) throw new Error(`Invoice guard changed: ${field}.`);
  if (iso(row.updatedAt) !== expected.updatedAt || iso(row.invoiceDate) !== expected.invoiceDate || invoiceNumberComparisonKey(row.normalizedInvoiceNumber || row.invoiceNumber) !== expected.invoiceNumberKey) throw new Error("Invoice version or identity changed.");
  for (const field of ["invoicedAmount", "collectedAmount", "remainingAmount"] as const) if (!amount(row[field]).equals(amount(expected[field]))) throw new Error(`Invoice monetary guard changed: ${field}.`);
}
export async function executeInvoiceEvidenceOperation(input: unknown, context: InvoiceEvidenceExecutionContext) {
  const op = invoiceEvidenceOperationSchema.parse(input), operationHash = hashInvoiceEvidenceOperation(op);
  if (!["check", "apply"].includes(context.mode) || !verifiedSources.has(context.source) || context.source.sha256 !== op.sourceSha256) throw new Error("Unverified invoice source or execution mode.");
  digestSchema.parse(context.manifestHash);
  if (operationHash !== context.approvedOperationHash || !/^[A-Za-z0-9_-]{1,160}$/.test(context.runId)) throw new Error("Invoice operation approval hash mismatch.");
  const sourceRow = verifiedSources.get(context.source)!.rows.filter(r => r.rowNumber === op.sourceRowNumber && r.dedupeKey === op.sourceDedupeKey);
  if (sourceRow.length !== 1) throw new Error("Approved invoice source row is missing or ambiguous.");
  const row = sourceRow[0];
  if (row.ignored || row.issues.length || (op.type === "negative_unlinked" ? row.totalAmount >= 0 : row.totalAmount <= 0) || (op.type === "refresh") !== Boolean(op.expectedTarget)) throw new Error("Invoice operation does not match the source document.");
  if (!amount(row.netAmount).plus(amount(row.vatAmount)).equals(amount(row.totalAmount))) throw new Error("Invoice net/VAT/gross do not reconcile.");
  const companyName = context.source.companyCode === "FOCUS_MEDIA" ? "Focus Media" : "Excellence Media";
  const company = resolveSmartBillCompanyContext(companyName);
  const auditId = `invoice-evidence-${hash(op.id).slice(0,48)}`;
  return prisma.$transaction(async tx => {
    const prior = await tx.auditLog.findUnique({ where: { id: auditId }, select: { metadata: true, entityId: true } });
    if (prior) {
      const metadata = prior.metadata as Record<string, unknown> | null;
      if (metadata?.operationHash !== operationHash || metadata?.manifestHash !== context.manifestHash) throw new Error("Invoice operation ID was already used for different approved data.");
      return { operationId: op.id, operationHash, replay: true, receivableId: prior.entityId, applied: false };
    }
    const entity = await tx.financialLegalEntity.findUnique({ where: { code: company.companyCode }, select: { id: true, active: true } });
    if (!entity?.active) throw new Error("Invoice legal entity is not active/configured.");
    if (context.mode === "apply") {
      await tx.$queryRaw`SELECT id FROM portfolio_financial_legal_entities WHERE id = ${entity.id} FOR UPDATE`;
      const lockedEntity = await tx.financialLegalEntity.findUnique({ where: { id: entity.id }, select: { active: true, code: true } });
      if (!lockedEntity?.active || lockedEntity.code !== company.companyCode) throw new Error("Invoice legal entity changed before execution.");
      const committed = await tx.auditLog.findUnique({ where: { id: auditId }, select: { metadata: true, entityId: true } });
      if (committed) {
        const metadata = committed.metadata as Record<string, unknown> | null;
        if (metadata?.operationHash !== operationHash || metadata?.manifestHash !== context.manifestHash) throw new Error("Invoice operation ID was already used for different approved data.");
        return { operationId: op.id, operationHash, replay: true, receivableId: committed.entityId, applied: false };
      }
    }
    const financialRows = await tx.financialReceivable.findMany({ where: { OR: [{ companyCode: company.companyCode }, { companyName: company.companyName }] }, select: { id: true, invoiceNumber: true, normalizedInvoiceNumber: true, sourceFingerprint: true }, take: 10001 });
    assertSmartBillHistoryComplete(financialRows);
    const collisions = financialRows.filter(r => invoiceNumberComparisonKey(r.normalizedInvoiceNumber || r.invoiceNumber) === invoiceNumberComparisonKey(row.invoiceNumber) || r.sourceFingerprint === `${company.companyCode}:${row.dedupeKey}`);
    let current = null;
    if (op.expectedTarget) {
      if (context.mode === "apply") await tx.$queryRaw`SELECT id FROM portfolio_financial_receivables WHERE id = ${op.expectedTarget.id} FOR UPDATE`;
      current = await tx.financialReceivable.findUnique({ where: { id: op.expectedTarget.id } });
      if (!current) throw new Error("Invoice target no longer exists.");
      expectedMatches(current, op.expectedTarget);
      if (inactive(current) || collisions.length !== 1 || collisions[0].id !== current.id || current.currency !== row.currency || !amount(current.invoicedAmount).equals(row.totalAmount)) throw new Error("Invoice target is inactive, duplicated, or differs from source amount/currency.");
      if ((current.companyCode !== company.companyCode && current.companyName !== company.companyName) || (current.legalEntityId && current.legalEntityId !== entity.id)) throw new Error("Invoice company differs from approved source.");
    } else if (collisions.length) throw new Error("Invoice document already exists, including historical/excluded records.");
    if (context.mode === "apply" && op.client.strategy === "existing") await tx.$queryRaw`SELECT id FROM portfolio_client_accounts WHERE id = ${op.client.id} FOR UPDATE`;
    const allClients = await tx.clientAccount.findMany({ select: { id: true, taxId: true, updatedAt: true, status: true }, take: 10001 });
    assertSmartBillHistoryComplete(allClients);
    const taxMatches = allClients.filter(c => normalizeFiscalCode(c.taxId) === row.normalizedFiscalCode);
    let clientId: string;
    let createClient = false;
    if (op.client.strategy === "existing") {
      const clientSpec = op.client;
      const client = allClients.find(c => c.id === clientSpec.id);
      if (!client || taxMatches.length !== 1 || taxMatches[0].id !== client.id || client.taxId !== op.client.taxId || iso(client.updatedAt) !== op.client.updatedAt || client.status !== op.client.status || ["merged", "archived"].includes(client.status)) throw new Error("Invoice client identity or version changed.");
      if (current && current.clientId !== client.id) throw new Error("Invoice client reassignment requires a separate reviewed operation.");
      clientId = client.id;
    } else {
      if (normalizeFiscalCode(op.client.normalizedFiscalCode) !== row.normalizedFiscalCode || !row.normalizedFiscalCode || current) throw new Error("New invoice client is not proven by the source.");
      clientId = `invoice-source-client-${hash(row.normalizedFiscalCode).slice(0,40)}`;
      if (taxMatches.length && (taxMatches.length !== 1 || taxMatches[0].id !== clientId || ["merged", "archived"].includes(taxMatches[0].status))) throw new Error("A client with this tax identity appeared after the plan.");
      createClient = !taxMatches.length;
    }
    const payments = current ? await tx.financialReceivablePayment.findMany({ where: { receivableId: current.id, status: "active" }, select: { amount: true } }) : [];
    const collected = payments.length ? payments.reduce((sum,p) => sum.plus(p.amount), amount(0)) : amount(current?.collectedAmount);
    const result = { operationId: op.id, operationHash, type: op.type, companyCode: company.companyCode, sourceRowNumber: row.rowNumber, clientId, createClient, receivableId: current?.id || `invoice-source-${hash(company.companyCode+":"+row.dedupeKey).slice(0,48)}`, collectedAmount: collected.toFixed(2), applied: context.mode === "apply", replay: false };
    if (context.mode === "check") return result;
    // The operation audit, client, upload and invoice commit or roll back together.
    if (createClient) await tx.clientAccount.create({ data: { id: clientId, companyName: row.clientName, normalizedName: normalizeClientName(row.clientName), taxId: row.normalizedFiscalCode, accountOwnerUserId: null, createdByUserId: null, status: "active" } });
    const uploadId = `invoice-evidence-upload-${hash(context.runId+":"+context.source.sha256).slice(0,40)}`;
    const sourceRows = verifiedSources.get(context.source)!.rows;
    const reportDate = new Date(Math.max(...sourceRows.map(r => r.issueDate?.getTime() || 0)));
    await tx.financialReportUpload.upsert({ where: { id: uploadId }, update: {}, create: { id: uploadId, uploadedByUserId: null, legalEntityId: entity.id, reportDate, originalFileName: context.source.fileName, fileHash: `smartbill-${company.companyCode}-${context.source.sha256}`, status: "confirmed", activeVersion: false, importType: "smartbill_customer_invoices", parserName: "VerifiedInvoiceEvidenceReconciliation", parserVersion: "1", rowsRead: sourceRows.length } });
    const incoming = { ...smartBillCustomerReceivableData({ row, uploadId, companyContext: company, clientId }), legalEntityId: entity.id, partnerId: current?.partnerId };
    const sourceEvidence = { sourceSha256: context.source.sha256, manifestHash: context.manifestHash, operationHash, runId: context.runId, actorType: "owner_authorized_system" };
    const sourceClaimsPaid = /^(incasata|incasat|platita|achitata)$/i.test(row.sourceStatus || "");
    let unresolvedPaidSnapshot = false;
    if (current) {
      const refresh = await prepareSmartBillReceivableRefresh(tx, current, incoming);
      const raw = { ...refresh.rawRowJson as Prisma.InputJsonObject, sourceEvidence };
      const net = receivableNetAmount(row.totalAmount, raw), remaining = Prisma.Decimal.max(net.minus(collected), 0);
      unresolvedPaidSnapshot = sourceClaimsPaid && remaining.greaterThan(0);
      await tx.financialReceivable.update({ where: { id: current.id }, data: { ...refresh, rawRowJson: raw, collectedAmount: collected, remainingAmount: remaining, status: receivableStatus({ invoiceAmount: net, collectedAmount: collected, dueDate: row.dueDate }), needsReview: current.needsReview || hasUnresolvedSourceFiscalReview(raw) || (sourceClaimsPaid && remaining.greaterThan(0)) } });
    } else {
      const negative = op.type === "negative_unlinked";
      unresolvedPaidSnapshot = !negative && sourceClaimsPaid;
      await tx.financialReceivable.create({ data: { ...incoming, id: result.receivableId, partnerId: null, rawRowJson: { ...smartBillRawJson(row, company), sourceEvidence, ...(negative ? { adjustmentReview: { status: "unlinked", originalReceivableId: null, automaticallyApplied: false } } : {}) }, collectedAmount: 0, collectedAt: null, remainingAmount: negative ? 0 : row.totalAmount, includedInReport: !negative, needsReview: negative || sourceClaimsPaid, status: negative ? "needs_review" : incoming.status, rowType: negative ? "smartbill_customer_adjustment_unlinked" : incoming.rowType } });
    }
    const issueType = op.type === "negative_unlinked" ? "SMARTBILL_UNLINKED_ADJUSTMENT" : unresolvedPaidSnapshot ? "SMARTBILL_SOURCE_PAID_UNVERIFIED" : null;
    if (issueType) await tx.financialImportIssue.create({ data: {
      id: `invoice-evidence-issue-${hash(op.id+":"+issueType).slice(0,40)}`,
      uploadId, companyName: company.companyName, companyCode: company.companyCode,
      sheetName: row.sheetName, rowNumber: row.rowNumber, issueType, severity: "warning",
      issueMessage: op.type === "negative_unlinked"
        ? "Document negativ înregistrat pentru verificare. Factura originală nu este demonstrată; documentul este exclus din sold și nu a redus nicio creanță."
        : "Sursa declară factura încasată, dar nu furnizează sumă/data încasării. Nu s-a creat nicio plată; verifică dovada bancară sau compensarea.",
      rawRowJson: { sourceSha256: context.source.sha256, sourceRowNumber: row.rowNumber, receivableId: result.receivableId, invoiceNumber: row.invoiceNumber, currency: row.currency, signedGross: row.totalAmount, reviewStatus: "needs_review", automaticallyApplied: false }
    } });
    await tx.financialReportUpload.update({ where: { id: uploadId }, data: {
      ...(current ? { rowsUpdated: { increment: 1 } } : { rowsCreated: { increment: 1 } }),
      ...(issueType ? { warningCount: { increment: 1 } } : {}),
      summaryJson: { ...sourceEvidence, sourceRowCount: sourceRows.length, cashMutations: false, ownerApprovedEvidenceImport: true }
    } });
    await tx.auditLog.create({ data: { id: auditId, userId: null, action: "financial.invoice_source_reconciled", entityType: "financial_receivable", entityId: result.receivableId, metadata: { ...sourceEvidence, operationId: op.id, operationType: op.type, sourceRowNumber: row.rowNumber, createdClient: createClient, preservedPayments: true, unlinkedNegative: op.type === "negative_unlinked" } } });
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000, maxWait: 10000 });
}
