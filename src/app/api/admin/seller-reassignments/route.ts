import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { listSellerUsers } from "@/lib/seller-users";
import { assignReservationsSeller } from "@/lib/reservations";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const genericSellerNames = new Set(["super_admin", "super admin", "admin", "administrator", "edward"]);

const bodySchema = z.object({
  reservationIds: z.array(z.string().min(1)).min(1),
  sellerUserId: z.string().min(1),
  reason: z.string().trim().max(500).optional()
});

export async function GET(request: NextRequest) {
  const { response } = await requireAnyPermission(request, ["reservations.manage", "users.manage"]);
  if (response) return response;

  // Manual admin correction endpoint only; the legacy "vanzari neclare" dashboard panel was retired.
  const [reservations, sellers] = await Promise.all([
    prisma.reservation.findMany({
      include: {
        sellerUser: { select: { id: true, name: true, email: true, role: true, active: true } },
        owner: { select: { id: true, name: true, email: true, role: true, active: true } },
        location: { select: { code: true, city: true, address: true } }
      },
      orderBy: [{ bookedAt: "desc" }, { createdAt: "desc" }],
      take: 800
    }),
    listSellerUsers()
  ]);

  const validSellerIds = new Set(sellers.map((seller) => seller.id));
  const invalid = reservations
    .filter((reservation) => {
      const seller = reservation.sellerUser || reservation.owner;
      const sellerName = normalizeSellerName(reservation.salesperson);
      return !seller ||
        !seller.active ||
        !validSellerIds.has(seller.id) ||
        !reservation.sellerUserId ||
        !reservation.salesperson ||
        genericSellerNames.has(sellerName) ||
        (reservation.salesperson && ![seller.name, seller.email].includes(reservation.salesperson));
    })
    .slice(0, 200)
    .map((reservation) => ({
      id: reservation.id,
      code: reservation.location.code,
      city: reservation.location.city,
      clientName: reservation.clientName,
      campaignName: reservation.campaignName,
      periodStart: reservation.periodStart.toISOString(),
      periodEnd: reservation.periodEnd.toISOString(),
      status: reservation.status,
      currentSellerName: reservation.salesperson,
      sellerUserId: reservation.sellerUserId,
      ownerId: reservation.ownerId,
      createdAt: reservation.createdAt.toISOString()
    }));

  return NextResponse.json({ reservations: invalid, sellers }, { headers: noStoreHeaders });
}

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["reservations.manage", "users.manage"]);
  if (response || !session) return response;
  if (!["COO", "SUPER_ADMIN"].includes(session.role)) {
    return NextResponse.json(
      { error: "Doar COO sau SUPER_ADMIN pot realoca vanzatorul." },
      { status: 403, headers: noStoreHeaders }
    );
  }

  try {
    const input = bodySchema.parse(await request.json());
    const before = await prisma.reservation.findMany({
      where: { id: { in: input.reservationIds } },
      select: { id: true, salesperson: true, sellerUserId: true, ownerId: true, clientName: true, campaignName: true }
    });
    if (!before.length) {
      return NextResponse.json({ error: "Nu exista inregistrari pentru realocare." }, { status: 404, headers: noStoreHeaders });
    }

    const updated = await assignReservationsSeller(input.reservationIds, input.sellerUserId, session);

    await recordAudit({
      actor: session,
      action: "seller.reassign_reservations",
      entityType: "reservation",
      metadata: {
        reservationIds: before.map((row) => row.id),
        from: before.map((row) => ({ id: row.id, salesperson: row.salesperson, sellerUserId: row.sellerUserId, ownerId: row.ownerId })),
        to: {
          sellerUserId: input.sellerUserId,
          salesperson: updated[0]?.salesperson || null
        },
        reason: input.reason || null
      },
      request
    });

    return NextResponse.json({ ok: true, updated: updated.length }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Realocarea nu a putut fi salvata." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

function normalizeSellerName(value: string | null) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}
