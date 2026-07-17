import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { CrmDomainError, getCrmRecord } from "@/lib/crm-domain-service";

type Context = { params: Promise<{ kind: string; id: string }> };

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["leads.view", "leads.view.own"]);
  if (response || !session) return response;
  try {
    const { kind, id } = await context.params;
    if (kind !== "prospect" && kind !== "opportunity") return NextResponse.json({ error: "Tip CRM invalid." }, { status: 400 });
    const result = await getCrmRecord(kind, id, session, request.nextUrl.searchParams.get("cursor"));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof CrmDomainError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Inregistrarea nu a putut fi incarcata." }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
