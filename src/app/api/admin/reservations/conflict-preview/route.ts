import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission, type AuthSession } from "@/lib/auth";
import { hasAnyPermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { legacyManualBlockConflict, listLocationAvailabilityOverrideConflicts } from "@/lib/location-availability-overrides";

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
    if (periodEnd <= periodStart) {
      return NextResponse.json({ error: "Data de final trebuie sa fie dupa data de start." }, { status: 400, headers: noStoreHeaders });
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

    const [locations, conflicts, overrideConflicts] = await Promise.all([
      prisma.location.findMany({
        where: { id: { in: locationIds } },
        select: {
          id: true,
          code: true,
          status: true,
          blockedReason: true,
          blockedFrom: true,
          blockedUntil: true,
          availabilityText: true
        }
      }),
      prisma.reservation.findMany({
        where: {
          locationId: { in: locationIds },
          ...(currentReservation ? { id: { not: currentReservation.id } } : {}),
          status: { in: ["HOLD", "RESERVED", "BOOKED"] },
          periodStart: { lte: periodEnd },
          periodEnd: { gte: periodStart }
        },
        select: {
          id: true,
          locationId: true,
          status: true,
          clientName: true,
          campaignName: true,
          periodStart: true,
          periodEnd: true,
          location: { select: { code: true } }
        },
        orderBy: [{ periodStart: "asc" }]
      }),
      listLocationAvailabilityOverrideConflicts({
        locationIds,
        periodStart,
        periodEnd,
        session
      })
    ]);

    const warnings = locations.flatMap((location) => locationWarnings(location));
    const legacyBlockConflicts = locations.flatMap((location) => {
      const conflict = legacyManualBlockConflict(location, { periodStart, periodEnd });
      return conflict ? [conflict] : [];
    });

    return NextResponse.json({
      ok: true,
      checkedLocationIds: locationIds,
      conflicts: [
        ...conflicts.map((conflict) => ({
          reservationId: conflict.id,
          locationId: conflict.locationId,
          locationCode: conflict.location?.code || null,
          clientName: conflict.clientName || null,
          campaignName: conflict.campaignName || null,
          status: conflict.status,
          periodStart: conflict.periodStart.toISOString(),
          periodEnd: conflict.periodEnd.toISOString()
        })),
        ...overrideConflicts.map((conflict) => ({
          reservationId: conflict.reservationId,
          locationId: conflict.locationId,
          locationCode: locations.find((location) => location.id === conflict.locationId)?.code || null,
          clientName: null,
          campaignName: conflict.campaignName,
          status: conflict.status,
          periodStart: conflict.periodStart,
          periodEnd: conflict.periodEnd,
          openEnded: conflict.openEnded
        })),
        ...legacyBlockConflicts.map((conflict) => ({
          reservationId: conflict.reservationId,
          locationId: conflict.locationId,
          locationCode: locations.find((location) => location.id === conflict.locationId)?.code || null,
          clientName: null,
          campaignName: conflict.campaignName,
          status: conflict.status,
          periodStart: conflict.periodStart,
          periodEnd: conflict.periodEnd,
          openEnded: conflict.openEnded
        }))
      ],
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
    blockedReason: string | null;
    blockedFrom: Date | null;
    blockedUntil: Date | null;
    availabilityText: string | null;
  }
) {
  const warnings = [];
  if (location.status !== "AVAILABLE" && location.status !== "AVAILABLE_FROM") {
    warnings.push({
      locationId: location.id,
      locationCode: location.code,
      message: `Status inventar: ${location.status}. Verifica daca este corect pentru noua perioada.`
    });
  }
  if (location.availabilityText) {
    warnings.push({
      locationId: location.id,
      locationCode: location.code,
      message: `Nota disponibilitate: ${location.availabilityText}`
    });
  }
  return warnings;
}
