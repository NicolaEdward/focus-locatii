import type { AuthSession } from "@/lib/auth";
import type { Prisma } from "@prisma/client";
import { recordAudit } from "@/lib/audit";
import { moneyNumber } from "@/lib/money";
import { prisma } from "@/lib/prisma";

const receivableReminderDays = new Set([7, 3, 0, -1, -7]);
const receivableNotificationTypes = ["receivable_overdue", "receivable_due_today", "receivable_due_soon"];
const legacyInvoiceNotificationTypes = ["invoice_overdue", "invoice_due_today", "invoice_due_soon"];
const financialNotificationTypes = [...receivableNotificationTypes, ...legacyInvoiceNotificationTypes];

export async function syncFinancialNotifications(now = new Date()) {
  const today = startOfDay(now);
  const [receivables, fallbackUsers] = await Promise.all([
    prisma.financialReceivable.findMany({
      where: {
        includedInReport: true,
        needsReview: false,
        status: { notIn: ["collected", "included", "excluded", "archived"] },
        remainingAmount: { gt: 0 },
        dueDate: { gte: addDays(today, -90), lte: addDays(today, 7) }
      },
      include: { client: { select: { accountOwnerUserId: true, companyName: true } } },
      take: 500
    }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["SALES_DIRECTOR", "COO"] } },
      select: { id: true, role: true }
    })
  ]);

  const fallbackIds = fallbackUsers.map((user) => user.id);
  const desiredKeys = new Set<string>();
  let created = 0;
  for (const row of receivables) {
    if (!row.dueDate) continue;
    const days = daysBetween(today, startOfDay(row.dueDate));
    if (!shouldNotifyReceivable(days)) continue;
    const recipients = row.client?.accountOwnerUserId ? [row.client.accountOwnerUserId] : fallbackIds;
    for (const userId of recipients) {
      const type = days < 0 ? "receivable_overdue" : days === 0 ? "receivable_due_today" : "receivable_due_soon";
      desiredKeys.add(notificationKey(userId, type, "financial_receivable", row.id));
      created += await ensureNotification({
        userId,
        type,
        title: days < 0 ? "Client depasit la plata" : days === 0 ? "Client scadent azi" : "Client aproape de scadenta",
        message: `${row.clientName || row.client?.companyName || "Client"} are rest de incasat ${moneyNumber(row.remainingAmount)} ${row.currency || ""}.`,
        entityType: "financial_receivable",
        entityId: row.id,
        severity: days < 0 ? "high" : "medium",
        dueDate: row.dueDate,
        recommendedAction: days < 0 ? "Suna clientul si seteaza urmatorul follow-up." : "Trimite reminder de plata.",
        metadata: { daysUntilDue: days, clientName: row.clientName, amount: moneyNumber(row.remainingAmount), currency: row.currency }
      });
    }
  }

  await archiveStaleFinancialNotifications(desiredKeys, now);
  return created;
}

export async function listNotificationsForUser(session: AuthSession) {
  return prisma.appNotification.findMany({
    where: {
      ...(["COO", "SUPER_ADMIN", "SALES_DIRECTOR"].includes(session.role) ? {} : { userId: session.id }),
      type: { notIn: legacyInvoiceNotificationTypes },
      status: { in: ["open", "in_progress"] }
    },
    include: { user: { select: { name: true, email: true } } },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    take: 200
  });
}

export async function updateNotificationAction(id: string, action: string, note: string | null, session: AuthSession, request?: Request) {
  const notification = await prisma.appNotification.findUniqueOrThrow({ where: { id } });
  if (session.role === "SALES_AGENT" && notification.userId !== session.id) {
    throw new Error("Poti modifica doar notificarile tale.");
  }
  const status = action === "resolve" || action === "called" || action === "collected" ? "resolved" : action === "escalate" ? "in_progress" : "open";
  const updated = await prisma.appNotification.update({
    where: { id },
    data: {
      status,
      resolvedByUserId: status === "resolved" ? session.id : notification.resolvedByUserId,
      resolvedAt: status === "resolved" ? new Date() : notification.resolvedAt,
      metadata: {
        ...(notification.metadata && typeof notification.metadata === "object" ? notification.metadata as Record<string, unknown> : {}),
        lastAction: action,
        lastNote: note,
        lastActionAt: new Date().toISOString()
      }
    }
  });
  await recordAudit({
    actor: session,
    action: `notification.${action}`,
    entityType: "app_notification",
    entityId: id,
    metadata: { note, previousStatus: notification.status, nextStatus: status },
    request: request as never
  });
  return updated;
}

async function ensureNotification(input: {
  userId: string;
  type: string;
  title: string;
  message: string;
  entityType: string;
  entityId: string;
  severity: string;
  dueDate: Date;
  recommendedAction: string;
  metadata: Record<string, unknown>;
}) {
  const existing = await prisma.appNotification.findFirst({
    where: {
      userId: input.userId,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      status: { in: ["open", "in_progress"] }
    },
    select: { id: true }
  });
  if (existing) {
    await prisma.appNotification.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        message: input.message,
        severity: input.severity,
        dueDate: input.dueDate,
        recommendedAction: input.recommendedAction,
        metadata: input.metadata as Prisma.InputJsonValue
      }
    });
    return 0;
  }
  await prisma.appNotification.create({ data: { ...input, metadata: input.metadata as Prisma.InputJsonValue } });
  return 1;
}

async function archiveStaleFinancialNotifications(desiredKeys: Set<string>, now: Date) {
  const openFinancial = await prisma.appNotification.findMany({
    where: { type: { in: financialNotificationTypes }, status: { in: ["open", "in_progress"] } },
    select: { id: true, userId: true, type: true, entityType: true, entityId: true }
  });
  const staleIds = openFinancial
    .filter((notification) => !desiredKeys.has(notificationKey(notification.userId, notification.type, notification.entityType, notification.entityId)))
    .map((notification) => notification.id);
  if (!staleIds.length) return 0;
  const result = await prisma.appNotification.updateMany({
    where: { id: { in: staleIds } },
    data: { status: "archived", resolvedAt: now }
  });
  return result.count;
}

function notificationKey(userId: string | null, type: string, entityType: string | null, entityId: string | null) {
  return `${userId || ""}|${type}|${entityType}|${entityId || ""}`;
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function daysBetween(left: Date, right: Date) {
  return Math.round((right.getTime() - left.getTime()) / 86400000);
}

function shouldNotifyReceivable(daysUntilDue: number) {
  if (receivableReminderDays.has(daysUntilDue)) return true;
  return daysUntilDue < -7 && Math.abs(daysUntilDue) % 7 === 0;
}
