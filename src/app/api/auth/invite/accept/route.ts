import { NextRequest, NextResponse } from "next/server";
import { acceptUserInvite } from "@/lib/auth-workflows";
import { recordAudit } from "@/lib/audit";
import { mutationRequestError, rateLimitIdentity } from "@/lib/request-security";
import { consumeRateLimit } from "@/lib/security-rate-limit";

export async function POST(request: NextRequest) {
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const limit = await consumeRateLimit({ scope: "auth.invite.accept", identifier: rateLimitIdentity(request), limit: 8, windowSeconds: 60 * 60 });
  if (!limit.allowed) return NextResponse.json({ error: "Prea multe incercari. Reincearca mai tarziu." }, { status: 429 });
  try {
    const input = await request.json();
    const user = await acceptUserInvite(String(input?.token || ""), input?.password);
    await recordAudit({ actor: user, action: "auth.invite.accept", entityType: "user", entityId: user.id, metadata: { role: user.role }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invitatia nu a putut fi acceptata." }, { status: 400 });
  }
}
