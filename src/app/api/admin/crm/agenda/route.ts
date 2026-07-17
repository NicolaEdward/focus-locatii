import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { listCrmDailyAgenda } from "@/lib/crm-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.view", "leads.view.own"]);
  if (response || !session) return response;
  try {
    const agenda = await listCrmDailyAgenda({
      assignee: request.nextUrl.searchParams.get("assignee")
    }, session);
    return NextResponse.json(agenda, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Agenda zilnica nu a putut fi incarcata." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}
