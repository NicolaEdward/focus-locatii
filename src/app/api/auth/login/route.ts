import { NextRequest, NextResponse } from "next/server";
import { authenticateCredentials, setSessionCookie } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { clearLoginFailures, loginRateLimit, recordLoginFailure } from "@/lib/login-rate-limit";
import { emitStructuredLog, observeRoute, setObservabilityRole } from "@/lib/observability";

export async function POST(request: NextRequest) {
  return observeRoute(request, { route: "/api/auth/login", operation: "auth.login" }, async () => {
    const limit = loginRateLimit(request);
    if (!limit.allowed) {
      emitStructuredLog("warn", "login_rate_limited", {
        status: 429,
        errorCode: "LOGIN_RATE_LIMITED",
        metrics: { retryAfterSeconds: limit.retryAfter }
      });
      return NextResponse.json(
        { error: "Prea multe incercari. Reincearca mai tarziu." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
      );
    }
    const body = await request.json().catch(() => null);
    const email = String(body?.email || "");
    const password = String(body?.password || "");

    if (email.length > 254 || password.length > 128) {
      recordLoginFailure(request);
      emitStructuredLog("warn", "login_failed", { status: 401, errorCode: "LOGIN_INPUT_INVALID" });
      return NextResponse.json({ error: "Date de login invalide." }, { status: 401 });
    }

    const user = await authenticateCredentials(email, password);
    if (!user) {
      recordLoginFailure(request);
      emitStructuredLog("warn", "login_failed", { status: 401, errorCode: "LOGIN_CREDENTIALS_INVALID" });
      return NextResponse.json({ error: "Date de login invalide." }, { status: 401 });
    }

    setObservabilityRole(user.role);
    const response = NextResponse.json({ ok: true, redirectTo: user.dashboardPath });
    clearLoginFailures(request);
    setSessionCookie(response, user);
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
