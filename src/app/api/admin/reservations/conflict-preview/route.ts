import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission, type AuthSession } from "@/lib/auth";
import { hasAnyPermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { loadAvailabilityDecisions } from "@/lib/availability-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const previewSchema = z.object({
  reservationId: z.string().trim().min(1).optional(),
  locationIds: z.array(z.string().trim().min(1)).max(100).optional(),
  periodStart: z.string().trim().min(1),
  periodEnd: z.string().trim().min(1)
});

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, [
    "reservations.view",
    "reservations.view.own",
    "reservations.manage",
    "reservations.manage.own"
  ]);
  if (response || !session) return response;

  try {
    const input = previewSchema.parse(await request.json());
    const periodStart = parseDate(input.periodStart);
    const periodEnd = parseDate(input.periodEnd);
    if (!periodStart || !periodEnd) {
      return NextResponse.json({ error: "Datele nu sunt valide." }, { status: 400, headers: noStoreHeaders });
    }
    if (periodEnd < periodStart) {
      return NextResponse.json({ error: "Data de final nu poate fi inainte de data de start." }, { status: 400, headers: noStoreHeaders });
    }

    const canViewAll = hasAnyPermission(session.role, ["reservations.view", "reservations.manage"]);
    const currentReservation = input.reservationId
      ? await prisma.reservation.findUnique({
          where: { id: input.reservationId },
          select: {
            id: true,
            locationId: true,
            ownerId: true,
            sellerUserId: true,
            salesperson: true
          }
        })
      : null;

    if (input.reservationId && !currentReservation) {
      return NextResponse.json({ error: "Rezervarea nu exista." }, { status: 404, headers: noStoreHeaders });
    }
    if (!canViewAll && (!currentReservation || !isOwnReservation(currentReservation, session))) {
      return NextResponse.json({ error: "Poti verifica doar rezervarile proprii." }, { status: 403, headers: noStoreHeaders });
    }

    const locationIds = unique(input.locationIds?.length ? input.locationIds : currentReservation ? [currentReservation.locationId] : []);
    if (!locationIds.length) {
      return NextResponse.json({ error: "Alege cel putin o locatie pentru verificare." }, { status: 400, headers: noStoreHeaders });
    }

    const batch = await loadAvailabilityDecisions({
      locationIds,
      periodStart,
      periodEnd,
      ignoreReservationId: currentReservation?.id || null
    });
    const locations = [...batch.locationsById.values()];
    const warnings = locations.flatMap((location) => locationWarnings(location));
    const conflicts = locations.flatMap((location) => {
      const decision = batch.decisionsByLocationId[location.id];
      if (!decision) return [];
      const rows = decision.conflictingIntervals.map((interval, index) => {
        const reservation = interval.sourceId ? batch.reservationsById.get(interval.sourceId) : null;
        const canViewReservationDetails = Boolean(reservation && (canViewAll || isOwnReservation(reservation, session)));
        return {
          reservationId: interval.sourceId || `${interval.source.toLowerCase()}:${location.id}:${index}`,
          locationId: location.id,
          locationCode: location.code,
          clientName: canViewReservationDetails ? reservation?.clientName || null : null,
          campaignName: canViewReservationDetails ? reservation?.campaignName || null : interval.source === "RESERVATION" ? null : interval.reason || null,
          status: interval.status,
          periodStart: interval.from.toISOString(),
          periodEnd: interval.to.toISOString(),
          holdExpiresAt: interval.holdExpiresAt?.toISOString() || null,
          openEnded: interval.openEnded
        };
      });
      if (rows.length || decision.isBookable) return rows;
      return [{
        reservationId: `lifecycle:${location.id}`,
        locationId: location.id,
        locationCode: location.code,
        clientName: null,
        campaignName: null,
        status: location.lifecycleStatus,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        holdExpiresAt: null,
        openEnded: false
      }];
    });

    return NextResponse.json({
      ok: true,
      checkedLocationIds: locationIds,
      conflicts,
      warnings
    }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Disponibilitatea nu a putut fi verificata." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

function parseDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isOwnReservation(
  reservation: { ownerId: string | null; sellerUserId: string | null; salesperson: string | null },
  session: AuthSession
) {
  const legacyOwner = [session.name, session.email].includes(reservation.salesperson || "");
  return reservation.sellerUserId === session.id || reservation.ownerId === session.id || (!reservation.ownerId && legacyOwner);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function locationWarnings(
  location: {
    id: string;
    code: string;
    status: string;
    availabilityText: string | null;
  }
) {
  const warnings = [];
  if (location.availabilityText) {
    warnings.push({
      locationId: location.id,
      locationCode: location.code,
      message: `Nota disponibilitate: ${location.availabilityText}`
    });
  }
  return warnings;
}
