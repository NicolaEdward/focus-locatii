import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { createCampaign } from "@/lib/campaigns";
import { getCampaignsPage } from "@/lib/client-campaign-workspaces";
import { observeRoute, setObservabilityRole } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest) {
  return observeRoute(request, { route: "/api/admin/campaigns", operation: "campaigns.list" }, async () => {
    const { session, response } = await requireAnyPermission(request, ["campaigns.view", "campaigns.view.own"]);
    if (response || !session) return response;
    setObservabilityRole(session.role);
    const clientId = request.nextUrl.searchParams.get("clientId");
    const query = request.nextUrl.searchParams.get("q")?.trim() || "";
    const cursor = request.nextUrl.searchParams.get("cursor");
    const limit = Number(request.nextUrl.searchParams.get("limit") || (clientId ? 50 : 30));
    const page = await getCampaignsPage(session, { clientId, query, cursor, limit });
    return NextResponse.json({ campaigns: page.items, page }, { headers: noStoreHeaders });
  });
}

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["campaigns.manage", "reservations.manage", "reservations.manage.own"]);
  if (response || !session) return response;
  try {
    const campaign = await createCampaign(await request.json(), session);
    await recordAudit({
      actor: session,
      action: "campaign.create",
      entityType: "campaign",
      entityId: campaign.id,
      metadata: { clientId: campaign.clientId, campaignName: campaign.campaignName },
      request
    });
    return NextResponse.json({ campaign }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Campania nu a putut fi salvata." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}
