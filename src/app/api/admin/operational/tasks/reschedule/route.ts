import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { withOperationDelayChange, type OperationKind } from "@/lib/operation-status";
import { canRescheduleOperationalReservation } from "@/lib/operational-proof";
import { prisma } from "@/lib/prisma";
import { updateReservation, updateReservationProductionNotes } from "@/lib/reservations";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const allowedKinds = new Set(["decoration", "neutralization"]);

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, [
    "dashboard.operations.view",
    "campaigns.operate",
    "reservations.view.own",
    "reservations.manage",
    "reservations.manage.own"
  ]);
  if (response || !session) return response;

  try {
    const body = await request.json().catch(() => null);
    const reservationId = textValue(body?.reservationId);
    const kind = textValue(body?.kind);
    const taskId = textValue(body?.taskId);
    const newDateText = textValue(body?.newStartDate);
    const reason = textValue(body?.reason);
    const note = textValue(body?.note);
    const confirmed = body?.confirmed === true;

    if (!reservationId) {
      return NextResponse.json({ error: "Alege lucrarea operationala." }, { status: 400, headers: noStoreHeaders });
    }
    if (!kind || !allowedKinds.has(kind)) {
      return NextResponse.json({ error: "Tip operational invalid." }, { status: 400, headers: noStoreHeaders });
    }
    if (!reason) {
      return NextResponse.json({ error: "Motivul intarzierii este obligatoriu." }, { status: 400, headers: noStoreHeaders });
    }
    if (!confirmed) {
      return NextResponse.json({ error: "Confirma impactul asupra perioadei si pro-rata." }, { status: 400, headers: noStoreHeaders });
    }

    const newDate = parseDateOnly(newDateText);
    if (!newDate) {
      return NextResponse.json({ error: "Data noua nu este valida." }, { status: 400, headers: noStoreHeaders });
    }

    const existing = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        installationDate: true,
        neutralizationDate: true,
        productionNotes: true,
        ownerId: true,
        sellerUserId: true,
        salesperson: true,
        client: { select: { accountOwnerUserId: true } },
        billingItems: { select: { id: true }, take: 1 }
      }
    });

    if (!existing) {
      return NextResponse.json({ error: "Lucrarea nu exista." }, { status: 404, headers: noStoreHeaders });
    }
    if (!canRescheduleOperationalReservation(session, existing)) {
      return NextResponse.json({ error: "Nu ai acces sa reprogramezi aceasta lucrare." }, { status: 403, headers: noStoreHeaders });
    }
    if (!["COO", "SUPER_ADMIN"].includes(session.role) && newDate < startOfUtcDay(existing.periodStart)) {
      return NextResponse.json(
        { error: "Doar COO sau administratorul pot muta startul mai devreme decat data curenta a campaniei." },
        { status: 400, headers: noStoreHeaders }
      );
    }
    if (kind === "decoration" && newDate > startOfUtcDay(existing.periodEnd)) {
      return NextResponse.json(
        { error: "Noua data de start nu poate fi dupa finalul campaniei." },
        { status: 400, headers: noStoreHeaders }
      );
    }

    const oldTaskDate =
      kind === "decoration"
        ? existing.installationDate || existing.periodStart
        : existing.neutralizationDate || existing.periodEnd;
    const patch =
      kind === "decoration"
        ? { periodStart: formatDateInput(newDate), installationDate: formatDateInput(newDate) }
        : { neutralizationDate: formatDateInput(newDate) };
    const updated = await updateReservation(reservationId, patch, session);
    const nextNotes = withOperationDelayChange(updated.productionNotes, {
      id: randomUUID(),
      kind: kind as OperationKind,
      taskId,
      oldStartDate: existing.periodStart.toISOString(),
      newStartDate: kind === "decoration" ? `${formatDateInput(newDate)}T00:00:00.000Z` : updated.periodStart,
      oldTaskDate: oldTaskDate.toISOString(),
      newTaskDate: `${formatDateInput(newDate)}T00:00:00.000Z`,
      reason,
      note,
      changedByUserId: session.id,
      financeReviewRequired: existing.billingItems.length > 0
    });
    const reservation = await updateReservationProductionNotes(reservationId, nextNotes, session);

    await recordAudit({
      actor: session,
      action: "operation.delay.reschedule",
      entityType: "reservation",
      entityId: reservationId,
      metadata: {
        kind,
        taskId,
        oldStartDate: existing.periodStart.toISOString(),
        newStartDate: kind === "decoration" ? `${formatDateInput(newDate)}T00:00:00.000Z` : updated.periodStart,
        oldTaskDate: oldTaskDate.toISOString(),
        newTaskDate: `${formatDateInput(newDate)}T00:00:00.000Z`,
        reason,
        financeReviewRequired: existing.billingItems.length > 0,
        source: "OPERATIONAL_DELAY_CHANGE"
      },
      request
    });

    return NextResponse.json(
      {
        reservation,
        financeReviewRequired: existing.billingItems.length > 0
      },
      { headers: noStoreHeaders }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Data operationala nu a putut fi modificata." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

function textValue(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function parseDateOnly(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}
