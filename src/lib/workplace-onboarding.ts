import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordTransactionalAudit } from "@/lib/transactional-audit";
import { workplaceGuide, WORKPLACE_GUIDE_VERSION } from "@/lib/workplace-guide";

const ACTION = "account.onboarding.updated";
const progressInput = z.object({
  version: z.number().int().nonnegative(),
  completedStepIds: z.array(z.string().max(80)).max(20),
}).strict();

export type OnboardingState = {
  version: number;
  guideVersion: number;
  role: AuthSession["role"];
  completedStepIds: string[];
  updatedAt: string | null;
};

export class OnboardingError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); }
}

type Reader = Pick<Prisma.TransactionClient, "auditLog">;
function progressId(actor: AuthSession) { return `${actor.id}:${actor.role}:v${WORKPLACE_GUIDE_VERSION}`; }

export async function onboardingState(actor: AuthSession, db: Reader = prisma): Promise<OnboardingState> {
  const row = await db.auditLog.findFirst({
    where: { userId: actor.id, action: ACTION, entityType: "account_onboarding", entityId: progressId(actor) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { metadata: true, createdAt: true },
  });
  const metadata = row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {};
  const allowed = new Set(workplaceGuide(actor.role).steps.map((step) => step.id));
  const completed = Array.isArray(metadata.completedStepIds) ? metadata.completedStepIds.filter((id): id is string => typeof id === "string" && allowed.has(id)) : [];
  return {
    version: Number.isSafeInteger(metadata.version) && Number(metadata.version) >= 0 ? Number(metadata.version) : 0,
    guideVersion: WORKPLACE_GUIDE_VERSION,
    role: actor.role,
    completedStepIds: [...new Set(completed)].sort(),
    updatedAt: row?.createdAt.toISOString() || null,
  };
}

/** Personal learning checklist, not authorization, certification or a business mutation. */
export async function updateOnboardingProgress(raw: unknown, actor: AuthSession): Promise<OnboardingState> {
  const input = progressInput.parse(raw);
  const allowed = new Set(workplaceGuide(actor.role).steps.map((step) => step.id));
  if (input.completedStepIds.some((id) => !allowed.has(id))) throw new OnboardingError("Pasul nu aparține ghidului rolului tău.", "ONBOARDING_INVALID_STEP", 400);
  const completedStepIds = [...new Set(input.completedStepIds)].sort();
  return prisma.$transaction(async (tx) => {
    // Serialize only this user's learning record and revalidate the signed principal.
    await tx.$queryRaw`SELECT id FROM portfolio_users WHERE id = ${actor.id} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true, tokenVersion: true } });
    if (!user?.active || user.role !== actor.role || user.tokenVersion !== actor.tokenVersion || actor.exp <= Math.floor(Date.now() / 1000)) {
      throw new OnboardingError("Contul sau drepturile s-au schimbat. Autentifică-te din nou.", "ONBOARDING_SESSION_CHANGED", 401);
    }
    if (actor.sessionId) {
      await tx.$queryRaw`SELECT id FROM portfolio_auth_sessions WHERE id = ${actor.sessionId} FOR UPDATE`;
      const session = await tx.authSessionRecord.findUnique({ where: { id: actor.sessionId }, select: { userId: true, revokedAt: true, expiresAt: true } });
      if (!session || session.userId !== actor.id || session.revokedAt || session.expiresAt <= new Date()) throw new OnboardingError("Sesiunea a fost revocată. Autentifică-te din nou.", "ONBOARDING_SESSION_CHANGED", 401);
    }
    const current = await onboardingState(actor, tx);
    // A timeout/retry of an already saved checklist must not create another event.
    if (JSON.stringify(completedStepIds) === JSON.stringify(current.completedStepIds)) return current;
    if (input.version !== current.version) throw new OnboardingError("Ghidul a fost actualizat în altă fereastră. Reîncarcă înainte de a continua.", "ONBOARDING_VERSION_CONFLICT", 409);
    const event = await recordTransactionalAudit(tx, {
      actor,
      action: ACTION,
      entityType: "account_onboarding",
      entityId: progressId(actor),
      metadata: { version: current.version + 1, guideVersion: WORKPLACE_GUIDE_VERSION, role: actor.role, completedStepIds, selfReported: true },
    });
    return { ...current, version: current.version + 1, completedStepIds, updatedAt: event.createdAt.toISOString() };
  }, { isolationLevel: "ReadCommitted" });
}
