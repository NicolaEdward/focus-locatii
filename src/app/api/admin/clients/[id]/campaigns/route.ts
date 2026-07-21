import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { getCampaignsPage } from "@/lib/client-campaign-workspaces";

type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["campaigns.view", "campaigns.view.own"]);
  if (response || !session) return response;
  const { id } = await context.params;
  const cursor = request.nextUrl.searchParams.get("cursor");
  const page = await getCampaignsPage(session, { clientId: id, cursor, limit: 30 });
  return NextResponse.json({ campaigns: page.items, page }, { headers });
}
