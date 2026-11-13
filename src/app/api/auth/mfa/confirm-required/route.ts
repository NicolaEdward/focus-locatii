import { NextRequest, NextResponse } from "next/server";
import { establishAuthenticatedSession } from "@/lib/auth";
import { dashboardPathForRole } from "@/lib/rbac";
import { confirmRequiredMfaEnrollment } from "@/lib/mfa";
import { mutationRequestError, rateLimitIdentity, rateLimitSubject } from "@/lib/request-security";
import { consumeRateLimit } from "@/lib/security-rate-limit";

export async function POST(request: NextRequest) {
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const input = await request.json().catch(() => null);
  const token = String(input?.enrollmentToken || "");
  const code = String(input?.code || "");
  const limits = await Promise.all([
    consumeRateLimit({ scope: "auth.mfa.required.confirm.ip", identifier: rateLimitIdentity(request), limit: 20, windowSeconds: 10 * 60 }),
    consumeRateLimit({ scope: "auth.mfa.required.confirm.token", identifier: rateLimitSubject(token), limit: 10, windowSeconds: 10 * 60 })
  ]);
  if (limits.some((limit) => !limit.allowed)) return NextResponse.json({ error: "Prea multe coduri incorecte. Reia autentificarea mai tarziu." }, { status: 429, headers: { "Cache-Control": "no-store" } });
  try {
    if (code.length > 128) throw new Error("Cod invalid.");
    const { user, recoveryCodes } = await confirmRequiredMfaEnrollment(token, code);
    const response = NextResponse.json({ ok: true, recoveryCodes, redirectTo: dashboardPathForRole(user.role) }, { headers: { "Cache-Control": "no-store" } });
    await establishAuthenticatedSession(response, user, request, new Date());
    return response;
  } catch {
    return NextResponse.json({ error: "Codul nu este valid sau configurarea a expirat. Verifica datele ori reia autentificarea." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
}
