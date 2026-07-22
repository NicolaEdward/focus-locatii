import { NextRequest, NextResponse } from "next/server";
import { getAuthSessionFromRequest } from "@/lib/auth";
import { beginMfaEnrollment } from "@/lib/mfa";
import { recordAudit } from "@/lib/audit";
import { mutationRequestError, rateLimitIdentity } from "@/lib/request-security";
import { consumeRateLimit } from "@/lib/security-rate-limit";

export async function POST(request: NextRequest) {
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const session = await getAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Autentificare necesara." }, { status: 401 });
  const limit = await consumeRateLimit({ scope: "auth.mfa.enroll", identifier: rateLimitIdentity(request, session.id), limit: 5, windowSeconds: 60 * 60 });
  if (!limit.allowed) return NextResponse.json({ error: "Prea multe incercari de configurare." }, { status: 429 });
  try {
    const input = await request.json().catch(() => null);
    const enrollment = await beginMfaEnrollment(session, String(input?.currentPassword || ""));
    await recordAudit({ actor: session, action: "auth.mfa.enroll.started", entityType: "user", entityId: session.id, request });
    return NextResponse.json(enrollment, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "MFA nu a putut fi configurat." }, { status: 400 });
  }
}
