import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { syncLegacyReservations } from "@/lib/legacy-reservations-sync";
import { listReservations } from "@/lib/reservations";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function POST(request: NextRequest) {
  const { session, response } = await requirePermission(request, "reservations.manage");
  if (response || !session) return response;
  if (!["COO", "SUPER_ADMIN"].includes(session.role)) {
    return NextResponse.json(
      { error: "Doar COO sau SUPER_ADMIN pot rula sincronizarea legacy." },
      { status: 403, headers: noStoreHeaders }
    );
  }

  try {
    const summary = await syncLegacyReservations();
    const reservations = (await listReservations({}, session)).filter((reservation) =>
      summary.disabled ? ["HOLD", "RESERVED", "BOOKED"].includes(reservation.status) : true
    );
    await recordAudit({ actor: session, action: "reservations.sync", entityType: "reservation", metadata: summary, request });

    return NextResponse.json({ summary, reservations }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sincronizarea nu a putut fi rulata." },
      { status: 500, headers: noStoreHeaders }
    );
  }
}
