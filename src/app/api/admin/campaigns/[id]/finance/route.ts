import { publicBusinessErrorMessage, publicBusinessErrorStatus } from "@/lib/public-business-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { getCampaignFinanceSummary } from "@/lib/client-campaign-workspaces";

type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["finance.view", "campaigns.view", "campaigns.view.own"]);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    return NextResponse.json({ finance: await getCampaignFinanceSummary(session, id) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: publicBusinessErrorMessage(error, "Rezumatul financiar nu poate fi afisat.", "campaigns.detail.finance", request) }, { status: publicBusinessErrorStatus(error, 403), headers });
  }
}
