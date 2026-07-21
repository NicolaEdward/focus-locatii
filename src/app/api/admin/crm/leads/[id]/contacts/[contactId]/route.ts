import { NextRequest } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { crmLegacyRetiredResponse } from "@/lib/crm-legacy";

export async function PATCH(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;
  return crmLegacyRetiredResponse(request, "/api/admin/crm/commands", "write");
}

export async function DELETE(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;
  return crmLegacyRetiredResponse(request, "/api/admin/crm/commands", "write");
}
