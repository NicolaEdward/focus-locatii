import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { findCrmDuplicates } from "@/lib/crm-domain-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.view", "leads.view.own"]);
  if (response || !session) return response;
  try {
    const matches = await findCrmDuplicates({
      companyName: request.nextUrl.searchParams.get("companyName"),
      taxId: request.nextUrl.searchParams.get("taxId"),
      website: request.nextUrl.searchParams.get("website"),
      email: request.nextUrl.searchParams.get("email"),
      phone: request.nextUrl.searchParams.get("phone")
    }, session);
    return NextResponse.json({ matches }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Verificarea duplicatelor a esuat." }, { status: 400 });
  }
}
