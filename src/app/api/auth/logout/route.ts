import { NextRequest, NextResponse } from "next/server";
import { clearAdminCookie, getAuthSessionFromRequest } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export async function POST(request: NextRequest) {
  const session = await getAuthSessionFromRequest(request);
  const response = NextResponse.json({ ok: true });
  clearAdminCookie(response);
  if (session) await recordAudit({ actor: session, action: "auth.logout", entityType: "user", entityId: session.id, request });
  return response;
}
