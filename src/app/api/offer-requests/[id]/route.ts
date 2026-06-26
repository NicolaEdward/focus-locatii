import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { softDeleteOfferRequest, updateOfferRequest } from "@/lib/offer-requests";
import { recordAudit } from "@/lib/audit";

type Context = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);

  try {
    const offerRequest = await updateOfferRequest(id, body, session);
    await recordAudit({
      actor: session,
      action: "lead.update",
      entityType: "offer_request",
      entityId: id,
      metadata: {
        status: body?.status,
        crmStatus: body?.crmStatus,
        salesperson: body?.salesperson
      },
      request
    });
    return NextResponse.json({ request: offerRequest });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Solicitarea nu a putut fi actualizata." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;

  const { id } = await context.params;
  const offerRequest = await softDeleteOfferRequest(id, session);
  await recordAudit({ actor: session, action: "lead.archive", entityType: "offer_request", entityId: id, request });
  return NextResponse.json({ request: offerRequest });
}
