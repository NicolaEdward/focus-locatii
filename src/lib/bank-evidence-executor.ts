import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { parseBankStatement, type BcrGeorgeStatementPreview, type BcrGeorgeTransactionRow } from "@/lib/bcr-george-import";
import { excludedBankClassification } from "@/lib/financial-reconciliation";
import { recordTransactionalAudit } from "@/lib/transactional-audit";

const hash = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const money = z.string().regex(/^-?\d{1,14}\.\d{2}$/);
const timestamp = z.string().datetime({ offset: true });
const identifier = z.string().min(1).max(191);
const currency = z.string().regex(/^[A-Z]{3}$/);

/** An internal reviewed command, never arbitrary ORM data or an HTTP payload. */
export const bankEvidenceOperationSchema = z.object({
  kind: z.literal("bank.import-statement"),
  operationId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/),
  sourceHash: sha256,
  provider: z.enum(["bcr_george", "revolut"]),
  companyCode: z.enum(["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"]),
  accountKey: z.string().min(1).max(512),
  expectedAccount: z.object({
    id: identifier,
    legalEntityId: identifier,
    ibanNormalized: z.string().min(1).max(512),
    currency,
    updatedAt: timestamp
  }).strict(),
  statement: z.object({
    periodStart: timestamp,
    periodEnd: timestamp,
    openingBalance: money,
    closingBalance: money
  }).strict(),
  rows: z.array(z.object({ rowNumber: z.number().int().positive(), fingerprint: sha256 }).strict()).min(1).max(5000)
}).strict();

export type BankEvidenceOperation = z.infer<typeof bankEvidenceOperationSchema>;
export type VerifiedBankEvidenceSource = Readonly<{ sourceHash: string }>;
const verifiedSources = new WeakMap<VerifiedBankEvidenceSource, BcrGeorgeStatementPreview>();

export class BankEvidenceError extends Error {
  constructor(readonly code: string) { super(code); this.name = "BankEvidenceError"; }
}
function fail(code: string): never { throw new BankEvidenceError(code); }
function assert(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }

/** Reparse the original bytes, not the minimized JSON or a caller-supplied row. */
export function verifyBankEvidenceSource(input: {
  bytes: Buffer; fileName: string; expectedHash: string; companyCode: BankEvidenceOperation["companyCode"];
}): VerifiedBankEvidenceSource {
  sha256.parse(input.expectedHash);
  assert(hash(input.bytes) === input.expectedHash, "BANK_SOURCE_HASH_MISMATCH");
  const parsed = parseBankStatement(input.bytes, input.fileName, input.companyCode);
  assert(parsed.fileHash === input.expectedHash && parsed.companyCode === input.companyCode, "BANK_SOURCE_IDENTITY_MISMATCH");
  const token = Object.freeze({ sourceHash: input.expectedHash });
  verifiedSources.set(token, parsed);
  return token;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function hashBankEvidenceOperation(input: BankEvidenceOperation): string {
  const op = bankEvidenceOperationSchema.parse(input);
  return hash(canonical({ ...op, rows: [...op.rows].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)) }));
}

export const bankEvidenceTransactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 10_000,
  timeout: 120_000
} as const;

const contextSchema = z.object({
  mode: z.enum(["check", "apply"]),
  manifestHash: sha256,
  approvedOperationHash: sha256,
  runId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/),
  source: z.custom<VerifiedBankEvidenceSource>((v) => typeof v === "object" && v !== null && verifiedSources.has(v as VerifiedBankEvidenceSource))
}).strict();
export type BankEvidenceContext = z.infer<typeof contextSchema>;
export type BankEvidenceResult = { created: number; duplicates: number; wouldCreate: number; applied: boolean; statementId: string | null; uploadId: string | null; replay: boolean };

/** Caller owns the transaction and must use bankEvidenceTransactionOptions.
 * No account creation, metadata refresh, invoice linking or cash creation occurs.
 * All effects and their system audit receipt commit or roll back together. */
export async function applyBankEvidenceOperation(
  tx: Prisma.TransactionClient,
  input: BankEvidenceOperation,
  execution: BankEvidenceContext
): Promise<BankEvidenceResult> {
  assert(typeof (tx as unknown as { $transaction?: unknown }).$transaction !== "function", "BANK_TRANSACTION_REQUIRED");
  const op = bankEvidenceOperationSchema.parse(input);
  const context = contextSchema.parse(execution);
  const operationHash = hashBankEvidenceOperation(op);
  assert(operationHash === context.approvedOperationHash, "BANK_OPERATION_NOT_APPROVED");
  const source = verifiedSources.get(context.source)!;
  assert(source.fileHash === op.sourceHash && source.bankProvider === op.provider && source.companyCode === op.companyCode, "BANK_SOURCE_IDENTITY_MISMATCH");
  const accounts = source.accounts.filter(a => a.accountKey === op.accountKey);
  assert(accounts.length === 1, "BANK_SOURCE_ACCOUNT_AMBIGUOUS");
  const accountSource = accounts[0];
  assert(accountSource.storageIdentifier === op.expectedAccount.ibanNormalized && accountSource.currency === op.expectedAccount.currency, "BANK_SOURCE_ACCOUNT_MISMATCH");
  const expectedStatement = op.statement;
  assert(accountSource.periodStart.toISOString() === new Date(expectedStatement.periodStart).toISOString() && accountSource.periodEnd.toISOString() === new Date(expectedStatement.periodEnd).toISOString(), "BANK_SOURCE_PERIOD_MISMATCH");
  assert(accountSource.openingBalance !== null && accountSource.closingBalance !== null, "BANK_SOURCE_BALANCE_MISSING");
  assert(new Prisma.Decimal(accountSource.openingBalance).equals(expectedStatement.openingBalance) && new Prisma.Decimal(accountSource.closingBalance).equals(expectedStatement.closingBalance), "BANK_SOURCE_BALANCE_MISMATCH");
  const sourceRows = source.rows.filter(r => r.accountKey === op.accountKey);
  assert(sourceRows.length === accountSource.rowCount, "BANK_SOURCE_ROW_COUNT_MISMATCH");
  const total = sourceRows.reduce((sum, r) => sum.plus(r.creditAmount).minus(r.debitAmount), new Prisma.Decimal(expectedStatement.openingBalance));
  assert(total.equals(expectedStatement.closingBalance), "BANK_SOURCE_BALANCE_NOT_RECONCILED");
  const selected: BcrGeorgeTransactionRow[] = [];
  const selectedFingerprints = new Set<string>();
  for (const ref of op.rows) {
    assert(!selectedFingerprints.has(ref.fingerprint), "BANK_OPERATION_DUPLICATE_ROW");
    selectedFingerprints.add(ref.fingerprint);
    const matching = sourceRows.filter(r => r.rowNumber === ref.rowNumber && r.fingerprint === ref.fingerprint);
    assert(matching.length === 1, "BANK_SOURCE_ROW_NOT_UNIQUE");
    const row = matching[0];
    const debit = new Prisma.Decimal(row.debitAmount), credit = new Prisma.Decimal(row.creditAmount);
    assert(row.currency === op.expectedAccount.currency && debit.gte(0) && credit.gte(0) && debit.gt(0) !== credit.gt(0), "BANK_SOURCE_ROW_AMOUNT_INVALID");
    assert(row.warnings.length === 0, "BANK_SOURCE_ROW_REQUIRES_REVIEW");
    selected.push(row);
  }

  // The entity/account lock serializes source imports, receipts and secondary
  // reference checks for this account. Read authoritative state only afterward.
  await tx.$queryRaw(Prisma.sql`SELECT id FROM portfolio_financial_legal_entities WHERE id = ${op.expectedAccount.legalEntityId} FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM portfolio_financial_bank_accounts WHERE id = ${op.expectedAccount.id} FOR UPDATE`);
  const account = await tx.financialBankAccount.findUnique({ where: { id: op.expectedAccount.id }, include: { legalEntity: true } });
  assert(account && account.active && account.legalEntity.active && account.legalEntity.code === op.companyCode && account.legalEntityId === op.expectedAccount.legalEntityId && account.ibanNormalized === op.expectedAccount.ibanNormalized && account.currency === op.expectedAccount.currency && account.updatedAt.toISOString() === new Date(op.expectedAccount.updatedAt).toISOString(), "BANK_ACCOUNT_DRIFT");
  const operationKey = `bank-evidence:${hash([op.companyCode, account.id, op.sourceHash, op.accountKey].join("|"))}`;
  const receipt = await tx.auditLog.findFirst({ where: { action: "financial.bank_evidence_import.committed", entityType: "bank_evidence_operation", entityId: operationKey } });
  if (receipt) {
    const metadata = receipt.metadata as Record<string, unknown> | null;
    assert(metadata?.operationHash === operationHash, "BANK_OPERATION_INTENT_CONFLICT");
    const result = metadata?.result as BankEvidenceResult | undefined;
    assert(result && typeof result.created === "number" && typeof result.duplicates === "number", "BANK_OPERATION_RECEIPT_INVALID");
    return { ...result, created: 0, duplicates: selected.length, wouldCreate: 0, applied: context.mode === "apply", replay: true };
  }

  const newRows: BcrGeorgeTransactionRow[] = [];
  let duplicates = 0;
  // Batch reads are essential on a remote database: never issue two RPCs for
  // every source row while holding the account lock.
  const existingFingerprints = await tx.financialBankTransaction.findMany({
    where: { fingerprint: { in: selected.map(row => row.fingerprint) } },
    select: { fingerprint: true, bankAccountId: true, legalEntityId: true, currency: true, bookedAt: true, debitAmount: true, creditAmount: true }
  });
  const existingByFingerprint = new Map(existingFingerprints.map(row => [row.fingerprint, row]));
  const accountRows = await tx.financialBankTransaction.findMany({
    where: { bankAccountId: account.id },
    select: { bankReference: true, documentReference: true, description: true, bookedAt: true, debitAmount: true, creditAmount: true, currency: true },
    take: 20_001
  });
  assert(accountRows.length <= 20_000, "BANK_SECONDARY_CHECK_LIMIT");
  const secondaryRows = accountRows.map(row => ({ ...row, debitAmount: row.debitAmount.toFixed(2), creditAmount: row.creditAmount.toFixed(2) }));
  for (const row of selected.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))) {
    const existing = existingByFingerprint.get(row.fingerprint);
    if (existing) {
      assert(existing.bankAccountId === account.id && existing.legalEntityId === account.legalEntityId && existing.currency === row.currency && existing.bookedAt.getTime() === row.bookedAt.getTime() && existing.debitAmount.equals(row.debitAmount) && existing.creditAmount.equals(row.creditAmount), "BANK_EXISTING_FINGERPRINT_CONFLICT");
      duplicates++;
      continue;
    }
    assert(!secondaryRows.some(prior => secondaryRowsCollide(prior, row)), "BANK_SECONDARY_DUPLICATE_REQUIRES_REVIEW");
    assert(!newRows.some(prior => secondaryRowsCollide(prior, row)), "BANK_SOURCE_SECONDARY_DUPLICATE");
    newRows.push(row);
  }

  const statementFingerprint = hash([op.companyCode, op.provider, op.accountKey, accountSource.periodStart.toISOString().slice(0, 10), accountSource.periodEnd.toISOString().slice(0, 10), op.sourceHash].join("|"));
  const existingStatement = newRows.length
    ? await tx.financialBankStatement.findUnique({ where: { statementFingerprint }, include: { upload: true } }) : null;
  if (existingStatement) {
      assert(existingStatement.bankAccountId === account.id && existingStatement.legalEntityId === account.legalEntityId && existingStatement.currency === account.currency && existingStatement.periodStart.getTime() === accountSource.periodStart.getTime() && existingStatement.periodEnd.getTime() === accountSource.periodEnd.getTime() && existingStatement.openingBalance?.equals(expectedStatement.openingBalance) && existingStatement.closingBalance?.equals(expectedStatement.closingBalance) && existingStatement.upload.fileHash === op.sourceHash && existingStatement.status === "imported", "BANK_STATEMENT_DRIFT");
  }
  if (context.mode === "check") return {
    created: 0, duplicates, wouldCreate: newRows.length, applied: false,
    statementId: existingStatement?.id || null, uploadId: existingStatement?.uploadId || null, replay: false
  };

  let statementId: string | null = null, uploadId: string | null = null;
  if (newRows.length) {
    const alreadyPresent = await tx.financialBankTransaction.count({ where: { fingerprint: { in: sourceRows.map(row => row.fingerprint) } } });
    if (existingStatement) {
      statementId = existingStatement.id; uploadId = existingStatement.uploadId;
    } else {
      const upload = await tx.financialReportUpload.create({ data: {
        id: `bankevidence_u_${statementFingerprint}`, uploadedByUserId: null,
        reportDate: accountSource.periodEnd, originalFileName: `${op.provider}-${op.sourceHash.slice(0, 16)}.csv`, fileHash: op.sourceHash,
        status: "completed", activeVersion: false, legalEntityId: account.legalEntityId,
        importType: "bank_evidence_reviewed", parserName: "ReviewedBankEvidenceExecutor", parserVersion: "1",
        fileSize: source.fileSize, rowsRead: selected.length, rowsCreated: newRows.length, rowsDuplicate: duplicates,
        summaryJson: {
          manifestHash: context.manifestHash, operationHash, sourceHash: op.sourceHash, provider: op.provider,
          sourceRows: sourceRows.length, selectedRows: selected.length, importedRows: newRows.length, alreadyPresent,
          unselectedSourceRows: sourceRows.length - selected.length, statementBalanceScope: "full-source-account-window"
        }
      } });
      uploadId = upload.id;
      const statement = await tx.financialBankStatement.create({ data: {
        id: `bankevidence_s_${statementFingerprint}`, uploadId, legalEntityId: account.legalEntityId, bankAccountId: account.id,
        statementFingerprint, periodStart: accountSource.periodStart, periodEnd: accountSource.periodEnd, issuedAt: source.issuedAt,
        currency: account.currency, openingBalance: new Prisma.Decimal(expectedStatement.openingBalance), closingBalance: new Prisma.Decimal(expectedStatement.closingBalance), status: "imported"
      } });
      statementId = statement.id;
    }
    const inserted = await tx.financialBankTransaction.createMany({ data: newRows.map(row => ({
      statementId: statementId!, legalEntityId: account.legalEntityId, bankAccountId: account.id,
      fingerprint: row.fingerprint, bookedAt: row.bookedAt, valueDate: row.valueDate, currency: row.currency,
      debitAmount: new Prisma.Decimal(row.debitAmount), creditAmount: new Prisma.Decimal(row.creditAmount), description: row.description,
      documentReference: row.documentReference, bankReference: row.bankReference, payerName: row.payerName, payerIban: row.payerIban, payerTaxId: row.payerTaxId,
      beneficiaryName: row.beneficiaryName, beneficiaryIban: row.beneficiaryIban, beneficiaryTaxId: row.beneficiaryTaxId,
      paymentDetails: row.paymentDetails, merchantName: row.merchantName, maskedCard: row.maskedCard, transactionType: row.transactionType,
      classification: row.classification, reconciliationStatus: excludedBankClassification(row.classification) ? "ignored" : "unmatched",
      rawRowJson: { ...row.raw, bankEvidence: { sourceHash: op.sourceHash, manifestHash: context.manifestHash, operationHash, rowNumber: row.rowNumber } }
    })) });
    assert(inserted.count === newRows.length, "BANK_INSERT_COUNT_MISMATCH");
  }
  const result: BankEvidenceResult = { created: newRows.length, duplicates, wouldCreate: newRows.length, applied: true, statementId, uploadId, replay: false };
  await recordTransactionalAudit(tx, {
    actor: null, action: "financial.bank_evidence_import.committed", entityType: "bank_evidence_operation", entityId: operationKey,
    correlationId: context.runId,
    metadata: { actorKind: "SYSTEM", systemName: "bank-evidence-reconciliation", operationId: op.operationId, manifestHash: context.manifestHash, operationHash, sourceHash: op.sourceHash, result }
  });
  return result;
}

function normalized(value: string | null) { return (value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase(); }
type SecondaryBankRow = Pick<BcrGeorgeTransactionRow, "bankReference" | "documentReference" | "description" | "bookedAt" | "debitAmount" | "creditAmount" | "currency">;
function secondaryRowsCollide(a: SecondaryBankRow, b: SecondaryBankRow) {
  // Distinct provider transaction IDs distinguish legitimate equal-value rows
  // with date-only timestamps and generic descriptions (notably Revolut).
  if (a.bankReference && b.bankReference) return normalized(a.bankReference) === normalized(b.bankReference);
  if (a.currency !== b.currency || a.bookedAt.getTime() !== b.bookedAt.getTime() || a.debitAmount !== b.debitAmount || a.creditAmount !== b.creditAmount) return false;
  return Boolean(a.documentReference && b.documentReference && normalized(a.documentReference) === normalized(b.documentReference)) || normalized(a.description) === normalized(b.description);
}
