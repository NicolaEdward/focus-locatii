import { NextRequest, NextResponse } from "next/server";
import { getAuthSessionFromRequest } from "@/lib/auth";
import { confirmMfaEnrollment } from "@/lib/mfa";
import { recordAudit } from "@/lib/audit";
import { mutationRequestError, rateLimitIdentity } from "@/lib/request-security";
import { consumeRateLimit } from "@/lib/security-rate-limit";

export async function POST(request: NextRequest) {
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const session = await getAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Autentificare necesara." }, { status: 401 });
  const limit = await consumeRateLimit({ scope: "auth.mfa.confirm", identifier: rateLimitIdentity(request, session.id), limit: 10, windowSeconds: 30 * 60 });
  if (!limit.allowed) return NextResponse.json({ error: "Prea multe coduri incorecte." }, { status: 429 });
  try {
    const input = await request.json();
    const recoveryCodes = await confirmMfaEnrollment(session.id, String(input?.code || ""));
    await recordAudit({ actor: session, action: "auth.mfa.enroll.completed", entityType: "user", entityId: session.id, metadata: { recoveryCodesIssued: recoveryCodes.length }, request });
    return NextResponse.json({ ok: true, recoveryCodes }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Codul MFA nu este valid." }, { status: 400 });
  }
}
