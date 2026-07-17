import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;
  const { id } = await context.params;
  return NextResponse.json({
    error: "Conversia automata in client a fost dezactivata. Firmele CRM si clientii sunt registre independente.",
    code: "CRM_CLIENT_CONVERSION_DISABLED",
    legacyLeadId: id
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
