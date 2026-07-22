import { NextRequest, NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { requestPasswordReset } from "@/lib/auth-workflows";
import { emitStructuredLog, observeRoute } from "@/lib/observability";
import { mutationRequestError, rateLimitIdentity, rateLimitSubject } from "@/lib/request-security";
import { consumeRateLimit } from "@/lib/security-rate-limit";

const GENERIC_MESSAGE = "Daca exista un cont activ, vei primi instructiunile de resetare.";

export async function POST(request: NextRequest) {
  return observeRoute(request, { route: "/api/auth/password-reset/request", operation: "auth.password.reset.request" }, async () => {
    const originError = mutationRequestError(request);
    if (originError) return originError;
    const input = await request.json().catch(() => null);
    const email = String(input?.email || "");
    const [ipLimit, accountLimit] = await Promise.all([
      consumeRateLimit({ scope: "auth.password.reset.ip", identifier: rateLimitIdentity(request), limit: 12, windowSeconds: 60 * 60 }),
      consumeRateLimit({ scope: "auth.password.reset.account", identifier: rateLimitSubject(email), limit: 4, windowSeconds: 60 * 60 })
    ]);
    if (!ipLimit.allowed || !accountLimit.allowed) return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 202 });
    try {
      const result = await requestPasswordReset(email);
      await recordAudit({ actor: null, action: "auth.password.reset.request", entityType: "authentication", metadata: { accepted: true }, request });
      return NextResponse.json({ message: GENERIC_MESSAGE, ...(result.syntheticLink ? { testResetLink: result.syntheticLink } : {}) }, { status: 202 });
    } catch (error) {
      if (error instanceof Error && error.message === "AUTH_EMAIL_NOT_CONFIGURED") {
        return NextResponse.json({ error: "Resetarea prin email nu este configurata. Contacteaza administratorul." }, { status: 503 });
      }
      emitStructuredLog("warn", "password_reset_request_failed", { status: 202, errorCode: "PASSWORD_RESET_REQUEST_FAILED" });
      return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 202 });
    }
  });
}
