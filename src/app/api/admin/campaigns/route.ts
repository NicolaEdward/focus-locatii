import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { createCampaign } from "@/lib/campaigns";
import { CAMPAIGN_DATE_FILTERS, getCampaignsPage, type CampaignDateFilter } from "@/lib/client-campaign-workspaces";
import { observeRoute, setObservabilityRole } from "@/lib/observability";
import { CAMPAIGN_EFFECTIVE_STATUSES, type CampaignEffectiveStatus } from "@/lib/campaigns/campaign-effective-status";
import { companyEntities } from "@/lib/company-entities";

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
    const ownerUserId = request.nextUrl.searchParams.get("owner");
    const query = request.nextUrl.searchParams.get("q")?.trim() || "";
    const cursor = request.nextUrl.searchParams.get("cursor");
    const requestedStatus = request.nextUrl.searchParams.get("effectiveStatus");
    const effectiveStatus = CAMPAIGN_EFFECTIVE_STATUSES.includes(requestedStatus as CampaignEffectiveStatus)
      ? requestedStatus as CampaignEffectiveStatus
      : null;
    const snapshotDate = validDate(request.nextUrl.searchParams.get("snapshot"));
    const entityCode = request.nextUrl.searchParams.get("entity");
    const companyEntityValues = companyEntities
      .filter((entity) => entity.code === entityCode)
      .map((entity) => entity.value);
    const requestedDateFilter = request.nextUrl.searchParams.get("dateFilter");
    const dateFilter = CAMPAIGN_DATE_FILTERS.includes(requestedDateFilter as CampaignDateFilter)
      ? requestedDateFilter as CampaignDateFilter
      : null;
    const limit = Number(request.nextUrl.searchParams.get("limit") || (clientId ? 50 : 30));
    const page = await getCampaignsPage(session, {
      clientId,
      ownerUserId,
      query,
      cursor,
      limit,
      effectiveStatus,
      snapshotDate,
      companyEntityValues,
      dateFilter
    });
    return NextResponse.json({ campaigns: page.items, page }, { headers: noStoreHeaders });
  });
}

function validDate(value: string | null) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : null;
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
