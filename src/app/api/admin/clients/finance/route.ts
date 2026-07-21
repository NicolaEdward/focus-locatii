import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { getClientPortfolioFinance } from "@/lib/client-campaign-workspaces";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["clients.view", "clients.view.own", "finance.view"]);
  if (response || !session) return response;
  return NextResponse.json({ finance: await getClientPortfolioFinance(session) }, { headers });
}
