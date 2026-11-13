import type { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { reservationDetailsWhere } from "@/lib/reservation-read-access";
import { buildDecorationBillingReport, type DecorationBillingTaskLike } from "@/lib/decoration-billing";
import { operationCost, operationExtraTasks, operationStatus, operationUpdatedAt } from "@/lib/operation-status";

export type ExecutionHistoryPage = Awaited<ReturnType<typeof listOperationalExecutionHistory>>;
const MAX_TASKS_PER_RESERVATION = 100;

/** This register preserves execution evidence. It cannot issue or approve an invoice. */
export async function listOperationalExecutionHistory(session: AuthSession, input: { month: string; after?: string | null; pageSize?: number }) {
  if (!["SUPER_ADMIN", "COO", "D_CEO", "SALES_DIRECTOR", "SALES_AGENT"].includes(session.role)) {
    throw Object.assign(new Error("Nu ai acces la registrul execuțiilor comerciale."), { status: 403 });
  }
  const match = input.month.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match || Number(match[1]) < 2000 || Number(match[1]) > 9998 || (input.after && input.after.length > 191)) {
    throw Object.assign(new Error("Alege o lună validă pentru registrul execuțiilor."), { status: 400 });
  }
  const pageSize = Math.min(50, Math.max(1, Math.floor(input.pageSize || 20)));
  if (!Number.isFinite(pageSize)) throw Object.assign(new Error("Pagina solicitată nu este validă."), { status: 400 });
  const from = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  const to = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
  const completionWhere: Prisma.OperationTaskWhereInput = {
    kind: { in: ["DECORATION", "REDECORATION"] }, status: "DONE",
    OR: [{ completedAt: { gte: from, lt: to } }, { completedAt: null, scheduledFor: { gte: from, lt: to } }]
  };
  const rows = await prisma.reservation.findMany({
    where: { AND: [
      reservationDetailsWhere(session),
      ...(input.after ? [{ id: { gt: input.after } }] : []),
      // Legacy completion dates live inside metadata. Page its candidates rather
      // than assuming the rental's period equals the physical execution month.
      { OR: [{ operationTasks: { some: completionWhere } }, { productionNotes: { contains: '"DONE"' } }] }
    ] },
    select: {
      id: true, status: true, locationId: true, clientName: true, campaignName: true, campaignId: true, contractNumber: true,
      periodStart: true, installationDate: true, productionNotes: true,
      location: { select: { code: true, address: true } },
      operationTasks: { where: completionWhere, select: {
        id: true, kind: true, status: true, legacyTaskId: true, scheduledFor: true, completedAt: true, cost: true, currency: true
      }, orderBy: { id: "asc" }, take: MAX_TASKS_PER_RESERVATION + 1 }
    },
    orderBy: { id: "asc" }, take: pageSize + 1
  });
  const visible = rows.slice(0, pageSize);
  let limitedTaskGroups = 0;
  const tasks: DecorationBillingTaskLike[] = [];
  for (const row of visible) {
    const reservation = {
      id: row.id, status: row.status, clientName: row.clientName, campaignName: row.campaignName, campaignId: row.campaignId,
      contractNumber: row.contractNumber, locationId: row.locationId, locationCode: row.location.code, locationName: row.location.address
    };
    const baseStatus = operationStatus(row.productionNotes, "decoration");
    const baseCost = operationCost(row.productionNotes, "decoration");
    tasks.push({
      reservation, operationStatus: baseStatus, taskType: "initial", taskDate: (row.installationDate || row.periodStart).toISOString(),
      finalizationDate: operationUpdatedAt(row.productionNotes, "decoration"), cost: baseCost.cost, currency: baseCost.currency,
      dedupeKey: `reservation:${row.id}:DECORATION:base`
    });
    const extraTasks = operationExtraTasks(row.productionNotes, "decoration");
    if (extraTasks.length > MAX_TASKS_PER_RESERVATION || row.operationTasks.length > MAX_TASKS_PER_RESERVATION) limitedTaskGroups++;
    for (const task of extraTasks.slice(0, MAX_TASKS_PER_RESERVATION)) tasks.push({
      reservation, operationStatus: task.status, taskId: task.id, taskType: task.taskType, taskDate: task.taskDate,
      finalizationDate: task.completedAt || task.updatedAt, cost: task.cost, currency: task.currency,
      dedupeKey: `reservation:${row.id}:task:${task.id}`
    });
    // Relational records override their legacy mirrors, including explicit null
    // currency. A copied rental currency must never fill an unknown supplier cost.
    for (const task of row.operationTasks.slice(0, MAX_TASKS_PER_RESERVATION)) tasks.push({
      reservation, operationStatus: task.status, taskId: task.legacyTaskId || (task.kind === "REDECORATION" ? task.id : null),
      taskType: task.kind === "REDECORATION" ? "redecoration" : "initial", taskDate: task.scheduledFor?.toISOString(),
      finalizationDate: task.completedAt?.toISOString(), cost: task.cost?.toNumber() ?? null, currency: task.currency,
      dedupeKey: task.legacyTaskId ? `reservation:${row.id}:task:${task.legacyTaskId}` : task.kind === "DECORATION"
        ? `reservation:${row.id}:DECORATION:base` : `reservation:${row.id}:task:${task.id}`
    });
  }
  const canonicalTasks = new Map(tasks.map((task) => [task.dedupeKey, task]));
  const report = buildDecorationBillingReport([...canonicalTasks.values()], input.month);
  return {
    month: input.month,
    rows: report.executionRows,
    scannedReservations: visible.length,
    nextCursor: rows.length > pageSize ? visible.at(-1)?.id || null : null,
    limitedTaskGroups,
    coverage: limitedTaskGroups ? "task_limit_requires_review" as const : "page" as const,
    message: "Registru al execuțiilor înregistrate, inclusiv închirieri anulate. Sumele sunt estimări înregistrate; facturabilitatea, datoria furnizorului și factura fiscală se verifică separat."
  };
}
