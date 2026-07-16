import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { findCrmDuplicates } from "@/lib/crm-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.view", "leads.view.own"]);
  if (response || !session) return response;
  try {
    const result = await findCrmDuplicates(request.nextUrl.searchParams.get("q") || "", session);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Verificarea duplicatelor nu a reusit." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}
