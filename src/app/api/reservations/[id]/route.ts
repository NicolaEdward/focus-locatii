import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission, requirePermission } from "@/lib/auth";
import { deleteReservation, getReservation, updateReservation, updateReservationGroupStatus } from "@/lib/reservations";
import { recordAudit } from "@/lib/audit";

type Context = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["reservations.view", "reservations.view.own"]);
  if (response || !session) return response;

  const { id } = await context.params;
  try {
    return NextResponse.json({ reservation: await getReservation(id, session) }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rezervarea nu a putut fi incarcata." },
      { status: 404, headers: noStoreHeaders }
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["reservations.manage", "reservations.manage.own"]);
  if (response || !session) return response;

  const { id } = await context.params;

  try {
    const body = await request.json();
    if (body?.applyToGroup === true && body?.status) {
      const reservations = await updateReservationGroupStatus(id, body.status, session, {
        cancellationReason: typeof body.cancellationReason === "string" ? body.cancellationReason : null
      });
      const reservation = reservations.find((item) => item.id === id) || reservations[0];
      await recordAudit({
        actor: session,
        action: "reservation.status",
        entityType: "reservation",
        entityId: id,
        metadata: { status: body.status, applyToGroup: true, hasCancellationReason: Boolean(body.cancellationReason) },
        request
      });
      return NextResponse.json({ reservation, reservations }, { headers: noStoreHeaders });
    }

    const reservation = await updateReservation(id, body, session);
    await recordAudit({ actor: session, action: "reservation.update", entityType: "reservation", entityId: id, metadata: { status: reservation.status }, request });
    return NextResponse.json({ reservation, reservations: [reservation] }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rezervarea nu a putut fi actualizata." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const { session, response } = await requirePermission(request, "reservations.manage");
  if (response || !session) return response;

  const { id } = await context.params;
  await deleteReservation(id);
  await recordAudit({ actor: session, action: "reservation.cancel", entityType: "reservation", entityId: id, request });

  return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
}
