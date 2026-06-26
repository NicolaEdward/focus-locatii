import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission, type AuthSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { hasAnyPermission, hasPermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  assignReservationSeller,
  extendReservationHold,
  markReservationHoldLost,
  releaseReservationHold,
  updateReservation,
  updateReservationGroupStatus
} from "@/lib/reservations";
import { withOperationStatus, withOperationTaskStatus, type OperationKind, type OperationStatus } from "@/lib/operation-status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const actionSchema = z.object({
  action: z.enum([
    "extendHold",
    "confirmBooking",
    "releaseHold",
    "markLost",
    "assignSeller",
    "changePeriod",
    "approveException",
    "markResolved",
    "createTask",
  "operationStatus"
  ]),
  reservationId: z.string().min(1),
  seller: z.string().trim().max(160).optional(),
  sellerUserId: z.string().trim().min(1).optional(),
  periodStart: z.string().trim().optional(),
  periodEnd: z.string().trim().optional(),
  days: z.number().int().min(1).max(30).optional(),
  kind: z.enum(["decoration", "neutralization"]).optional(),
  status: z.enum(["NEW", "IN_PROGRESS", "DONE", "ARCHIVED"]).optional(),
  taskId: z.string().trim().min(1).optional(),
  note: z.string().trim().max(1000).optional()
});

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["reservations.manage", "reservations.manage.own", "campaigns.operate"]);
  if (response || !session) return response;

  try {
    const input = actionSchema.parse(await request.json());
    const canManageReservations = hasPermission(session.role, "reservations.manage");
    const canManageOwnReservations = hasPermission(session.role, "reservations.manage.own");
    if (reservationAction(input.action) && !canManageReservations && !(canManageOwnReservations && ownReservationAction(input.action))) {
      return NextResponse.json({ error: "Nu ai dreptul sa modifici rezervari." }, { status: 403, headers: noStoreHeaders });
    }
    if (operationAction(input.action) && !hasPermission(session.role, "campaigns.operate")) {
      return NextResponse.json({ error: "Nu ai dreptul sa modifici operatiuni." }, { status: 403, headers: noStoreHeaders });
    }
    if (input.action === "assignSeller" && !["COO", "SUPER_ADMIN"].includes(session.role)) {
      return NextResponse.json({ error: "Doar COO sau SUPER_ADMIN pot realoca vanzatorul." }, { status: 403, headers: noStoreHeaders });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: input.reservationId },
      select: { id: true, contractGroupId: true, productionNotes: true, notes: true, ownerId: true, sellerUserId: true, salesperson: true, status: true }
    });
    if (!reservation) {
      return NextResponse.json({ error: "Rezervarea nu exista." }, { status: 404, headers: noStoreHeaders });
    }

    const where = reservation.contractGroupId ? { contractGroupId: reservation.contractGroupId } : { id: reservation.id };
    if (!canManageReservations && ownReservationAction(input.action)) {
      const targets = await prisma.reservation.findMany({
        where,
        select: { id: true, ownerId: true, sellerUserId: true, salesperson: true, status: true }
      });
      assertOwnHoldTargets(targets, session);
    }

    let result: unknown = null;

    if (input.action === "confirmBooking") {
      result = await updateReservationGroupStatus(reservation.id, "BOOKED", session);
    } else if (input.action === "releaseHold") {
      result = await releaseReservationHold(reservation.id, session);
    } else if (input.action === "markLost") {
      result = await markReservationHoldLost(reservation.id, input.note, session);
    } else if (input.action === "extendHold") {
      result = await extendReservationHold(reservation.id, input.days || 5, session);
    } else if (input.action === "assignSeller") {
      if (!input.sellerUserId) throw new Error("Alege vanzatorul responsabil din lista.");
      result = await assignReservationSeller(reservation.id, input.sellerUserId, session);
    } else if (input.action === "changePeriod") {
      if (!input.periodStart || !input.periodEnd) throw new Error("Completeaza perioada noua.");
      result = await updateReservation(reservation.id, { periodStart: input.periodStart, periodEnd: input.periodEnd }, session);
    } else if (input.action === "approveException" || input.action === "markResolved") {
      await prisma.reservation.updateMany({
        where,
        data: {
          productionNotes: appendNote(
            reservation.productionNotes,
            `${input.action === "approveException" ? "Exceptie aprobata" : "Problema marcata rezolvata"} de ${session.name}: ${input.note || "fara observatii"}`
          )
        }
      });
      result = await refreshedReservations(where);
    } else if (input.action === "createTask" || input.action === "operationStatus") {
      const kind = input.kind || "decoration";
      const status = input.status || "NEW";
      result = await updateReservation(reservation.id, {
        productionNotes: input.taskId
          ? withOperationTaskStatus(reservation.productionNotes, input.taskId, status as OperationStatus)
          : withOperationStatus(
              appendNote(reservation.productionNotes, input.action === "createTask" ? input.note || "Task creat din command center." : undefined),
              kind as OperationKind,
              status as OperationStatus
            )
      }, session);
    }

    await recordAudit({
      actor: session,
      action: `command_center.${input.action}`,
      entityType: "reservation",
      entityId: input.reservationId,
      metadata: input,
      request
    });

    return NextResponse.json({ ok: true, result }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Actiunea nu a putut fi executata." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

function reservationAction(action: string) {
  return ["extendHold", "confirmBooking", "releaseHold", "markLost", "assignSeller", "changePeriod", "approveException", "markResolved"].includes(action);
}

function ownReservationAction(action: string) {
  return ["extendHold", "confirmBooking", "releaseHold", "markLost", "changePeriod"].includes(action);
}

function operationAction(action: string) {
  return ["createTask", "operationStatus"].includes(action);
}

function assertOwnHoldTargets(
  reservations: Array<{ id: string; ownerId: string | null; sellerUserId: string | null; salesperson: string | null; status: string }>,
  session: AuthSession
) {
  if (!reservations.length) {
    throw new Error("Rezervarea nu exista.");
  }
  if (reservations.some((reservation) => !isOwnReservation(reservation, session))) {
    throw new Error("Poti modifica doar holdurile proprii.");
  }
  if (reservations.some((reservation) => !["HOLD", "RESERVED"].includes(reservation.status))) {
    throw new Error("Actiunea rapida este disponibila doar pentru holduri.");
  }
}

function isOwnReservation(
  reservation: { ownerId: string | null; sellerUserId: string | null; salesperson: string | null },
  session: AuthSession
) {
  if (hasAnyPermission(session.role, ["reservations.manage"])) return true;
  const legacyOwner = [session.name, session.email].includes(reservation.salesperson || "");
  return reservation.sellerUserId === session.id || reservation.ownerId === session.id || (!reservation.ownerId && legacyOwner);
}

async function refreshedReservations(where: { id: string } | { contractGroupId: string }) {
  return prisma.reservation.findMany({
    where,
    include: { location: { select: { code: true, address: true, city: true, type: true } } },
    orderBy: [{ createdAt: "asc" }]
  });
}

function appendNote(current: string | null | undefined, note?: string) {
  if (!note) return current || null;
  const line = `[${new Date().toISOString().slice(0, 10)}] ${note}`;
  return current ? `${current}\n${line}` : line;
}
