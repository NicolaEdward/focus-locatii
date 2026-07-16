import type { AuthSession } from "@/lib/auth";
import type { Prisma } from "@prisma/client";
import { recordAudit } from "@/lib/audit";
import {
  CRM_ACTIVE_DB_STATUSES,
  crmLeadClassificationAttention,
  crmStatusLabel,
  normalizeCrmStatus,
  startOfUtcDay
} from "@/lib/crm";
import { moneyNumber } from "@/lib/money";
import { prisma } from "@/lib/prisma";

const receivableReminderDays = new Set([7, 3, 0, -1, -7]);
const receivableNotificationTypes = ["receivable_overdue", "receivable_due_today", "receivable_due_soon"];
const legacyInvoiceNotificationTypes = ["invoice_overdue", "invoice_due_today", "invoice_due_soon"];
const financialNotificationTypes = [...receivableNotificationTypes, ...legacyInvoiceNotificationTypes];
const crmNotificationTypes = [
  "crm_followup_overdue",
  "crm_followup_due_today",
  "crm_followup_due_tomorrow",
  "crm_next_step_missing",
  "crm_classification_due"
];

type OperationalNotificationInput = {
  recipientUserIds: Array<string | null | undefined>;
  actorUserId: string;
  type: string;
  title: string;
  message: string;
  entityId: string;
  dueDate?: Date | null;
  metadata?: Record<string, unknown>;
};

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
  const ownershipWhere =
    ["COO", "SUPER_ADMIN"].includes(session.role)
      ? {}
      : session.role === "SALES_DIRECTOR"
        ? { OR: [{ type: { notIn: crmNotificationTypes } }, { userId: session.id }] }
        : { userId: session.id };
  return prisma.appNotification.findMany({
    where: {
      ...ownershipWhere,
      type: { notIn: legacyInvoiceNotificationTypes },
      status: { in: ["open", "in_progress"] }
    },
    include: { user: { select: { name: true, email: true } } },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    take: 200
  });
}

export async function syncCrmNotifications(now = new Date()) {
  const today = startOfUtcDay(now);
  const tomorrow = addDays(today, 1);
  const dayAfterTomorrow = addDays(today, 2);
  const leads = await prisma.crmLead.findMany({
    where: {
      status: { in: CRM_ACTIVE_DB_STATUSES },
      assignedToUserId: { not: null }
    },
    select: {
      id: true,
      companyName: true,
      status: true,
      assignedToUserId: true,
      nextFollowUpDate: true,
      updatedAt: true
    },
    take: 2000
  });

  const desiredKeys = new Set<string>();
  let created = 0;
  for (const lead of leads) {
    if (!lead.assignedToUserId) continue;
    const classificationAttention = crmLeadClassificationAttention(lead, now);
    const type = !lead.nextFollowUpDate
      ? "crm_next_step_missing"
      : lead.nextFollowUpDate < today
        ? "crm_followup_overdue"
        : lead.nextFollowUpDate < tomorrow
          ? "crm_followup_due_today"
          : lead.nextFollowUpDate < dayAfterTomorrow
            ? "crm_followup_due_tomorrow"
            : classificationAttention
              ? "crm_classification_due"
              : null;
    if (!type) continue;
    desiredKeys.add(notificationKey(lead.assignedToUserId, type, "crm_lead", lead.id));
    const classificationTitle = classificationAttention === "cold"
      ? "Prospect Cold de clasificat"
      : "Lead Contactat de calificat";
    created += await ensureNotification({
      userId: lead.assignedToUserId,
      type,
      title: type === "crm_followup_overdue"
        ? "Follow-up CRM restant"
        : type === "crm_followup_due_today"
          ? "Follow-up CRM pentru azi"
          : type === "crm_followup_due_tomorrow"
            ? "Follow-up CRM pentru maine"
            : type === "crm_classification_due"
              ? classificationTitle
              : "Lead fara urmator pas",
      message: `${lead.companyName} este in etapa ${crmStatusLabel(lead.status)}.`,
      entityType: "crm_lead",
      entityId: lead.id,
      severity: type === "crm_followup_overdue" ? "high" : "medium",
      dueDate: type === "crm_classification_due" ? today : lead.nextFollowUpDate,
      recommendedAction: type === "crm_classification_due"
        ? classificationAttention === "cold"
          ? "Contacteaza prospectul sau inchide-l daca nu mai este relevant."
          : "Confirma nevoia, perioada si bugetul, apoi actualizeaza etapa."
        : "Deschide lead-ul si inregistreaza urmatoarea activitate.",
      metadata: {
        companyName: lead.companyName,
        crmStatus: normalizeCrmStatus(lead.status),
        classificationAttention
      }
    });
  }

  await archiveStaleCrmNotifications(desiredKeys, now);
  return created;
}

export async function resolveCrmNotificationsForLead(leadId: string, resolvedByUserId: string, now = new Date()) {
  return prisma.appNotification.updateMany({
    where: {
      entityType: "crm_lead",
      entityId: leadId,
      type: { in: crmNotificationTypes },
      status: { in: ["open", "in_progress"] }
    },
    data: {
      status: "resolved",
      resolvedByUserId,
      resolvedAt: now
    }
  });
}

export async function createOperationalNotifications(input: OperationalNotificationInput) {
  const requestedIds = [...new Set(input.recipientUserIds.filter((id): id is string => Boolean(id)))]
    .filter((id) => id !== input.actorUserId);
  let recipients = requestedIds.length
    ? await prisma.user.findMany({
        where: { id: { in: requestedIds }, active: true },
        select: { id: true }
      })
    : [];
  if (!recipients.length) {
    recipients = await prisma.user.findMany({
        where: { active: true, role: { in: ["COO", "SALES_DIRECTOR"] } },
        select: { id: true }
      });
  }

  let created = 0;
  for (const recipient of recipients) {
    created += await ensureNotification({
      userId: recipient.id,
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: "reservation",
      entityId: input.entityId,
      severity: "medium",
      dueDate: input.dueDate ?? null,
      recommendedAction: "Verifica detaliile in workspace-ul operational.",
      metadata: input.metadata || {}
    });
  }
  return created;
}

export async function updateNotificationAction(id: string, action: string, note: string | null, session: AuthSession, request?: Request) {
  const notification = await prisma.appNotification.findUniqueOrThrow({ where: { id } });
  if (!["COO", "SUPER_ADMIN", "SALES_DIRECTOR"].includes(session.role) && notification.userId !== session.id) {
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
  dueDate: Date | null;
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

async function archiveStaleCrmNotifications(desiredKeys: Set<string>, now: Date) {
  const openNotifications = await prisma.appNotification.findMany({
    where: { type: { in: crmNotificationTypes }, status: { in: ["open", "in_progress"] } },
    select: { id: true, userId: true, type: true, entityType: true, entityId: true }
  });
  const staleIds = openNotifications
    .filter((notification) => !desiredKeys.has(notificationKey(
      notification.userId,
      notification.type,
      notification.entityType,
      notification.entityId
    )))
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
