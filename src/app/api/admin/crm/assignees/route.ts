import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { validCrmAssignees } from "@/lib/crm-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.view"]);
  if (response || !session) return response;
  const assignees = session.role === "SALES_AGENT"
    ? [{ id: session.id, name: session.name, email: session.email, role: session.role }]
    : await validCrmAssignees();
  return NextResponse.json({ assignees }, { headers: { "Cache-Control": "no-store" } });
}
