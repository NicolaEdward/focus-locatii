import { NextRequest, NextResponse } from "next/server";
import { getAuthSessionFromRequest } from "@/lib/auth";
import { listAuthSessions } from "@/lib/auth-sessions";
import { getMfaStatus } from "@/lib/mfa";

export async function GET(request: NextRequest) {
  const session = await getAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Autentificare necesara." }, { status: 401 });
  const [mfa, sessions] = await Promise.all([getMfaStatus(session.id), listAuthSessions(session.id, session.sessionId)]);
  return NextResponse.json({ mfa, sessions }, { headers: { "Cache-Control": "no-store" } });
}
