import crypto from "node:crypto";
import type { AuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordTransactionalAudit } from "@/lib/transactional-audit";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function crmDomainIntentionKey(actorId: string, key: string) {
  return "crm-v1:" + crypto.createHash("sha256").update(actorId).update("\0").update(key).digest("hex");
}
export class CrmIntentionConflict extends Error {
  constructor(readonly code: string) { super("Aceasta intentie a fost deja folosita sau datele ei s-au schimbat. Verifica rezultatul fara sa retrimiti comanda."); }
}
export type CrmIntentionClaim = { id: string; domainKey: string };

/** One actor-scoped key binds one payload. A possibly committed write is never replayed. */
export async function claimCrmCommandIntention(payload: Record<string, unknown>, actor: AuthSession): Promise<CrmIntentionClaim | null> {
  if (typeof payload.idempotencyKey !== "string" || !payload.idempotencyKey) return null;
  const domainKey = crmDomainIntentionKey(actor.id, payload.idempotencyKey);
  const payloadHash = crypto.createHash("sha256").update(canonical(JSON.parse(JSON.stringify(payload)))).digest("hex");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM portfolio_users WHERE id = ${actor.id} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true, tokenVersion: true } });
    if (!user?.active || user.role !== actor.role || user.tokenVersion !== actor.tokenVersion) throw new CrmIntentionConflict("CRM_PRINCIPAL_CHANGED");
    const legacy = await tx.crmEvent.findFirst({ where: { actorUserId: actor.id, idempotencyKey: { in: [payload.idempotencyKey as string, `${payload.idempotencyKey}:prospect`, `${payload.idempotencyKey}:opportunity`] } }, select: { id: true } });
    if (legacy) throw new CrmIntentionConflict("CRM_INTENT_ALREADY_SUBMITTED");
    const events = await tx.auditLog.findMany({ where: { entityType: "crm_command_intention", entityId: domainKey }, select: { id: true, action: true, metadata: true } });
    const claims = events.filter((e) => e.action === "crm.command.intention.claimed");
    const metadata = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : {};
    if (claims.some((e) => metadata(e.metadata).payloadHash !== payloadHash)) throw new CrmIntentionConflict("CRM_INTENT_PAYLOAD_MISMATCH");
    const rejected = new Set(events.filter((e) => e.action === "crm.command.intention.rejected").map((e) => metadata(e.metadata).claimId));
    if (claims.some((e) => !rejected.has(e.id))) throw new CrmIntentionConflict("CRM_INTENT_ALREADY_SUBMITTED");
    const row = await recordTransactionalAudit(tx, { actor, action: "crm.command.intention.claimed", entityType: "crm_command_intention", entityId: domainKey, metadata: { payloadHash, command: payload.action } });
    return { id: row.id, domainKey };
  }, { isolationLevel: "ReadCommitted" });
}

export async function markCrmIntentionRejected(claim: CrmIntentionClaim | null, actor: AuthSession) {
  if (!claim) return;
  await prisma.$transaction(async (tx) => {
    await recordTransactionalAudit(tx, { actor, action: "crm.command.intention.rejected", entityType: "crm_command_intention", entityId: claim.domainKey, metadata: { claimId: claim.id } });
  });
}
