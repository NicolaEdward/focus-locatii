import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { createCampaign } from "@/lib/campaigns";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["campaigns.view", "campaigns.view.own"]);
  if (response || !session) return response;
  const clientId = request.nextUrl.searchParams.get("clientId") || undefined;
  const query = request.nextUrl.searchParams.get("q")?.trim() || "";
  const campaigns = await prisma.campaign.findMany({
    where: {
      archivedAt: null,
      status: { not: "archived" },
      ...(clientId ? { clientId } : {}),
      ...(session.role === "SALES_AGENT"
        ? {
            OR: [
              { sellerUserId: session.id },
              { accountOwnerUserId: session.id },
              { client: { accountOwnerUserId: session.id } }
            ]
          }
        : {}),
      ...(query
        ? {
            OR: [
              { campaignName: { contains: query } },
              { campaignCode: { contains: query } },
              { client: { companyName: { contains: query } } }
            ]
          }
        : {})
    },
    include: {
      client: { select: { id: true, companyName: true, accountOwnerUserId: true } },
      reservations: { select: { id: true, location: { select: { code: true, city: true } } } }
    },
    orderBy: [{ startDate: "desc" }, { updatedAt: "desc" }],
    take: 300
  });
  return NextResponse.json({ campaigns }, { headers: noStoreHeaders });
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
