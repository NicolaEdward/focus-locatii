import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { createReservation, listReservations } from "@/lib/reservations";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["reservations.view", "reservations.view.own"]);
  if (response || !session) return response;

  const reservations = await listReservations({
    status: request.nextUrl.searchParams.get("status"),
    client: request.nextUrl.searchParams.get("client"),
    locationId: request.nextUrl.searchParams.get("locationId"),
    from: request.nextUrl.searchParams.get("from"),
    to: request.nextUrl.searchParams.get("to")
  }, session);

  return NextResponse.json({ reservations }, { headers: noStoreHeaders });
}

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["reservations.manage", "reservations.manage.own"]);
  if (response || !session) return response;

  try {
    const reservations = await createReservation(await request.json(), session);
    await recordAudit({
      actor: session,
      action: "reservation.create",
      entityType: "reservation",
      entityId: reservations[0]?.id,
      metadata: { groupId: reservations[0]?.contractGroupId, locationCount: reservations.length },
      request
    });
    return NextResponse.json(
      {
        reservation: reservations[0],
        reservations,
        groupId: reservations[0]?.contractGroupId || null
      },
      { status: 201, headers: noStoreHeaders }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rezervarea nu a putut fi salvata." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}
