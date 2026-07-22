import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { revokeAllAuthSessions } from "@/lib/auth-sessions";
import { rateLimitIdentity } from "@/lib/request-security";
import { consumeRateLimit } from "@/lib/security-rate-limit";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requirePermission(request, "users.manage");
  if (response || !session) return response;
  const { id } = await context.params;
  if (id === session.id) return NextResponse.json({ error: "Nu iti poti reseta singur MFA din administrarea utilizatorilor." }, { status: 400 });
  const limit = await consumeRateLimit({ scope: "auth.admin.mfa.reset", identifier: rateLimitIdentity(request, session.id), limit: 10, windowSeconds: 60 * 60 });
  if (!limit.allowed) return NextResponse.json({ error: "Limita de resetari MFA a fost atinsa temporar." }, { status: 429 });
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!target) return NextResponse.json({ error: "Utilizatorul nu exista." }, { status: 404 });
  if (target.role === "SUPER_ADMIN" && session.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Doar SUPER_ADMIN poate reseta MFA pentru alt SUPER_ADMIN." }, { status: 403 });
  }
  const result = await prisma.$transaction(async (tx) => {
    const removed = await tx.authMfaCredential.deleteMany({ where: { userId: id } });
    await tx.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
    return removed.count;
  });
  await revokeAllAuthSessions(id);
  await recordAudit({ actor: session, action: "auth.mfa.admin_reset", entityType: "user", entityId: id, metadata: { credentialRemoved: result === 1, sessionsRevoked: true }, request });
  return NextResponse.json({ ok: true, credentialRemoved: result === 1 });
}
