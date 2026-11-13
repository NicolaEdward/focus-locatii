import fs from "node:fs";
import { z } from "zod";
import { prisma } from "../../src/lib/prisma";
import { databaseIdentity } from "./env-utils";
import { decryptEvidenceJob, MAX_JOB_BYTES } from "./evidence-job-envelope";
import {
  applyBankEvidenceOperation, bankEvidenceOperationSchema, bankEvidenceTransactionOptions,
  hashBankEvidenceOperation, verifyBankEvidenceSource,
} from "../../src/lib/bank-evidence-executor";

// A bank-only job does not load or activate invoice mutation code.
async function invoiceExecutor() {
  const modulePath = "../../src/lib/invoice-evidence-executor";
  return import(modulePath);
}

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const jobSchema = z.object({
  schemaVersion: z.literal(1), databaseFingerprint: z.string().regex(/^[a-f0-9]{12}$/),
  sourceSnapshotHash: sha, runId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
  ownerAuthorization: z.literal("owner-uploaded-documents-2026-11-13"),
  createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
  sources: z.array(z.object({ sha256: sha, fileName: z.string().min(1).max(255), companyCode: z.enum(["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"]), bytesBase64: z.string().max(12 * 1024 * 1024) }).strict()).min(1).max(8),
  operations: z.array(z.object({ approvedOperationHash: sha, operation: z.record(z.string(), z.unknown()) }).strict()).min(1).max(1500),
}).strict();

function guard() {
  if (process.env.RUN_EVIDENCE_RECONCILIATION !== "true") throw Error("EVIDENCE_JOB_NOT_ENABLED");
  const identity = databaseIdentity();
  if (process.env.RECONCILIATION_DATABASE_FINGERPRINT !== identity.fingerprint) throw Error("EVIDENCE_JOB_TARGET_NOT_APPROVED");
  if (process.env.VERCEL_ENV === "production" && (process.env.VERCEL_PROJECT_ID !== "prj_c6GY3nlQvaw7h9vdZss8WTugWQ4v" || process.env.VERCEL_ORG_ID !== "team_JXPumA8SQGBIWidvRoITA2dI")) throw Error("EVIDENCE_JOB_PROJECT_MISMATCH");
  const mode = process.env.APPLY_EVIDENCE_RECONCILIATION === "true" ? "apply" : "check";
  const file = ".reconciliation-job/payload.enc.json";
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JOB_BYTES * 1.5) throw Error("EVIDENCE_JOB_INPUT_INVALID");
  const job = jobSchema.parse(decryptEvidenceJob(JSON.parse(fs.readFileSync(file, "utf8")), process.env.RECONCILIATION_JOB_KEY, process.env.RECONCILIATION_PLAN_SHA256));
  const now = Date.now(), createdAt = Date.parse(job.createdAt), expiresAt = Date.parse(job.expiresAt);
  if (job.databaseFingerprint !== identity.fingerprint || createdAt > now + 60_000 || expiresAt <= now || expiresAt <= createdAt || expiresAt - createdAt > 24 * 3600_000) throw Error("EVIDENCE_JOB_EXPIRED_OR_WRONG_TARGET");
  if (new Set(job.sources.map(s => s.sha256)).size !== job.sources.length || new Set(job.operations.map(o => o.approvedOperationHash)).size !== job.operations.length) throw Error("EVIDENCE_JOB_DUPLICATE_INTENT");
  return { job, mode, manifestHash: process.env.RECONCILIATION_PLAN_SHA256! } as const;
}

async function main() {
  // Target, integrity and expiry are checked before opening any DB connection.
  const { job, mode, manifestHash } = guard();
  const bankSources = new Map<string, ReturnType<typeof verifyBankEvidenceSource>>();
  const invoiceSources = new Map<string, unknown>();
  const invoice = job.sources.some(source => /\.xlsx?$/i.test(source.fileName)) ? await invoiceExecutor() : null;
  for (const source of job.sources) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(source.bytesBase64) || /[\\/]/.test(source.fileName)) throw Error("EVIDENCE_JOB_SOURCE_INVALID");
    const bytes = Buffer.from(source.bytesBase64, "base64");
    const input = { bytes, fileName: source.fileName, expectedHash: source.sha256, companyCode: source.companyCode };
    if (/\.csv$/i.test(source.fileName)) bankSources.set(source.sha256, verifyBankEvidenceSource(input));
    else if (/\.xlsx?$/i.test(source.fileName) && invoice) invoiceSources.set(source.sha256, await invoice.verifyInvoiceEvidenceSource(input));
    else throw Error("EVIDENCE_JOB_SOURCE_UNSUPPORTED");
  }
  // All operation hashes and source bindings are checked before the first write.
  for (const item of job.operations) {
    const op = item.operation;
    const bank = op.kind === "bank.import-statement";
    const calculated = bank ? hashBankEvidenceOperation(bankEvidenceOperationSchema.parse(op)) : invoice?.hashInvoiceEvidenceOperation(op);
    if (calculated !== item.approvedOperationHash) throw Error("EVIDENCE_JOB_OPERATION_NOT_APPROVED");
    if (!(bank ? bankSources.has(String(op.sourceHash)) : invoiceSources.has(String(op.sourceSha256)))) throw Error("EVIDENCE_JOB_SOURCE_NOT_APPROVED");
  }
  const client = prisma;
  let completed = 0;
  try {
    console.log(JSON.stringify({ event: "evidence_reconciliation", phase: "begin", mode, manifestHash, runId: job.runId, operations: job.operations.length, databaseFingerprint: job.databaseFingerprint }));
    for (const item of job.operations) {
      const op = item.operation;
      let result: unknown;
      if (op.kind === "bank.import-statement") {
        result = await client.$transaction(tx => applyBankEvidenceOperation(tx, bankEvidenceOperationSchema.parse(op), {
          mode, manifestHash, approvedOperationHash: item.approvedOperationHash, runId: job.runId, source: bankSources.get(String(op.sourceHash))!,
        }), bankEvidenceTransactionOptions);
      } else {
        result = await invoice!.executeInvoiceEvidenceOperation(op, {
          mode, manifestHash, approvedOperationHash: item.approvedOperationHash, runId: job.runId, source: invoiceSources.get(String(op.sourceSha256))!,
        });
      }
      completed++;
      // Only counters/booleans are emitted; no customer/invoice/bank IDs or names.
      const counts = Object.fromEntries(Object.entries(result && typeof result === "object" ? result : {}).filter(([key, value]) => /^[A-Za-z]{1,40}$/.test(key) && (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))));
      console.log(JSON.stringify({ event: "evidence_reconciliation", phase: "operation", mode, operationHash: item.approvedOperationHash, completed, ...counts }));
    }
    console.log(JSON.stringify({ event: "evidence_reconciliation", phase: "complete", ok: true, mode, manifestHash, operationsCompleted: completed, bankRows: await client.financialBankTransaction.count(), receivables: await client.financialReceivable.count() }));
  } finally { await client.$disconnect(); }
}

main().catch(error => {
  const code = typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{1,100}$/.test(error.code) ? error.code : typeof error?.message === "string" && /^[A-Z][A-Z0-9_]{1,100}$/.test(error.message) ? error.message : "EVIDENCE_JOB_FAILED";
  console.error(JSON.stringify({ event: "evidence_reconciliation", ok: false, code, outcome: "verify_receipts_before_retry" }));
  process.exitCode = 1;
});
