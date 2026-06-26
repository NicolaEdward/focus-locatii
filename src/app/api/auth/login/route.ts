import { NextRequest, NextResponse } from "next/server";
import { authenticateCredentials, setSessionCookie } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { clearLoginFailures, loginRateLimit, recordLoginFailure } from "@/lib/login-rate-limit";

export async function POST(request: NextRequest) {
  const limit = loginRateLimit(request);
  if (!limit.allowed) {
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
    return NextResponse.json({ error: "Date de login invalide." }, { status: 401 });
  }

  const user = await authenticateCredentials(email, password);
  if (!user) {
    recordLoginFailure(request);
    return NextResponse.json({ error: "Date de login invalide." }, { status: 401 });
  }

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
  return response;
}
