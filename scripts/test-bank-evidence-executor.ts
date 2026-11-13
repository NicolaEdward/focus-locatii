import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { parseBankStatement } from "../src/lib/bcr-george-import";
import {
  applyBankEvidenceOperation, bankEvidenceTransactionOptions, hashBankEvidenceOperation,
  verifyBankEvidenceSource, type BankEvidenceOperation
} from "../src/lib/bank-evidence-executor";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";

const digest = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex");
function fixture(options: { suffix?: string; balanceOffset?: number; newline?: boolean } = {}) {
  const suffix = options.suffix || "A";
  const offset = options.balanceOffset || 0;
  const headers = ["Data emitere extras", "Ora emitere extras", "Data inceput", "Data finala", "Valuta", "Contul pentru care s a generat extrasul", "Titular cont", "Sold contabil initial", "Data finalizarii tranzactiei", "Ora finalizare tranzactie", "Tranzactii finalizate detalii", "Referinta oper document", "Debit suma", "Credit suma", "Sold contabil final"];
  const base = ["03.11.2026", "12:00", "01.11.2026", "02.11.2026", "RON", "RO00SYNTHETIC000000000001", "FOCUS MEDIA OUTDOOR SRL"];
  return Buffer.from([
    headers.join(";"),
    [...base, (1000 + offset).toFixed(2), "01.11.2026", "12:00", `Synthetic receipt ${suffix}`, `SYN-${suffix}-1`, "0.00", "100.00", (1100 + offset).toFixed(2)].join(";"),
    [...base, (1100 + offset).toFixed(2), "02.11.2026", "12:00", `Synthetic payment ${suffix}`, `SYN-${suffix}-2`, "25.00", "0.00", (1075 + offset).toFixed(2)].join(";")
  ].join("\n") + (options.newline ? "\n" : ""));
}

async function main() {
  loadEnvFile(); assertSyntheticEnvironment();
  const url = new URL(process.env.DATABASE_URL || "");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.equal(url.pathname, "/focus_preview_bank_evidence");
  assert.notEqual(process.env.VERCEL_ENV, "production");
  const client = new PrismaClient({ log: [] });
  const prefix = `bank-evidence-test-${crypto.randomUUID()}`;
  const entityId = `${prefix}-entity`, accountId = `${prefix}-account`;
  const completed: string[] = [];
  try {
    assert.equal(await client.financialBankTransaction.count(), 0, "Use a fresh dedicated synthetic database.");
    const source = fixture();
    const parsed = parseBankStatement(source, "synthetic-bank.csv", "FOCUS_MEDIA");
    assert.equal(parsed.rows.length, 2);
    const sourceAccount = parsed.accounts[0];
    await client.financialLegalEntity.create({ data: { id: entityId, code: "FOCUS_MEDIA", legalName: "Synthetic bank evidence entity", normalizedName: prefix } });
    const account = await client.financialBankAccount.create({ data: {
      id: accountId, legalEntityId: entityId, ibanOriginal: sourceAccount.storageIdentifier,
      ibanNormalized: sourceAccount.storageIdentifier, currency: sourceAccount.currency
    } });
    function operation(bytes: Buffer, operationId = "synthetic-import"): BankEvidenceOperation {
      const p = parseBankStatement(bytes, "synthetic-bank.csv", "FOCUS_MEDIA"), a = p.accounts[0];
      return {
        kind: "bank.import-statement", operationId, sourceHash: digest(bytes), provider: p.bankProvider,
        companyCode: "FOCUS_MEDIA", accountKey: a.accountKey,
        expectedAccount: { id: account.id, legalEntityId: entityId, ibanNormalized: account.ibanNormalized, currency: account.currency, updatedAt: account.updatedAt.toISOString() },
        statement: { periodStart: a.periodStart.toISOString(), periodEnd: a.periodEnd.toISOString(), openingBalance: a.openingBalance!, closingBalance: a.closingBalance! },
        rows: p.rows.map(row => ({ rowNumber: row.rowNumber, fingerprint: row.fingerprint }))
      };
    }
    function context(bytes: Buffer, op: BankEvidenceOperation) {
      return { mode: "apply" as const, manifestHash: digest("synthetic-reviewed-manifest"), approvedOperationHash: hashBankEvidenceOperation(op), runId: "synthetic-bank-evidence",
        source: verifyBankEvidenceSource({ bytes, fileName: "synthetic-bank.csv", expectedHash: op.sourceHash, companyCode: op.companyCode }) };
    }
    const op = operation(source), ctx = context(source, op);
    const apply = (operation: BankEvidenceOperation, execution = ctx) => client.$transaction(tx => applyBankEvidenceOperation(tx, operation, execution), bankEvidenceTransactionOptions);
    async function counts() {
      return Promise.all([client.financialBankTransaction.count(), client.financialBankStatement.count(), client.financialReportUpload.count(), client.auditLog.count(), client.financialReceivablePayment.count(), client.financialPayablePayment.count()]);
    }
    const zero = await counts();
    assert.deepEqual(zero, [0, 0, 0, 0, 0, 0]);
    assert.throws(() => verifyBankEvidenceSource({ bytes: Buffer.concat([source, Buffer.from("x")]), fileName: "synthetic-bank.csv", expectedHash: op.sourceHash, companyCode: op.companyCode }), /BANK_SOURCE_HASH_MISMATCH/);
    await assert.rejects(apply({ ...op, statement: { ...op.statement, closingBalance: "999.00" } }), /BANK_OPERATION_NOT_APPROVED/);
    await assert.rejects(apply({ ...op, arbitraryOrmData: { active: true } } as any));
    await assert.rejects(apply(op, { ...ctx, source: { sourceHash: op.sourceHash } }));
    await assert.rejects(applyBankEvidenceOperation(client as any, op, ctx), /BANK_TRANSACTION_REQUIRED/);
    assert.deepEqual(await counts(), zero);
    completed.push("source hash, reviewed hash, strict allowlist, verified-source token and transaction guards produce zero effects");

    const checked = await client.$transaction(tx => applyBankEvidenceOperation(tx, op, { ...ctx, mode: "check" }), bankEvidenceTransactionOptions);
    assert.equal(checked.applied, false); assert.equal(checked.created, 0); assert.equal(checked.wouldCreate, 2);
    assert.deepEqual(await counts(), zero);
    completed.push("check mode validates source and live state while creating no rows, uploads, statements, audit or payments");

    await assert.rejects(client.$transaction(async tx => {
      const result = await applyBankEvidenceOperation(tx, op, ctx); assert.equal(result.created, 2);
      throw new Error("synthetic-rollback");
    }, bankEvidenceTransactionOptions), /synthetic-rollback/);
    assert.deepEqual(await counts(), zero);
    completed.push("caller failure rolls back bank rows, dedicated statement/upload and transactional system audit");

    const concurrent = await Promise.all([apply(op), apply(op)]);
    assert.equal(concurrent.reduce((sum, result) => sum + result.created, 0), 2);
    assert.equal(concurrent.filter(result => result.replay).length, 1);
    assert.deepEqual(await counts(), [2, 1, 1, 1, 0, 0]);
    const receipt = await client.auditLog.findFirstOrThrow();
    assert.equal(receipt.userId, null);
    assert.equal((receipt.metadata as any).actorKind, "SYSTEM");
    assert.equal((receipt.metadata as any).operationHash, hashBankEvidenceOperation(op));
    completed.push("concurrent execution has exactly one import and one durable SYSTEM receipt without creating cash");

    const rows = await client.financialBankTransaction.findMany({ orderBy: { fingerprint: "asc" } });
    await client.financialBankTransaction.update({ where: { id: rows[0].id }, data: { classification: "internal_transfer", reconciliationStatus: "ignored" } });
    const beforeReplay = await client.financialBankTransaction.findMany({ orderBy: { id: "asc" } });
    assert.equal((await apply(op)).created, 0);
    assert.deepEqual(await client.financialBankTransaction.findMany({ orderBy: { id: "asc" } }), beforeReplay);
    const modified = { ...op, rows: op.rows.slice(0, 1) };
    await assert.rejects(apply(modified, context(source, modified)), /BANK_OPERATION_INTENT_CONFLICT/);
    completed.push("replay preserves existing classifications and every row field; changed intent is rejected");

    const reexport = fixture({ newline: true }), reexportOp = operation(reexport, "synthetic-reexport");
    const reexportResult = await apply(reexportOp, context(reexport, reexportOp));
    assert.equal(reexportResult.created, 0); assert.equal(reexportResult.duplicates, 2);
    assert.equal(await client.financialBankStatement.count(), 1); assert.equal(await client.financialReportUpload.count(), 1);
    assert.deepEqual(await client.financialBankTransaction.findMany({ orderBy: { id: "asc" } }), beforeReplay);
    completed.push("new file hash with identical transaction fingerprints creates no duplicate rows or empty statement/upload");

    const changedBalance = fixture({ balanceOffset: 5 }), changedOp = operation(changedBalance, "synthetic-secondary-reference");
    const beforeSecondary = await counts();
    await assert.rejects(apply(changedOp, context(changedBalance, changedOp)), /BANK_SECONDARY_DUPLICATE_REQUIRES_REVIEW/);
    assert.deepEqual(await counts(), beforeSecondary);
    completed.push("BCR reexport with changed balance/fingerprints but same reference/date/amount is rejected atomically");

    const revolut = Buffer.from([
      "Date completed (UTC),ID,Type,State,Description,Reference,Payer,Card number,Payment currency,Amount,Total amount,Fee,Fee currency,Balance,Account,International account number,Beneficiary account number,Beneficiary IBAN,Beneficiary name,Sender account,Sender name",
      "2026-11-01 00:00:00,SYN-REV-1,TRANSFER,COMPLETED,Synthetic generic receipt,Generic commercial reference,,,RON,100.00,100.00,0.00,RON,1200.00,Synthetic RON account,RO00SYNTHETIC000000000002,,,,,",
      "2026-11-01 00:00:00,SYN-REV-2,TRANSFER,COMPLETED,Synthetic generic receipt,Generic commercial reference,,,RON,100.00,100.00,0.00,RON,1100.00,Synthetic RON account,RO00SYNTHETIC000000000002,,,,,"
    ].join("\n"));
    const revolutParsed = parseBankStatement(revolut, "synthetic-revolut.csv", "FOCUS_MEDIA"), revolutAccount = revolutParsed.accounts[0];
    assert.equal(revolutParsed.rows.length, 2);
    const registeredRevolut = await client.financialBankAccount.create({ data: {
      legalEntityId: entityId, ibanOriginal: revolutAccount.storageIdentifier,
      ibanNormalized: revolutAccount.storageIdentifier, currency: revolutAccount.currency
    } });
    const revolutOp: BankEvidenceOperation = {
      kind: "bank.import-statement", operationId: "synthetic-revolut-distinct-ids", sourceHash: digest(revolut), provider: "revolut",
      companyCode: "FOCUS_MEDIA", accountKey: revolutAccount.accountKey,
      expectedAccount: { id: registeredRevolut.id, legalEntityId: entityId, ibanNormalized: registeredRevolut.ibanNormalized, currency: registeredRevolut.currency, updatedAt: registeredRevolut.updatedAt.toISOString() },
      statement: { periodStart: revolutAccount.periodStart.toISOString(), periodEnd: revolutAccount.periodEnd.toISOString(), openingBalance: revolutAccount.openingBalance!, closingBalance: revolutAccount.closingBalance! },
      rows: revolutParsed.rows.map(row => ({ rowNumber: row.rowNumber, fingerprint: row.fingerprint }))
    };
    const revolutResult = await apply(revolutOp, context(revolut, revolutOp));
    assert.equal(revolutResult.created, 2, "Different stable provider IDs distinguish legitimate same-date/value/reference/description transactions.");
    const beforeRevolutRetry = await counts();
    const changedRevolut = Buffer.from(revolut.toString().replace("100.00,100.00,0.00,RON,1200.00", "105.00,105.00,0.00,RON,1205.00"));
    const changedRevolutParsed = parseBankStatement(changedRevolut, "synthetic-revolut.csv", "FOCUS_MEDIA");
    const changedRevolutOp = { ...revolutOp, sourceHash: digest(changedRevolut), statement: { ...revolutOp.statement, closingBalance: "1205.00" }, rows: changedRevolutParsed.rows.map(row => ({ rowNumber: row.rowNumber, fingerprint: row.fingerprint })) };
    await assert.rejects(apply(changedRevolutOp, context(changedRevolut, changedRevolutOp)), /BANK_SECONDARY_DUPLICATE_REQUIRES_REVIEW/);
    assert.deepEqual(await counts(), beforeRevolutRetry);
    completed.push("different stable Revolut IDs permit legitimate equal-value rows; reused ID with changed amount is rejected");

    const newSource = fixture({ suffix: "B" }), newOp = operation(newSource, "synthetic-drift");
    await client.financialBankAccount.update({ where: { id: accountId }, data: { active: false } });
    const beforeDrift = await counts();
    await assert.rejects(apply(newOp, context(newSource, newOp)), /BANK_ACCOUNT_DRIFT/);
    assert.deepEqual(await counts(), beforeDrift);
    completed.push("account version/status drift rejects the reviewed import without partial writes");

    console.log(JSON.stringify({ ok: true, syntheticOnly: true, checks: completed }, null, 2));
  } finally {
    await client.financialBankTransaction.deleteMany({ where: { legalEntityId: entityId } });
    await client.financialBankStatement.deleteMany({ where: { legalEntityId: entityId } });
    await client.financialReportUpload.deleteMany({ where: { legalEntityId: entityId } });
    await client.auditLog.deleteMany({ where: { action: "financial.bank_evidence_import.committed", metadata: { path: "$.systemName", equals: "bank-evidence-reconciliation" } } });
    await client.financialBankAccount.deleteMany({ where: { legalEntityId: entityId } });
    await client.financialLegalEntity.deleteMany({ where: { id: entityId } });
    await client.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
