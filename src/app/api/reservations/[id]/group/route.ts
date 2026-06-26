import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { updateReservationGroup } from "@/lib/reservations";

type Context = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["reservations.manage", "reservations.manage.own"]);
  if (response || !session) return response;

  const { id } = await context.params;

  try {
    const reservations = await updateReservationGroup(id, await request.json(), session);
    await recordAudit({
      actor: session,
      action: "reservation.group_update",
      entityType: "reservation",
      entityId: id,
      metadata: { updatedIds: reservations.map((reservation) => reservation.id), groupId: reservations[0]?.contractGroupId || null },
      request
    });
    return NextResponse.json({ reservation: reservations.find((item) => item.id === id) || reservations[0], reservations }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Contractul nu a putut fi actualizat." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}
