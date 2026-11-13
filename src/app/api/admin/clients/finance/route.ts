import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { getClientPortfolioFinance } from "@/lib/client-campaign-workspaces";
import { publicBusinessErrorMessage, publicBusinessErrorStatus } from "@/lib/public-business-error";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["clients.view", "clients.view.own", "finance.view"]);
  if (response || !session) return response;
  try {
    return NextResponse.json({ finance: await getClientPortfolioFinance(session) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: publicBusinessErrorMessage(error, "Rezumatul financiar al portofoliului nu poate fi încărcat.", "clients.finance", request) }, { status: publicBusinessErrorStatus(error, 503), headers });
  }
}
