import { publicBusinessErrorMessage, publicBusinessErrorStatus } from "@/lib/public-business-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { getCampaignDocuments } from "@/lib/client-campaign-workspaces";

type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["campaigns.view", "campaigns.view.own"]);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    return NextResponse.json({ documents: await getCampaignDocuments(session, id) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: publicBusinessErrorMessage(error, "Documentele nu pot fi afisate.", "campaigns.detail.documents", request) }, { status: publicBusinessErrorStatus(error, 403), headers });
  }
}
