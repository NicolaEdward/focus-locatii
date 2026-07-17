import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { getCrmWorkspace } from "@/lib/crm-domain-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.view", "leads.view.own"]);
  if (response || !session) return response;
  try {
    const result = await getCrmWorkspace({ view: "today", ownerId: request.nextUrl.searchParams.get("owner") || undefined, limit: 10 }, session);
    return NextResponse.json({ summary: result.summary, generatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Indicatorii CRM nu au putut fi calculati." }, { status: 400 });
  }
}
