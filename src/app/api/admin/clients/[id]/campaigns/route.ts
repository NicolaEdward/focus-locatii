import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { getCampaignsPage } from "@/lib/client-campaign-workspaces";
import { publicBusinessErrorMessage, publicBusinessErrorStatus } from "@/lib/public-business-error";

type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["campaigns.view", "campaigns.view.own"]);
  if (response || !session) return response;
  const { id } = await context.params;
  const cursor = request.nextUrl.searchParams.get("cursor");
  try {
    const page = await getCampaignsPage(session, { clientId: id, cursor, limit: 30 });
    return NextResponse.json({ campaigns: page.items, page }, { headers });
  } catch (error) {
    return NextResponse.json({ error: publicBusinessErrorMessage(error, "Campaniile clientului nu pot fi încărcate.", "clients.detail.campaigns", request) }, { status: publicBusinessErrorStatus(error, 403), headers });
  }
}
