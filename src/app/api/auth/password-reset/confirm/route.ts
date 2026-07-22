import { NextRequest, NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { resetPasswordWithToken } from "@/lib/auth-workflows";
import { mutationRequestError, rateLimitIdentity } from "@/lib/request-security";
import { consumeRateLimit } from "@/lib/security-rate-limit";

export async function POST(request: NextRequest) {
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const limit = await consumeRateLimit({ scope: "auth.password.confirm", identifier: rateLimitIdentity(request), limit: 8, windowSeconds: 60 * 60 });
  if (!limit.allowed) return NextResponse.json({ error: "Prea multe incercari. Reincearca mai tarziu." }, { status: 429 });
  try {
    const input = await request.json();
    const user = await resetPasswordWithToken(String(input?.token || ""), input?.password);
    await recordAudit({ actor: user, action: "auth.password.reset.complete", entityType: "user", entityId: user.id, metadata: { sessionsRevoked: true }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Parola nu a putut fi resetata." }, { status: 400 });
  }
}
