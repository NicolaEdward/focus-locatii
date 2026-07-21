import { NextRequest } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { crmLegacyRetiredResponse } from "@/lib/crm-legacy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.view", "leads.view.own"]);
  if (response || !session) return response;
  return crmLegacyRetiredResponse(request, "/api/admin/crm/workspace");
}

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;
  return crmLegacyRetiredResponse(request, "/api/admin/crm/commands", "write");
}
