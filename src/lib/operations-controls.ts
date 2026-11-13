import crypto from "node:crypto";
import { z } from "zod";
import type { AuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authSecret } from "@/lib/security-secrets";
import { recordTransactionalAudit } from "@/lib/transactional-audit";
import { databaseFingerprint, verifyBackupReceipt, verifyRestoreReceipt } from "@/lib/backup-receipts";

const policySchema = z.object({
  rpoHours: z.number().int().min(1).max(720),
  rtoMinutes: z.number().int().min(1).max(10080),
  restoreDrillDays: z.number().int().min(1).max(365),
  sessionRetentionDays: z.number().int().min(30).max(3650),
  tokenRetentionDays: z.number().int().min(7).max(365),
  rateLimitRetentionDays: z.number().int().min(1).max(90),
  businessRetentionNote: z.string().trim().min(10).max(2000)
}).strict();
export type OperationsPolicy = z.infer<typeof policySchema> & { version: number; configured: boolean };
const defaults: OperationsPolicy = { version: 0, configured: false, rpoHours: 24, rtoMinutes: 240, restoreDrillDays: 30, sessionRetentionDays: 90, tokenRetentionDays: 30, rateLimitRetentionDays: 7, businessRetentionNote: "Datele comerciale si fiscale sunt pastrate pana la aprobarea unei politici legale specifice; fara stergere automata." };
type AuditTx = Parameters<typeof recordTransactionalAudit>[0];
function manager(actor: AuthSession) { if (!["COO", "SUPER_ADMIN"].includes(actor.role)) throw new Error("Aceasta actiune necesita COO sau SUPER_ADMIN."); }

async function latestPolicy(client: typeof prisma | AuditTx = prisma): Promise<OperationsPolicy> {
  const row = await client.auditLog.findFirst({ where: { action: "control.policy.updated" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { metadata: true } });
  if (!row?.metadata || typeof row.metadata !== "object" || Array.isArray(row.metadata)) return defaults;
  const m = row.metadata as Record<string, unknown>, parsed = policySchema.safeParse(m.policy);
  return parsed.success && Number.isSafeInteger(m.version) ? { ...parsed.data, version: Number(m.version), configured: true } : defaults;
}

export async function getOperationsControls() {
  const [policy, backup, restore, latestEvents, auditCount, transactionAuditCount, intents] = await Promise.all([
    latestPolicy(),
    prisma.auditLog.findFirst({ where: { action: "control.backup.created" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, metadata: true } }),
    prisma.auditLog.findFirst({ where: { action: "control.restore.verified" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, metadata: true } }),
    prisma.auditLog.findMany({ where: { action: { startsWith: "control." } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, action: true, entityType: true, createdAt: true } }),
    prisma.auditLog.count({ where: { createdAt: { gte: new Date(Date.now() - 86400000) } } }),
    prisma.auditLog.count({ where: { createdAt: { gte: new Date(Date.now() - 86400000) }, metadata: { path: "$.durability", equals: "business-transaction" } } }),
    prisma.auditLog.count({ where: { createdAt: { gte: new Date(Date.now() - 86400000) }, action: "mutation.request.accepted" } })
  ]);
  const receipt = restore?.metadata && typeof restore.metadata === "object" && !Array.isArray(restore.metadata) ? restore.metadata as Record<string, unknown> : null;
  const verifiedAt = typeof receipt?.verifiedAt === "string" ? receipt.verifiedAt : null;
  const ageDays = verifiedAt ? (Date.now() - Date.parse(verifiedAt)) / 86400000 : null;
  const backupReceipt = backup?.metadata && typeof backup.metadata === "object" && !Array.isArray(backup.metadata) ? backup.metadata as Record<string, unknown> : null;
  const backupCreatedAt = typeof backupReceipt?.createdAt === "string" ? backupReceipt.createdAt : null;
  const backupAgeHours = backupCreatedAt ? (Date.now() - Date.parse(backupCreatedAt)) / 3600000 : null;
  const environment = process.env.VERCEL_ENV === "production" ? "production" : "test";
  const environmentMatches = receipt?.environment === environment && backupReceipt?.environment === environment;
  const fingerprint = databaseFingerprint();
  const sourceMatches = Boolean(fingerprint && receipt?.sourceFingerprint === fingerprint && backupReceipt?.sourceFingerprint === fingerprint);
  const validTimes = backupAgeHours != null && Number.isFinite(backupAgeHours) && backupAgeHours >= -5 / 60 && ageDays != null && Number.isFinite(ageDays) && ageDays >= -5 / 1440 && typeof receipt?.durationMs === "number" && Number.isFinite(receipt.durationMs) && receipt.durationMs >= 0;
  const status = !receipt || !backupReceipt || !environmentMatches || !sourceMatches || !validTimes ? "unverified" : backupAgeHours > policy.rpoHours ? "stale_backup" : ageDays > policy.restoreDrillDays ? "expired_drill" : Number(receipt.durationMs) > policy.rtoMinutes * 60000 ? "rto_exceeded" : "verified";
  return {
    policy, environment,
    backup: { keyConfigured: Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || "", "base64").length === 32, sourceFingerprint: fingerprint,
      status, backupCreatedAt, backupAgeHours,
      verifiedAt, durationMs: receipt?.durationMs ?? null, tableCount: receipt?.tableCount ?? null,
      environment: receipt?.environment ?? null, encryptedSha256: receipt?.encryptedSha256 ?? null,
      explanation: "Restaurarea semnata demonstreaza testul de recuperare indicat. Nu demonstreaza singura backupuri zilnice, destinatie off-site sau un SLA al furnizorului." },
    audit: { last24hEvents: auditCount, transactionEvents: transactionAuditCount, acceptedMutationRequests: intents,
      explanation: "Intentiile sunt inregistrate inainte de mutatie. Comenzile critice scriu si evenimentul in tranzactia de business; intentia singura nu dovedeste succesul." },
    monitoring: { externalDrainConfigured: process.env.EXTERNAL_MONITORING_CONFIGURED === "true", explanation: "Configurarea externa se verifica separat; logurile locale nu reprezinta o alarma livrata." },
    recentEvents: latestEvents.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
  };
}

export async function registerBackupEvidence(input: unknown, actor: AuthSession) {
  manager(actor); const receipt = verifyBackupReceipt(input);
  const environment = process.env.VERCEL_ENV === "production" ? "production" : "test";
  await prisma.$transaction(async (tx) => {
    await lockControls(tx);
    await assertCurrentOperator(tx, actor);
    const old = await tx.auditLog.findFirst({ where: { action: "control.backup.created", entityId: receipt.encryptedSha256 } });
    if (old) return;
    await recordTransactionalAudit(tx, { actor, action: "control.backup.created", entityType: "backup_evidence", entityId: receipt.encryptedSha256, metadata: { ...receipt, environment } });
  }, { isolationLevel: "ReadCommitted" });
  return receipt;
}

async function lockControls(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
  // A stable singleton also serializes COO writes when no active admin exists.
  await tx.auditLog.createMany({ data: [{ id: "operations-control-lock-v1", action: "control.lock.initialized", entityType: "operations_control" }], skipDuplicates: true });
  await tx.$queryRaw`SELECT id FROM portfolio_audit_logs WHERE id = 'operations-control-lock-v1' FOR UPDATE`;
}

async function assertCurrentOperator(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], actor: AuthSession, superAdminOnly = false) {
  await tx.$queryRaw`SELECT id FROM portfolio_users WHERE id = ${actor.id} FOR UPDATE`;
  const current = await tx.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true, tokenVersion: true } });
  if (!current?.active || current.tokenVersion !== actor.tokenVersion || current.role !== actor.role || !(superAdminOnly ? current.role === "SUPER_ADMIN" : ["COO", "SUPER_ADMIN"].includes(current.role))) throw new Error("Drepturile s-au schimbat. Autentifica-te din nou.");
  if (actor.exp <= Math.floor(Date.now() / 1000)) throw new Error("Sesiunea a expirat. Autentifica-te din nou.");
  if (actor.sessionId) {
    await tx.$queryRaw`SELECT id FROM portfolio_auth_sessions WHERE id = ${actor.sessionId} FOR UPDATE`;
    const session = await tx.authSessionRecord.findUnique({ where: { id: actor.sessionId }, select: { userId: true, revokedAt: true, expiresAt: true } });
    if (!session || session.userId !== actor.id || session.revokedAt || session.expiresAt <= new Date()) throw new Error("Sesiunea a fost revocata. Autentifica-te din nou.");
  }
}

export async function updateOperationsPolicy(input: unknown, actor: AuthSession) {
  manager(actor);
  const parsed = z.object({ expectedVersion: z.number().int().nonnegative(), policy: policySchema }).strict().parse(input);
  return prisma.$transaction(async (tx) => {
    await lockControls(tx); await assertCurrentOperator(tx, actor); const current = await latestPolicy(tx);
    if (parsed.expectedVersion !== current.version) throw new Error("Politica a fost modificata. Reincarca inainte de salvare.");
    const version = current.version + 1;
    await recordTransactionalAudit(tx, { actor, action: "control.policy.updated", entityType: "operations_policy", entityId: String(version), metadata: { version, policy: parsed.policy } });
    return { ...parsed.policy, version, configured: true };
  }, { isolationLevel: "ReadCommitted" });
}

export async function registerRestoreEvidence(input: unknown, actor: AuthSession) {
  manager(actor); const receipt = verifyRestoreReceipt(input);
  const environment = process.env.VERCEL_ENV === "production" ? "production" : "test";
  await prisma.$transaction(async (tx) => {
    await lockControls(tx);
    await assertCurrentOperator(tx, actor);
    const old = await tx.auditLog.findFirst({ where: { action: "control.restore.verified", entityId: receipt.encryptedSha256 } });
    if (old) return;
    await recordTransactionalAudit(tx, { actor, action: "control.restore.verified", entityType: "backup_evidence", entityId: receipt.encryptedSha256, metadata: { ...receipt, environment } });
  }, { isolationLevel: "ReadCommitted" });
  return receipt;
}

type CleanupBatch = { actorId: string; policyVersion: number; expiresAt: number; sessions: string[]; tokens: string[]; limits: string[]; sessionCutoff: string; tokenCutoff: string; limitCutoff: string };
function previewKey() { return crypto.createHash("sha256").update(authSecret()).update("focus-retention-preview-v1").digest(); }
function seal(batch: CleanupBatch) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", previewKey(), iv);
  return Buffer.concat([iv, cipher.update(JSON.stringify(batch)), cipher.final(), cipher.getAuthTag()]).toString("base64url");
}
function unseal(token: string): CleanupBatch {
  if (token.length > 200000) throw new Error("Preview invalid.");
  const b = Buffer.from(token, "base64url"); if (b.length < 29) throw new Error("Preview invalid.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", previewKey(), b.subarray(0, 12)); decipher.setAuthTag(b.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(b.subarray(12, -16)), decipher.final()]).toString("utf8"));
}
export async function previewRetentionCleanup(actor: AuthSession) {
  if (actor.role !== "SUPER_ADMIN") throw new Error("Curatarea necesita SUPER_ADMIN.");
  const policy = await latestPolicy();
  if (!policy.configured) throw new Error("Aproba mai intai politica de retentie.");
  const cutoff = (days: number) => new Date(Date.now() - days * 86400000);
  const sessionCutoff = cutoff(policy.sessionRetentionDays), tokenCutoff = cutoff(policy.tokenRetentionDays), limitCutoff = cutoff(policy.rateLimitRetentionDays);
  const [sessions, tokens, limits] = await Promise.all([
    prisma.authSessionRecord.findMany({ where: { expiresAt: { lt: sessionCutoff } }, select: { id: true }, orderBy: { id: "asc" }, take: 500 }),
    prisma.authActionToken.findMany({ where: { expiresAt: { lt: tokenCutoff } }, select: { id: true }, orderBy: { id: "asc" }, take: 500 }),
    prisma.securityRateLimit.findMany({ where: { expiresAt: { lt: limitCutoff } }, select: { keyHash: true }, orderBy: { keyHash: "asc" }, take: 500 })
  ]);
  const expiresAt = Date.now() + 600000;
  return { counts: { sessions: sessions.length, tokens: tokens.length, limits: limits.length }, expiresAt: new Date(expiresAt).toISOString(), batchLimitPerType: 500,
    previewToken: seal({ actorId: actor.id, policyVersion: policy.version, expiresAt, sessions: sessions.map((x) => x.id), tokens: tokens.map((x) => x.id), limits: limits.map((x) => x.keyHash), sessionCutoff: sessionCutoff.toISOString(), tokenCutoff: tokenCutoff.toISOString(), limitCutoff: limitCutoff.toISOString() }),
    excludes: ["Clienti", "Contacte", "Facturi", "Plati", "Documente comerciale", "AuditLog", "Sesiuni sau tokenuri inca valabile"] };
}
export async function confirmRetentionCleanup(token: string, actor: AuthSession) {
  if (actor.role !== "SUPER_ADMIN") throw new Error("Curatarea necesita SUPER_ADMIN.");
  let b: CleanupBatch; try { b = unseal(token); } catch { throw new Error("Preview-ul nu este valid. Refa previzualizarea."); }
  if (b.actorId !== actor.id || b.expiresAt < Date.now()) throw new Error("Preview-ul a expirat sau apartine altui utilizator.");
  const id = crypto.createHash("sha256").update(token).digest("hex");
  return prisma.$transaction(async (tx) => {
    await lockControls(tx);
    await assertCurrentOperator(tx, actor, true);
    const prior = await tx.auditLog.findFirst({ where: { action: "control.retention.completed", entityId: id }, select: { metadata: true } });
    if (prior) return { replayed: true, counts: prior.metadata };
    if ((await latestPolicy(tx)).version !== b.policyVersion) throw new Error("Politica s-a schimbat. Refa previzualizarea.");
    const sessions = await tx.authSessionRecord.deleteMany({ where: { id: { in: b.sessions }, expiresAt: { lt: new Date(b.sessionCutoff) } } });
    const tokens = await tx.authActionToken.deleteMany({ where: { id: { in: b.tokens }, expiresAt: { lt: new Date(b.tokenCutoff) } } });
    const limits = await tx.securityRateLimit.deleteMany({ where: { keyHash: { in: b.limits }, expiresAt: { lt: new Date(b.limitCutoff) } } });
    const counts = { sessions: sessions.count, tokens: tokens.count, limits: limits.count };
    await recordTransactionalAudit(tx, { actor, action: "control.retention.completed", entityType: "retention_batch", entityId: id, metadata: counts });
    return { replayed: false, counts };
  }, { isolationLevel: "ReadCommitted" });
}

export async function syncOperationsControlAlerts() {
  const state = await getOperationsControls();
  const managers = await prisma.user.findMany({ where: { active: true, role: { in: ["COO", "SUPER_ADMIN"] } }, select: { id: true } });
  const issues = [
    ...(!state.policy.configured ? [{ key: "policy", title: "Politica de continuitate necesita aprobare", message: "Stabileste RPO, RTO si retentia in Control operational." }] : []),
    ...(state.backup.status !== "verified" ? [{ key: "restore", title: "Recuperarea bazei necesita verificare", message: "Lipseste un backup semnat recent sau o dovada de restaurare in limitele politicii pentru aceasta baza. Verifica separat si destinatia off-site a furnizorului." }] : [])
  ];
  return prisma.$transaction(async (tx) => {
    await lockControls(tx); let created = 0;
    for (const user of managers) for (const issue of issues) {
      const prior = await tx.appNotification.findFirst({ where: { userId: user.id, type: "operations_control", entityId: issue.key, status: "open" } });
      if (!prior) { await tx.appNotification.create({ data: { userId: user.id, type: "operations_control", entityType: "operations_control", entityId: issue.key, title: issue.title, message: issue.message, severity: "high", recommendedAction: "/admin/operations-control" } }); created++; }
    }
    await tx.appNotification.updateMany({ where: { type: "operations_control", status: "open", entityId: { notIn: issues.map((x) => x.key) } }, data: { status: "archived", resolvedAt: new Date() } });
    await recordTransactionalAudit(tx, { action: "control.alerts.checked", entityType: "operations_control", metadata: { created, openIssueCount: issues.length } });
    return { created, openIssueCount: issues.length };
  }, { isolationLevel: "ReadCommitted" });
}
