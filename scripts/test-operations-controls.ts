import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { databaseFingerprint, verifyBackupReceipt, verifyRestoreReceipt } from "../src/lib/backup-receipts";
import { confirmRetentionCleanup, getOperationsControls, previewRetentionCleanup, registerBackupEvidence, registerRestoreEvidence, updateOperationsPolicy } from "../src/lib/operations-controls";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
import type { AuthSession } from "../src/lib/auth";
const { signReceipt } = require("./release/database-backup.cjs");

async function main() {
  loadEnvFile(); assertSyntheticEnvironment();
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname), "Local synthetic DB only");
  process.env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  const tag = "control-test-" + crypto.randomUUID();
  const user = await prisma.user.create({ data: { email: tag + "@synthetic.test", name: "Synthetic Control Operator", role: "SUPER_ADMIN", passwordHash: "not-a-login" } });
  const actor: AuthSession = { id: user.id, email: user.email, name: user.name, role: user.role, tokenVersion: user.tokenVersion, iat: 1, exp: 9999999999 };
  const sessionOld = tag + "-old", sessionActive = tag + "-active", tokenId = tag + "-token", rateId = tag + "-rate";
  const old = new Date(Date.now() - 500 * 86400000);
  try {
    const initial = await getOperationsControls();
    await updateOperationsPolicy({ expectedVersion: initial.policy.version, policy: { rpoHours: 24, rtoMinutes: 240, restoreDrillDays: 30, sessionRetentionDays: 90, tokenRetentionDays: 30, rateLimitRetentionDays: 7, businessRetentionNote: "Synthetic policy; never delete business records." } }, actor);
    await assert.rejects(updateOperationsPolicy({ expectedVersion: initial.policy.version, policy: { rpoHours: 24, rtoMinutes: 240, restoreDrillDays: 30, sessionRetentionDays: 90, tokenRetentionDays: 30, rateLimitRetentionDays: 7, businessRetentionNote: "Synthetic stale update must not win." } }, actor), /modificata/);
    const sourceFingerprint = databaseFingerprint()!, encryptedSha256 = crypto.randomBytes(32).toString("hex"), tables = { synthetic_table: { count: 4, hash: "a".repeat(64) } };
    const backup = signReceipt({ version: 1, action: "backup", ok: true, createdAt: new Date().toISOString(), sourceFingerprint, encryptedSha256, tables });
    const restore = signReceipt({ version: 1, action: "restore_verification", ok: true, verifiedAt: new Date().toISOString(), sourceFingerprint, targetFingerprint: "123456789abc", encryptedSha256, durationMs: 1000, tables });
    assert.equal(verifyBackupReceipt(backup).tableCount, 1); assert.equal(verifyRestoreReceipt(restore).tableCount, 1);
    assert.throws(() => verifyBackupReceipt({ ...backup, sourceFingerprint: "000000000000" }), /Semnatura/);
    await registerBackupEvidence(backup, actor); await registerRestoreEvidence(restore, actor);
    assert.equal((await getOperationsControls()).backup.status, "verified");
    const oldEnv = process.env.VERCEL_ENV; process.env.VERCEL_ENV = "production";
    assert.equal((await getOperationsControls()).backup.status, "unverified", "Test receipts must not attest production"); process.env.VERCEL_ENV = oldEnv;
    await prisma.authSessionRecord.createMany({ data: [{ id: sessionOld, userId: actor.id, expiresAt: old }, { id: sessionActive, userId: actor.id, expiresAt: new Date(Date.now() + 86400000) }] });
    await prisma.authActionToken.create({ data: { id: tokenId, tokenHash: tag, type: "synthetic", expiresAt: old, userId: actor.id } });
    await prisma.securityRateLimit.create({ data: { keyHash: rateId, scope: "synthetic", windowStartedAt: old, expiresAt: old } });
    await assert.rejects(previewRetentionCleanup({ ...actor, role: "COO" }), /SUPER_ADMIN/);
    const preview = await previewRetentionCleanup(actor); assert.ok(preview.counts.sessions >= 1);
    await assert.rejects(confirmRetentionCleanup(preview.previewToken + "invalid", actor), /Preview/);
    await confirmRetentionCleanup(preview.previewToken, actor);
    assert.equal(await prisma.authSessionRecord.count({ where: { id: sessionOld } }), 0);
    assert.equal(await prisma.authSessionRecord.count({ where: { id: sessionActive } }), 1);
    assert.equal(await prisma.authActionToken.count({ where: { id: tokenId } }), 0);
    assert.equal((await confirmRetentionCleanup(preview.previewToken, actor)).replayed, true);
    await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
    const fresh = await previewRetentionCleanup(actor);
    await assert.rejects(confirmRetentionCleanup(fresh.previewToken, actor), /Drepturile/);
    console.log("Operations control policy, signed evidence, environment separation, retention safety and replay checks passed");
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: user.id } });
    await prisma.securityRateLimit.deleteMany({ where: { keyHash: rateId } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
