import type { AuthSession } from "@/lib/auth";
import type { Prisma } from "@prisma/client";
import { recordAudit } from "@/lib/audit";
import {
  crmCurrentOpportunityValue,
  crmForecastForStage,
  crmNextActionLabel,
  crmOpportunityStageLabel,
  crmProspectStatusLabel
} from "@/lib/crm-domain";
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
  "crm_classification_due",
  "crm_stage_stalled",
  "crm_no_response_attention",
  "crm_close_due_soon",
  "crm_close_overdue"
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
  const activeUpload = await prisma.financialReportUpload.findFirst({
    where: { activeVersion: true, status: "confirmed" },
    select: { id: true },
    orderBy: { uploadedAt: "desc" }
  });
  const [receivables, fallbackUsers] = await Promise.all([
    prisma.financialReceivable.findMany({
      where: {
        uploadId: activeUpload?.id || "__no_active_financial_report__",
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
    const ownerUserId = row.accountOwnerUserId || row.client?.accountOwnerUserId;
    const recipients = ownerUserId ? [ownerUserId] : fallbackIds;
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
        metadata: {
          daysUntilDue: days,
          clientId: row.clientId,
          clientName: row.clientName,
          amount: moneyNumber(row.remainingAmount),
          currency: row.currency
        }
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
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const dayAfterTomorrow = addDays(today, 2);
  const nextWeek = addDays(today, 8);
  const [actions, prospectsWithoutAction, opportunitiesWithoutAction] = await Promise.all([
    prisma.crmNextAction.findMany({
      where: { status: "open", ownerId: { not: null } },
      select: {
        id: true, ownerId: true, type: true, description: true, dueAt: true, company: { select: { name: true } },
        prospect: { select: { id: true, status: true, updatedAt: true } },
        opportunity: { select: { id: true, name: true, stage: true, decisionDate: true, updatedAt: true, quotedValue: true, revisedValue: true, agreedValue: true, currency: true } }
      },
      orderBy: { dueAt: "asc" },
      take: 5000
    }),
    prisma.crmProspect.findMany({
      where: { OR: [{ status: "prospecting" }, { status: "qualified", opportunities: { none: { stage: { in: ["opportunity", "quoted", "negotiation", "contracting", "on_hold"] } } } }], ownerId: { not: null }, nextActions: { none: { status: "open" } } },
      select: { id: true, ownerId: true, status: true, updatedAt: true, company: { select: { name: true } } },
      take: 2000
    }),
    prisma.crmOpportunity.findMany({
      where: { stage: { in: ["opportunity", "quoted", "negotiation", "contracting"] }, ownerId: { not: null }, nextActions: { none: { status: "open" } } },
      select: { id: true, ownerId: true, name: true, stage: true, updatedAt: true, company: { select: { name: true } } },
      take: 2000
    })
  ]);

  const desiredKeys = new Set<string>();
  let created = 0;
  for (const action of actions) {
    if (!action.ownerId) continue;
    const entityType = action.opportunity ? "crm_opportunity" : "crm_prospect";
    const entityId = action.opportunity?.id || action.prospect?.id;
    if (!entityId) continue;
    const reminderTypes: string[] = [];
    if (action.dueAt < today) reminderTypes.push("crm_followup_overdue");
    else if (action.dueAt < tomorrow) reminderTypes.push("crm_followup_due_today");
    else if (action.dueAt < dayAfterTomorrow) reminderTypes.push("crm_followup_due_tomorrow");
    const stageUpdatedAt = action.opportunity?.updatedAt || action.prospect?.updatedAt;
    const stageAgeDays = stageUpdatedAt ? Math.max(0, Math.floor((now.getTime() - stageUpdatedAt.getTime()) / 86_400_000)) : 0;
    if (stageAgeDays >= 14) reminderTypes.push("crm_stage_stalled");
    if (action.opportunity?.decisionDate && action.opportunity.decisionDate < nextWeek && ["possible", "commit"].includes(crmForecastForStage(action.opportunity.stage))) {
      reminderTypes.push(action.opportunity.decisionDate < today ? "crm_close_overdue" : "crm_close_due_soon");
    }
    for (const type of [...new Set(reminderTypes)]) {
      desiredKeys.add(notificationKey(action.ownerId, type, entityType, entityId));
      const isCloseReminder = type === "crm_close_due_soon" || type === "crm_close_overdue";
      created += await ensureNotification({
        userId: action.ownerId,
        type,
        title: type === "crm_followup_overdue" ? "Follow-up CRM restant" : type === "crm_followup_due_today" ? "Follow-up CRM pentru azi" : type === "crm_followup_due_tomorrow" ? "Follow-up CRM pentru maine" : type === "crm_stage_stalled" ? "Element CRM blocat in etapa" : type === "crm_close_overdue" ? "Decizie comerciala restanta" : "Oportunitate aproape de termen",
        message: `${action.company.name}${action.opportunity?.name ? ` / ${action.opportunity.name}` : ""}: ${action.opportunity ? crmOpportunityStageLabel(action.opportunity.stage) : crmProspectStatusLabel(action.prospect?.status || "prospecting")}.`,
        entityType,
        entityId,
        severity: ["crm_followup_overdue", "crm_close_overdue"].includes(type) ? "high" : "medium",
        dueDate: isCloseReminder ? action.opportunity?.decisionDate || action.dueAt : action.dueAt,
        recommendedAction: type === "crm_stage_stalled" ? `Elementul este neschimbat de ${stageAgeDays} zile. Stabileste urmatorul rezultat.` : isCloseReminder ? "Confirma decizia comerciala si actualizeaza oportunitatea." : `Executa: ${crmNextActionLabel(action.type, action.description)}.`,
        metadata: {
          companyName: action.company.name,
          kind: action.opportunity ? "opportunity" : "prospect",
          stage: action.opportunity?.stage || action.prospect?.status,
          stageAgeDays,
          actionType: action.type,
          value: action.opportunity ? crmCurrentOpportunityValue(action.opportunity) : null,
          currency: action.opportunity?.currency || null,
          forecast: action.opportunity ? crmForecastForStage(action.opportunity.stage) : null,
          decisionDate: action.opportunity?.decisionDate?.toISOString() || null
        }
      });
    }
  }

  for (const row of [...prospectsWithoutAction.map((item) => ({ ...item, kind: "prospect" as const })), ...opportunitiesWithoutAction.map((item) => ({ ...item, kind: "opportunity" as const }))]) {
    if (!row.ownerId) continue;
    const entityType = row.kind === "opportunity" ? "crm_opportunity" : "crm_prospect";
    desiredKeys.add(notificationKey(row.ownerId, "crm_next_step_missing", entityType, row.id));
    created += await ensureNotification({
      userId: row.ownerId,
      type: "crm_next_step_missing",
      title: "Element CRM fara urmator pas",
      message: `${row.company.name}${"name" in row ? ` / ${row.name}` : ""} nu are o actiune deschisa.`,
      entityType,
      entityId: row.id,
      severity: "medium",
      dueDate: today,
      recommendedAction: "Stabileste actiunea si termenul urmator.",
      metadata: { companyName: row.company.name, kind: row.kind, stage: row.kind === "opportunity" ? row.stage : row.status }
    });
  }

  await archiveStaleCrmNotifications(desiredKeys, now);
  return created;
}

export function notificationEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.NOTIFICATION_FROM_EMAIL);
}

export async function sendDailyNotificationEmails(now = new Date()) {
  if (!notificationEmailConfigured()) {
    return { enabled: false, sent: 0, failed: 0, reason: "Email notifications are not configured." };
  }
  const dayKey = now.toISOString().slice(0, 10);
  const rows = await prisma.appNotification.findMany({
    where: {
      status: { in: ["open", "in_progress"] },
      user: { active: true }
    },
    select: {
      id: true,
      userId: true,
      title: true,
      message: true,
      severity: true,
      dueDate: true,
      recommendedAction: true,
      entityType: true,
      entityId: true,
      metadata: true,
      user: { select: { name: true, email: true } }
    },
    orderBy: [{ severity: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    take: 1000
  });
  const pendingRows = rows.filter((row) => notificationMetadata(row.metadata).emailDigestDate !== dayKey);
  const grouped = new Map<string, typeof pendingRows>();
  for (const row of pendingRows) {
    const group = grouped.get(row.userId) || [];
    group.push(row);
    grouped.set(row.userId, group);
  }

  let sent = 0;
  let failed = 0;
  for (const userRows of grouped.values()) {
    const first = userRows[0];
    if (!first?.user.email) continue;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          from: process.env.NOTIFICATION_FROM_EMAIL,
          to: [first.user.email],
          subject: `Agenda Focus Media - ${userRows.length} actiuni`,
          html: dailyDigestHtml(first.user.name, userRows)
        })
      });
      if (!response.ok) throw new Error(`Email provider returned ${response.status}.`);
      await Promise.all(userRows.map((row) => prisma.appNotification.update({
        where: { id: row.id },
        data: {
          metadata: {
            ...notificationMetadata(row.metadata),
            emailDigestDate: dayKey,
            emailSentAt: now.toISOString()
          }
        }
      })));
      sent += 1;
    } catch {
      failed += 1;
    }
  }
  return { enabled: true, sent, failed };
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

export async function resolveCrmNotificationsForRecord(
  entityType: "crm_prospect" | "crm_opportunity",
  entityId: string,
  resolvedByUserId: string,
  now = new Date()
) {
  return prisma.appNotification.updateMany({
    where: {
      entityType,
      entityId,
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

function notificationMetadata(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function dailyDigestHtml(name: string, rows: Array<{
  title: string;
  message: string;
  severity: string;
  dueDate: Date | null;
  recommendedAction: string | null;
  entityType: string | null;
  entityId: string | null;
}>) {
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || "https://locatii.focusmedia.ro").replace(/\/$/, "");
  const items = rows.slice(0, 30).map((row) => {
    const crmKind = row.entityType === "crm_opportunity" ? "opportunity" : row.entityType === "crm_prospect" ? "prospect" : null;
    const href = crmKind && row.entityId
      ? `${baseUrl}/admin/crm?view=today&kind=${crmKind}&record=${encodeURIComponent(row.entityId)}`
      : `${baseUrl}/admin/crm`;
    return `<li style="margin:0 0 16px"><strong>${escapeHtml(row.title)}</strong><br>${escapeHtml(row.message)}${row.dueDate ? `<br>Termen: ${escapeHtml(row.dueDate.toLocaleDateString("ro-RO"))}` : ""}${row.recommendedAction ? `<br>${escapeHtml(row.recommendedAction)}` : ""}<br><a href="${href}">Deschide in aplicatie</a></li>`;
  }).join("");
  return `<div style="font-family:Arial,sans-serif;color:#102234"><h2>Agenda zilnica Focus Media</h2><p>Buna, ${escapeHtml(name)}. Ai ${rows.length} actiuni active.</p><ul>${items}</ul><p>Acesta este un rezumat. Actualizeaza actiunile direct in aplicatie.</p></div>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character] || character);
}
