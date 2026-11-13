import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import {
  createReservation,
  getReservationOccupancySummary,
  listReservations,
  listReservationWorkspace
} from "@/lib/reservations";
import { recordAudit } from "@/lib/audit";
import { emitStructuredLog, observeRoute, setObservabilityRole } from "@/lib/observability";
import { isClosedDatabaseConnection } from "@/lib/database-read-retry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["reservations.view", "reservations.view.own"]);
  if (response || !session) return response;

  const view = request.nextUrl.searchParams.get("view");
  if (view === "occupancy-summary") {
    return NextResponse.json({ summary: await getReservationOccupancySummary(session) }, { headers: noStoreHeaders });
  }

  const compactView = view === "summary" || view === "workspace";
  const filters = {
    status: request.nextUrl.searchParams.get("status"),
    client: request.nextUrl.searchParams.get("client"),
    locationId: request.nextUrl.searchParams.get("locationId"),
    from: request.nextUrl.searchParams.get("from"),
    to: request.nextUrl.searchParams.get("to")
  };
  const reservationsPromise = view === "workspace"
    ? listReservationWorkspace(filters, session)
    : listReservations(filters, session, { includeDetails: !compactView });
  const [reservations, summary] = await Promise.all([
    reservationsPromise,
    compactView ? getReservationOccupancySummary(session) : Promise.resolve(null)
  ]);

  return NextResponse.json({ reservations, ...(summary ? { summary } : {}) }, { headers: noStoreHeaders });
}

export async function POST(request: NextRequest) {
  return observeRoute(request, { route: "/api/reservations", operation: "reservation.create" }, async () => {
    const { session, response } = await requireAnyPermission(request, ["reservations.manage", "reservations.manage.own"]);
    if (response || !session) return response;
    setObservabilityRole(session.role);

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
      if (isClosedDatabaseConnection(error)) {
        emitStructuredLog("error", "reservation_database_connection_closed", { errorCode: "P1017" });
        return NextResponse.json(
          {
            error: "Conexiunea cu baza de date a fost intrerupta. Verifica lista rezervarilor inainte de a incerca din nou.",
            code: "RESERVATION_DATABASE_CONNECTION_CLOSED"
          },
          { status: 503, headers: noStoreHeaders }
        );
      }
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Rezervarea nu a putut fi salvata." },
        { status: error instanceof Error && "status" in error && error.status === 403 ? 403 : 400, headers: noStoreHeaders }
      );
    }
  });
}
