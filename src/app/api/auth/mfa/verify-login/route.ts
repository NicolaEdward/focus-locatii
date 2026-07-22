import { NextRequest, NextResponse } from "next/server";
import { dashboardPathForRole } from "@/lib/rbac";
import { establishAuthenticatedSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { emitStructuredLog, observeRoute, setObservabilityRole } from "@/lib/observability";
import { verifyMfaLoginChallenge } from "@/lib/mfa";
import { mutationRequestError, rateLimitIdentity, rateLimitSubject } from "@/lib/request-security";
import { consumeRateLimit } from "@/lib/security-rate-limit";

export async function POST(request: NextRequest) {
  return observeRoute(request, { route: "/api/auth/mfa/verify-login", operation: "auth.mfa.verify" }, async () => {
    const originError = mutationRequestError(request);
    if (originError) return originError;
    const input = await request.json().catch(() => null);
    const challengeToken = String(input?.challengeToken || "");
    const code = String(input?.code || "");
    const [ipLimit, challengeLimit] = await Promise.all([
      consumeRateLimit({ scope: "auth.mfa.verify.ip", identifier: rateLimitIdentity(request), limit: 20, windowSeconds: 10 * 60 }),
      consumeRateLimit({ scope: "auth.mfa.verify.challenge", identifier: rateLimitSubject(challengeToken), limit: 10, windowSeconds: 10 * 60 })
    ]);
    if (!ipLimit.allowed || !challengeLimit.allowed) {
      return NextResponse.json(
        { error: "Prea multe coduri incorecte. Reia autentificarea mai tarziu." },
        { status: 429, headers: { "Retry-After": String(Math.max(ipLimit.retryAfter, challengeLimit.retryAfter)) } }
      );
    }

    try {
      const user = await verifyMfaLoginChallenge(challengeToken, code);
      if (!user) return NextResponse.json({ error: "Contul nu mai este activ." }, { status: 401 });
      setObservabilityRole(user.role);
      const response = NextResponse.json({ ok: true, redirectTo: dashboardPathForRole(user.role) });
      await establishAuthenticatedSession(response, user, request, new Date());
      await recordAudit({ actor: user, action: "auth.mfa.login", entityType: "user", entityId: user.id, request });
      emitStructuredLog("info", "mfa_login_succeeded", { status: 200, role: user.role });
      return response;
    } catch (error) {
      emitStructuredLog("warn", "mfa_login_failed", { status: 401, errorCode: "MFA_INVALID" });
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Codul MFA nu este valid." },
        { status: 401 }
      );
    }
  });
}
