import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { serializeLocation } from "@/lib/locations";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import type { AuthSession } from "@/lib/auth";

type Context = {
  params: Promise<{ id: string }>;
};

const activeTimelineStatuses = ["HOLD", "RESERVED", "BOOKED"] as const;

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requirePermission(request, "inventory.view");
  if (response || !session) return response;

  const { id } = await context.params;
  const today = startOfUtcDay(new Date());

  const location = await prisma.location.findUnique({
    where: { id },
    include: {
      category: true,
      images: {
        orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }]
      },
      reservations: {
        where: {
          status: { in: [...activeTimelineStatuses] },
          periodEnd: { gte: today }
        },
        orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }]
      }
    }
  });

  if (!location) {
    return NextResponse.json({ error: "Locatia nu exista." }, { status: 404, headers: noStoreHeaders });
  }

  const reservations = await prisma.reservation.findMany({
    where: {
      locationId: id,
      status: { in: [...activeTimelineStatuses] },
      periodEnd: { gte: today }
    },
    include: {
      sellerUser: { select: { id: true, name: true, email: true } },
      client: { select: { id: true, companyName: true } },
      campaign: { select: { id: true, campaignName: true, campaignCode: true } }
    },
    orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }, { createdAt: "desc" }]
  });

  const periods = reservations
    .map((reservation) => serializeTimelinePeriod(reservation, session, today, reservations))
    .sort((left, right) => {
      if (left.isActiveToday !== right.isActiveToday) return left.isActiveToday ? -1 : 1;
      return new Date(left.periodStart).getTime() - new Date(right.periodStart).getTime();
    });

  const canViewInternalDetails = hasPermission(session.role, "inventory.manage");

  return NextResponse.json({
    location: serializeLocation(location, { includeHiddenCommercials: false, includePrivateFields: false }),
    admin: {
      publicVisibility: {
        showInPublic: location.showInPublic,
        showPricePublic: location.showPricePublic,
        showInstallationCostPublic: location.showInstallationCostPublic
      },
      commercial: {
        status: location.status,
        availabilityText: location.availabilityText,
        availableFrom: location.availableFrom?.toISOString() || null,
        availableUntil: location.availableUntil?.toISOString() || null,
        bookedFrom: location.bookedFrom?.toISOString() || null,
        bookedUntil: location.bookedUntil?.toISOString() || null,
        rateCard: location.rateCard,
        rateCardValue: location.rateCardValue,
        installationRemoval: location.installationRemoval,
        installationRemovalValue: location.installationRemovalValue
      },
      internal: canViewInternalDetails
        ? {
            internalNotes: location.internalNotes,
            monthlyCost: location.monthlyCost,
            costCurrency: location.costCurrency,
            costType: location.costType,
            costSupplier: location.costSupplier,
            costNotes: location.costNotes,
            blockedReason: location.blockedReason,
            blockedFrom: location.blockedFrom?.toISOString() || null,
            blockedUntil: location.blockedUntil?.toISOString() || null,
            blockedNotes: location.blockedNotes,
            latReal: location.latReal,
            lngReal: location.lngReal,
            mapsUrl: location.mapsUrl,
            gpsAuditStatus: location.gpsAuditStatus
          }
        : null
    },
    timeline: {
      generatedAt: new Date().toISOString(),
      periods,
      empty: periods.length === 0
    },
    permissions: {
      canViewInternalDetails,
      canViewFullReservationDetails: ["SALES_DIRECTOR", "COO", "SUPER_ADMIN"].includes(session.role)
    }
  }, { headers: noStoreHeaders });
}

function serializeTimelinePeriod(
  reservation: ReservationTimelineRow,
  session: AuthSession,
  today: Date,
  allRows: ReservationTimelineRow[]
) {
  const canViewDetails = canViewReservationDetails(session, reservation);
  const conflicts = allRows.filter((row) =>
    row.id !== reservation.id &&
    row.periodStart <= reservation.periodEnd &&
    row.periodEnd >= reservation.periodStart
  );

  return {
    id: reservation.id,
    locationId: reservation.locationId,
    status: reservation.status,
    periodStart: reservation.periodStart.toISOString(),
    periodEnd: reservation.periodEnd.toISOString(),
    isActiveToday: reservation.periodStart <= today && reservation.periodEnd >= today,
    clientId: canViewDetails ? reservation.clientId : null,
    clientName: canViewDetails ? reservation.client?.companyName || reservation.clientCompany || reservation.clientName : null,
    campaignId: canViewDetails ? reservation.campaignId : null,
    campaignName: canViewDetails ? reservation.campaign?.campaignName || reservation.campaignName : null,
    campaignCode: canViewDetails ? reservation.campaign?.campaignCode || null : null,
    sellerId: canViewDetails ? reservation.sellerUserId || reservation.ownerId : null,
    sellerName: canViewDetails ? reservation.sellerUser?.name || reservation.salesperson : null,
    contractCompany: canViewDetails ? reservation.contractCompany : null,
    contractNumber: canViewDetails ? reservation.contractNumber : null,
    holdExpiresAt: reservation.holdExpiresAt?.toISOString() || null,
    conflict: conflicts.length > 0,
    conflictReservationIds: conflicts.map((row) => row.id)
  };
}

function canViewReservationDetails(session: AuthSession, reservation: ReservationTimelineRow) {
  if (["SALES_DIRECTOR", "COO", "SUPER_ADMIN"].includes(session.role)) return true;
  if (session.role !== "SALES_AGENT") return false;
  return (
    reservation.sellerUserId === session.id ||
    reservation.ownerId === session.id ||
    (!reservation.ownerId && !reservation.sellerUserId && [session.name, session.email].includes(reservation.salesperson || ""))
  );
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

type ReservationTimelineRow = Awaited<ReturnType<typeof prisma.reservation.findMany>>[number] & {
  sellerUser?: { id: string; name: string; email: string } | null;
  client?: { id: string; companyName: string } | null;
  campaign?: { id: string; campaignName: string; campaignCode: string | null } | null;
};
