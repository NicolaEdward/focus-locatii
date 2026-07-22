import { NextRequest, NextResponse } from "next/server";
import { authenticateCredentials, establishAuthenticatedSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { emitStructuredLog, observeRoute, setObservabilityRole } from "@/lib/observability";
import { issueMfaLoginChallenge, mfaEnrollmentRequired } from "@/lib/mfa";
import { mutationRequestError, rateLimitIdentity, rateLimitSubject } from "@/lib/request-security";
import { clearRateLimit, consumeRateLimit } from "@/lib/security-rate-limit";

export async function POST(request: NextRequest) {
  return observeRoute(request, { route: "/api/auth/login", operation: "auth.login" }, async () => {
    const originError = mutationRequestError(request);
    if (originError) return originError;
    const body = await request.json().catch(() => null);
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");
    const ipIdentifier = rateLimitIdentity(request);
    const accountIdentifier = rateLimitSubject(email || "invalid-email");
    const [ipLimit, accountLimit] = await Promise.all([
      consumeRateLimit({ scope: "auth.login.ip", identifier: ipIdentifier, limit: 8, windowSeconds: 15 * 60 }),
      consumeRateLimit({ scope: "auth.login.account", identifier: accountIdentifier, limit: 20, windowSeconds: 15 * 60 })
    ]);
    if (!ipLimit.allowed || !accountLimit.allowed) {
      emitStructuredLog("warn", "login_rate_limited", {
        status: 429,
        errorCode: "LOGIN_RATE_LIMITED",
        metrics: { retryAfterSeconds: Math.max(ipLimit.retryAfter, accountLimit.retryAfter) }
      });
      return NextResponse.json(
        { error: "Prea multe incercari. Reincearca mai tarziu." },
        { status: 429, headers: { "Retry-After": String(Math.max(ipLimit.retryAfter, accountLimit.retryAfter)) } }
      );
    }

    if (email.length > 254 || password.length > 128) {
      emitStructuredLog("warn", "login_failed", { status: 401, errorCode: "LOGIN_INPUT_INVALID" });
      return NextResponse.json({ error: "Date de login invalide." }, { status: 401 });
    }

    const user = await authenticateCredentials(email, password);
    if (!user) {
      emitStructuredLog("warn", "login_failed", { status: 401, errorCode: "LOGIN_CREDENTIALS_INVALID" });
      return NextResponse.json({ error: "Date de login invalide." }, { status: 401 });
    }

    setObservabilityRole(user.role);
    if (user.mfaEnrolled) {
      const challenge = await issueMfaLoginChallenge(user.id);
      await Promise.all([
        clearRateLimit("auth.login.ip", ipIdentifier),
        clearRateLimit("auth.login.account", accountIdentifier)
      ]);
      emitStructuredLog("info", "mfa_challenge_issued", { status: 200, role: user.role });
      return NextResponse.json({ ok: true, mfaRequired: true, challengeToken: challenge.token });
    }
    if (mfaEnrollmentRequired(user.role)) {
      emitStructuredLog("warn", "mfa_enrollment_required", { status: 403, role: user.role, errorCode: "MFA_ENROLLMENT_REQUIRED" });
      return NextResponse.json(
        { error: "MFA este obligatoriu pentru acest rol. Contacteaza administratorul pentru inscriere sigura.", mfaEnrollmentRequired: true },
        { status: 403 }
      );
    }

    const response = NextResponse.json({ ok: true, redirectTo: user.dashboardPath });
    await Promise.all([
      clearRateLimit("auth.login.ip", ipIdentifier),
      clearRateLimit("auth.login.account", accountIdentifier)
    ]);
    await establishAuthenticatedSession(response, user, request);
    await recordAudit({
      actor: user,
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
      request
    });
    emitStructuredLog("info", "login_succeeded", { status: 200, role: user.role });
    return response;
  });
}
