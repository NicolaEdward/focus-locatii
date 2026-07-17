import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { listCrmAssignees } from "@/lib/crm-domain-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.view"]);
  if (response || !session) return response;
  const assignees = await listCrmAssignees(session);
  return NextResponse.json({ assignees }, { headers: { "Cache-Control": "no-store" } });
}
