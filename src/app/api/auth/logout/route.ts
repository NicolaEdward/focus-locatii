import { NextRequest, NextResponse } from "next/server";
import { clearAdminCookie, getAuthSessionFromRequest } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { mutationRequestError } from "@/lib/request-security";
import { revokeAuthSession } from "@/lib/auth-sessions";

export async function POST(request: NextRequest) {
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const session = await getAuthSessionFromRequest(request);
  const response = NextResponse.json({ ok: true });
  clearAdminCookie(response);
  if (session) {
    if (session.sessionId) await revokeAuthSession(session.id, session.sessionId);
    await recordAudit({ actor: session, action: "auth.logout", entityType: "user", entityId: session.id, request });
  }
  return response;
}
