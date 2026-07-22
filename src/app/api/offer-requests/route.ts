import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { createOfferRequest, listOfferRequests } from "@/lib/offer-requests";
import { mutationRequestError, rateLimitIdentity, rateLimitSubject } from "@/lib/request-security";
import { consumeRateLimit } from "@/lib/security-rate-limit";
import { emitStructuredLog } from "@/lib/observability";

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
  const originError = mutationRequestError(request);
  if (originError) return originError;
  try {
    const input = await request.json();
    if (String(input?.website || "").trim()) {
      emitStructuredLog("warn", "public_offer_honeypot_triggered", { operation: "offer.request.create", status: 202, errorCode: "HONEYPOT" });
      return NextResponse.json({ accepted: true }, { status: 202, headers: noStoreHeaders });
    }
    const contactKey = `${String(input?.email || "").trim().toLowerCase()}:${String(input?.phone || "").replace(/\D/g, "")}`;
    const [ipLimit, contactLimit] = await Promise.all([
      consumeRateLimit({ scope: "offer.request.ip", identifier: rateLimitIdentity(request), limit: 8, windowSeconds: 15 * 60 }),
      consumeRateLimit({ scope: "offer.request.contact", identifier: rateLimitSubject(contactKey), limit: 4, windowSeconds: 60 * 60 })
    ]);
    if (!ipLimit.allowed || !contactLimit.allowed) {
      const retryAfter = Math.max(ipLimit.retryAfter, contactLimit.retryAfter);
      emitStructuredLog("warn", "public_offer_rate_limited", { operation: "offer.request.create", status: 429, errorCode: "OFFER_RATE_LIMITED" });
      return NextResponse.json(
        { error: "Ai trimis prea multe solicitari. Reincearca mai tarziu." },
        { status: 429, headers: { ...noStoreHeaders, "Retry-After": String(retryAfter) } }
      );
    }
    const offerRequest = await createOfferRequest(input);
    return NextResponse.json({ request: offerRequest }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Solicitarea nu a putut fi trimisa." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}
