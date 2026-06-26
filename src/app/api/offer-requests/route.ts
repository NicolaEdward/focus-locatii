import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { createOfferRequest, listOfferRequests } from "@/lib/offer-requests";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.view", "leads.view.own"]);
  if (response || !session) return response;

  return NextResponse.json({ requests: await listOfferRequests(session) }, { headers: noStoreHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const offerRequest = await createOfferRequest(await request.json());
    return NextResponse.json({ request: offerRequest }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Solicitarea nu a putut fi trimisa." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}
