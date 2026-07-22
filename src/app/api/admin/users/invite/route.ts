import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { createUserInvite } from "@/lib/auth-workflows";
import { recordAudit } from "@/lib/audit";
import { rateLimitIdentity } from "@/lib/request-security";
import { consumeRateLimit } from "@/lib/security-rate-limit";

export async function POST(request: NextRequest) {
  const { session, response } = await requirePermission(request, "users.manage");
  if (response || !session) return response;
  const limit = await consumeRateLimit({ scope: "auth.invite.create", identifier: rateLimitIdentity(request, session.id), limit: 20, windowSeconds: 60 * 60 });
  if (!limit.allowed) return NextResponse.json({ error: "Limita de invitatii a fost atinsa temporar." }, { status: 429 });
  try {
    const input = await request.json();
    const result = await createUserInvite(input, session);
    await recordAudit({ actor: session, action: "auth.invite.create", entityType: "user_invite", metadata: { role: input?.role, expiresAt: result.expiresAt.toISOString() }, request });
    return NextResponse.json({ ok: true, expiresAt: result.expiresAt.toISOString(), ...(result.syntheticLink ? { testInviteLink: result.syntheticLink } : {}) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invitatia nu a putut fi trimisa." }, { status: 400 });
  }
}
