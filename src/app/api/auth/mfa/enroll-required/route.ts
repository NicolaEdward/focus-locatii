import { NextRequest, NextResponse } from "next/server";
import { beginRequiredMfaEnrollment } from "@/lib/mfa";
import { mutationRequestError, rateLimitIdentity, rateLimitSubject } from "@/lib/request-security";
import { consumeRateLimit } from "@/lib/security-rate-limit";

export async function POST(request: NextRequest) {
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const input = await request.json().catch(() => null);
  const token = String(input?.enrollmentToken || "");
  const limits = await Promise.all([
    consumeRateLimit({ scope: "auth.mfa.required.begin.ip", identifier: rateLimitIdentity(request), limit: 20, windowSeconds: 10 * 60 }),
    consumeRateLimit({ scope: "auth.mfa.required.begin.token", identifier: rateLimitSubject(token), limit: 5, windowSeconds: 10 * 60 })
  ]);
  if (limits.some((limit) => !limit.allowed)) return NextResponse.json({ error: "Prea multe incercari. Reia autentificarea mai tarziu." }, { status: 429, headers: { "Cache-Control": "no-store" } });
  try {
    const { enrollment } = await beginRequiredMfaEnrollment(token);
    return NextResponse.json(enrollment, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Configurarea a expirat sau contul s-a schimbat. Reia autentificarea." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
}
