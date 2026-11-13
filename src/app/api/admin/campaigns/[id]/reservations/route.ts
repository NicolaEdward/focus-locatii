import { publicBusinessErrorMessage, publicBusinessErrorStatus } from "@/lib/public-business-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { getCampaignReservations } from "@/lib/client-campaign-workspaces";

type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["campaigns.view", "campaigns.view.own"]);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    return NextResponse.json({ reservations: await getCampaignReservations(session, id) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: publicBusinessErrorMessage(error, "Inchirierile nu pot fi afisate.", "campaigns.detail.reservations", request) }, { status: publicBusinessErrorStatus(error, 403), headers });
  }
}
