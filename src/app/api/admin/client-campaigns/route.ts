import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getClientCampaignsData } from "@/lib/client-campaigns";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest) {
  const { session, response } = await requireAdmin(request);
  if (response || !session) return response;
  const query = request.nextUrl.searchParams.get("q") || "";
  const data = await getClientCampaignsData(session, query);
  return NextResponse.json({ data }, { headers: noStoreHeaders });
}
