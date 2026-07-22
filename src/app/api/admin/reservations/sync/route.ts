import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";

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

  return NextResponse.json(
    {
      error: "Sincronizarea legacy a rezervarilor a fost retrasa. Foloseste fluxurile canonice de rezervare.",
      code: "LEGACY_RESERVATION_SYNC_RETIRED"
    },
    { status: 410, headers: noStoreHeaders }
  );
}
