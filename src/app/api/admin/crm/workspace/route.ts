import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { CrmDomainError, getCrmWorkspace } from "@/lib/crm-domain-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.view", "leads.view.own"]);
  if (response || !session) return response;
  try {
    const view = request.nextUrl.searchParams.get("view") || "today";
    const result = await getCrmWorkspace({
      view: ["today", "prospecting", "opportunities", "all"].includes(view) ? view as never : "today",
      query: request.nextUrl.searchParams.get("q") || "",
      ownerId: request.nextUrl.searchParams.get("owner") || undefined,
      status: request.nextUrl.searchParams.get("status") || undefined,
      stage: request.nextUrl.searchParams.get("stage") || undefined,
      source: request.nextUrl.searchParams.get("source") || undefined,
      industry: request.nextUrl.searchParams.get("industry") || undefined,
      due: (request.nextUrl.searchParams.get("due") || "all") as never,
      page: Number(request.nextUrl.searchParams.get("page") || 1),
      limit: Number(request.nextUrl.searchParams.get("limit") || 24)
    }, session);
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    return crmErrorResponse(error, "CRM-ul nu a putut fi incarcat.");
  }
}

const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate" };

function crmErrorResponse(error: unknown, fallback: string) {
  if (error instanceof CrmDomainError) return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.status, headers: noStoreHeaders });
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 400, headers: noStoreHeaders });
}
