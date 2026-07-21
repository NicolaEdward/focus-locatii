import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { archiveCampaign, updateCampaign } from "@/lib/campaigns";
import { getCampaignOverview } from "@/lib/client-campaign-workspaces";

type Context = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["campaigns.view", "campaigns.view.own"]);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    const campaign = await getCampaignOverview(session, id);
    if (!campaign) return NextResponse.json({ error: "Campania nu exista." }, { status: 404, headers: noStoreHeaders });
    return NextResponse.json({ campaign }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nu ai acces la campanie." }, { status: 403, headers: noStoreHeaders });
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["campaigns.manage", "reservations.manage", "reservations.manage.own"]);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    const campaign = await updateCampaign(id, await request.json(), session);
    await recordAudit({ actor: session, action: "campaign.update", entityType: "campaign", entityId: id, request });
    return NextResponse.json({ campaign }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Campania nu a putut fi actualizata." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["campaigns.manage"]);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    const campaign = await archiveCampaign(id, session);
    await recordAudit({ actor: session, action: "campaign.archive", entityType: "campaign", entityId: id, request });
    return NextResponse.json({ campaign }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Campania nu a putut fi arhivata." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}
