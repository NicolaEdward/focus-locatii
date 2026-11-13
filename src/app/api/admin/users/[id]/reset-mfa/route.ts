import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimitIdentity } from "@/lib/request-security";
import { consumeRateLimit } from "@/lib/security-rate-limit";
import { assertRoleAssignmentAllowed } from "@/lib/rbac";
import { recordTransactionalAudit } from "@/lib/transactional-audit";
import { invalidatePendingMfaChallenges } from "@/lib/auth-action-tokens";

type Context = { params: Promise<{ id: string }> };
class ResetPolicyChangedError extends Error {}

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requirePermission(request, "users.manage");
  if (response || !session) return response;
  const { id } = await context.params;
  if (id === session.id) return NextResponse.json({ error: "Nu iti poti reseta singur MFA din administrarea utilizatorilor." }, { status: 400 });
  const limit = await consumeRateLimit({ scope: "auth.admin.mfa.reset", identifier: rateLimitIdentity(request, session.id), limit: 10, windowSeconds: 60 * 60 });
  if (!limit.allowed) return NextResponse.json({ error: "Limita de resetari MFA a fost atinsa temporar." }, { status: 429 });
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!target) return NextResponse.json({ error: "Utilizatorul nu exista." }, { status: 404 });
  try {
    assertRoleAssignmentAllowed(session.role, target.role, target.role);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nu poti modifica acest cont." }, { status: 403 });
  }
  const input = z.object({ reason: z.string().trim().min(3).max(1000), identityVerified: z.literal(true) }).strict().safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Confirma verificarea identitatii si completeaza motivul resetarii MFA." }, { status: 400 });
  let result: number;
  try {
    result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM portfolio_users WHERE role = 'SUPER_ADMIN' ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM portfolio_users WHERE id = ${id} FOR UPDATE`;
      // Recheck the target after the lock, including a concurrent role change.
      const lockedTarget = await tx.user.findUniqueOrThrow({ where: { id }, select: { role: true } });
      try {
        assertRoleAssignmentAllowed(session.role, lockedTarget.role, lockedTarget.role);
      } catch {
        throw new ResetPolicyChangedError("Permisiunile contului s-au schimbat. Actualizeaza lista utilizatorilor.");
      }
      const removed = await tx.authMfaCredential.deleteMany({ where: { userId: id } });
      await tx.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
      await invalidatePendingMfaChallenges(tx, id);
      await tx.authSessionRecord.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await recordTransactionalAudit(tx, { actor: session, action: "auth.mfa.admin_reset", entityType: "user", entityId: id, metadata: { credentialRemoved: removed.count === 1, sessionsRevoked: true, reason: input.data.reason, identityVerified: true } });
      return removed.count;
    });
  } catch (error) {
    if (error instanceof ResetPolicyChangedError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
  return NextResponse.json({ ok: true, credentialRemoved: result === 1 }, { headers: { "Cache-Control": "no-store" } });
}
