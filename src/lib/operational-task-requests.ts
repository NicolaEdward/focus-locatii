import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canCompleteOperationalReservation } from "@/lib/operational-proof";
import { bridgeReservationSelect, findOrCreateTaskForLegacyExtraTask, isOperationTaskBridgeUnavailable } from "@/lib/operation-task-bridge";
import { operationExtraTasks, withOperationTask, type OperationExtraTask, type OperationKind } from "@/lib/operation-status";
import { getReservation, updateReservationProductionNotesWithClient } from "@/lib/reservations";
import { recordTransactionalAudit } from "@/lib/transactional-audit";
import { emitStructuredLog } from "@/lib/observability";

function invalid(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }

export function normalizeOperationalTaskRequest(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const kind: OperationKind = input.kind === "decoration" || input.kind === "neutralization" ? input.kind : invalid("Tip operațional invalid.");
  const taskType = text(input.taskType, 50) || (kind === "decoration" ? "redecoration" : "neutralization");
  if (kind === "decoration" ? !["initial", "redecoration"].includes(taskType) : taskType !== "neutralization") invalid("Tipul sarcinii nu corespunde operației.");
  const dateText = text(input.requestedDate || input.taskDate, 80);
  const date = dateText ? new Date(dateText) : null;
  if (!date || !Number.isFinite(date.getTime()) || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(dateText!) || date.toISOString().slice(0, 10) !== dateText!.slice(0, 10)) invalid("Data solicitată pentru sarcină nu este validă.");
  const rawCost = input.cost == null ? "" : String(input.cost).trim();
  const cost = rawCost ? Number(rawCost.replace(",", ".")) : null;
  if (cost != null && (!Number.isFinite(cost) || cost < 0 || cost > 999_999_999_999.99 || Math.round(cost * 100) / 100 !== cost)) invalid("Costul trebuie să fie o sumă pozitivă sau zero, cu cel mult două zecimale. Lasă câmpul gol dacă valoarea nu este verificată.");
  const currency = text(input.currency, 3)?.toUpperCase() || null;
  if ((currency && !["RON", "EUR"].includes(currency)) || (cost != null && !currency)) invalid("Alege moneda verificată RON sau EUR pentru costul introdus.");
  const taskId = text(input.taskId, 191);
  if (!taskId) invalid("Lipsește identificatorul stabil al solicitării. Reîncarcă formularul înainte de a crea lucrarea.", 428);
  if (!/^[A-Za-z0-9_-]+$/.test(taskId)) invalid("Identificatorul sarcinii nu este valid.");
  const briefUrl = text(input.briefUrl, 2048);
  if (briefUrl) {
    let url: URL;
    try { url = new URL(briefUrl); } catch { return invalid("Linkul brief-ului nu este valid."); }
    if (!["http:", "https:"].includes(url.protocol)) invalid("Linkul brief-ului trebuie să folosească HTTP sau HTTPS.");
  }
  return { taskId, kind, taskType, requestedDate: date.toISOString(), cost, currency, costOwner: text(input.costOwner, 100), note: text(input.note, 4000), briefUrl };
}

/** One locked, audited task request per actor, rental and stable intent ID. */
export async function createOperationalTaskRequest(reservationId: string, value: unknown, actor: AuthSession) {
  const input = normalizeOperationalTaskRequest(value);
  const requestFingerprint = createHash("sha256").update(JSON.stringify({ reservationId, actorId: actor.id, ...input })).digest("hex");
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM portfolio_users WHERE id = ${actor.id} FOR UPDATE`;
    const currentActor = await tx.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true, tokenVersion: true } });
    if (!currentActor?.active || currentActor.role !== actor.role || currentActor.tokenVersion !== actor.tokenVersion || !["SUPER_ADMIN", "COO", "SALES_DIRECTOR", "SALES_AGENT"].includes(currentActor.role)) invalid("Contul sau permisiunile s-au schimbat. Autentifică-te din nou.", 403);
    await tx.$queryRaw`SELECT id FROM portfolio_reservations WHERE id = ${reservationId} FOR UPDATE`;
    const existing = await tx.reservation.findUnique({ where: { id: reservationId }, select: {
      ...bridgeReservationSelect, ownerId: true, sellerUserId: true, salesperson: true, client: { select: { accountOwnerUserId: true } }
    } });
    if (!existing) invalid("Închirierea nu există.", 404);
    // Replay is still authorized against the current portfolio, even after the
    // task is complete or the rental is later cancelled. It has no new effect.
    if (!canCompleteOperationalReservation(actor, { ...existing, status: "BOOKED" })) invalid("Poți solicita lucrări numai pentru închirierile proprii.", 403);
    const matches = operationExtraTasks(existing.productionNotes).filter((task) => task.id === input.taskId);
    if (matches.length) {
      if (matches.length !== 1 || matches[0].createdByUserId !== actor.id || matches[0].requestFingerprint !== requestFingerprint) invalid("Identificatorul aparține altei solicitări sau datele au fost schimbate. Verifică lucrarea existentă înainte de o solicitare nouă.", 409);
      return { task: matches[0], duplicate: true };
    }
    if (existing.status !== "BOOKED") invalid("Poți solicita redecorări numai pentru închirieri confirmate.");
    const task: OperationExtraTask = {
      id: input.taskId, kind: input.kind, status: "NEW", taskType: input.taskType, taskDate: input.requestedDate,
      requestedDate: input.requestedDate, cost: input.cost, currency: input.currency, costOwner: input.costOwner,
      note: input.note, briefUrl: input.briefUrl, createdByUserId: actor.id, createdByName: actor.name,
      createdAt: new Date().toISOString(), requestFingerprint
    };
    let nextNotes = withOperationTask(existing.productionNotes, task);
    if (["1", "true", "yes"].includes(String(process.env.OPERATION_TASKS_ENABLED || "").toLowerCase())) {
      try {
        const bridged = await findOrCreateTaskForLegacyExtraTask(existing, task, tx);
        if (bridged) nextNotes = bridged.mirroredNotes || nextNotes;
      } catch (error) {
        if (!isOperationTaskBridgeUnavailable(error)) throw error;
        emitStructuredLog("warn", "operation_task_bridge_unavailable", { operation: "operation.task.request", entityType: "reservation", entityId: reservationId, errorCode: "OPERATION_TASK_TABLE_UNAVAILABLE" });
      }
    }
    await updateReservationProductionNotesWithClient(tx, reservationId, nextNotes, actor);
    await recordTransactionalAudit(tx, { actor, action: `operation.${input.kind}.create_task`, entityType: "reservation", entityId: reservationId, metadata: { taskId: input.taskId, requestFingerprint, costKnown: input.cost != null, currency: input.currency } });
    return { task, duplicate: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 15000 });
  return { ...result, reservation: await getReservation(reservationId, actor) };
}

function text(value: unknown, max: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") invalid("Un câmp text al solicitării nu este valid.");
  const result = value.trim();
  if (result.length > max) invalid("Un câmp al solicitării este prea lung.");
  return result || null;
}
