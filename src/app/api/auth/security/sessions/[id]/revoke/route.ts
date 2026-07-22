import { NextRequest, NextResponse } from "next/server";
import { clearAdminCookie, getAuthSessionFromRequest } from "@/lib/auth";
import { revokeAuthSession } from "@/lib/auth-sessions";
import { recordAudit } from "@/lib/audit";
import { mutationRequestError } from "@/lib/request-security";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const session = await getAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Autentificare necesara." }, { status: 401 });
  const { id } = await context.params;
  const result = await revokeAuthSession(session.id, id);
  if (!result.count) return NextResponse.json({ error: "Sesiunea nu exista." }, { status: 404 });
  const response = NextResponse.json({ ok: true, currentSessionRevoked: id === session.sessionId });
  if (id === session.sessionId) clearAdminCookie(response);
  await recordAudit({ actor: session, action: "auth.session.revoke", entityType: "auth_session", entityId: id, metadata: { currentSession: id === session.sessionId }, request });
  return response;
}
