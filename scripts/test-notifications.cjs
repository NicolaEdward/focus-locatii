const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

let receivables = [];
let crmActions = [];
let crmProspectsWithoutAction = [];
let crmOpportunitiesWithoutAction = [];
const users = [
  { id: "director-1", role: "SALES_DIRECTOR", active: true },
  { id: "coo-1", role: "COO", active: true },
  { id: "seller-1", role: "SALES_AGENT", active: true }
];
const notifications = [];
let nextNotificationId = 1;

const prisma = {
  financialReportUpload: {
    findFirst: async () => ({ id: "active-upload" })
  },
  financialReceivable: {
    findMany: async () => receivables
  },
  user: {
    findMany: async ({ where } = {}) => users.filter((user) => {
      if (where?.id?.in && !where.id.in.includes(user.id)) return false;
      if (where?.active !== undefined && user.active !== where.active) return false;
      if (where?.role?.in && !where.role.in.includes(user.role)) return false;
      return true;
    })
  },
  crmNextAction: {
    findMany: async () => crmActions
  },
  crmProspect: {
    findMany: async () => crmProspectsWithoutAction
  },
  crmOpportunity: {
    findMany: async () => crmOpportunitiesWithoutAction
  },
  appNotification: {
    findMany: async ({ where }) => notifications
      .filter((notification) => includes(where.type?.in, notification.type))
      .filter((notification) => includes(where.status?.in, notification.status))
      .map((notification) => ({
        id: notification.id,
        userId: notification.userId,
        type: notification.type,
        entityType: notification.entityType,
        entityId: notification.entityId
      })),
    findFirst: async ({ where }) => notifications.find((notification) =>
      notification.userId === where.userId &&
      notification.type === where.type &&
      notification.entityType === where.entityType &&
      notification.entityId === where.entityId &&
      includes(where.status?.in, notification.status)
    ) || null,
    findUniqueOrThrow: async ({ where }) => {
      const notification = notifications.find((item) => item.id === where.id);
      if (!notification) throw new Error("missing notification");
      return notification;
    },
    create: async ({ data }) => {
      const notification = { id: `notification-${nextNotificationId++}`, status: "open", ...data };
      notifications.push(notification);
      return notification;
    },
    update: async ({ where, data }) => {
      const notification = notifications.find((item) => item.id === where.id);
      if (!notification) throw new Error("missing notification");
      Object.assign(notification, data);
      return notification;
    },
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const notification of notifications) {
        const matchesIds = where.id?.in ? where.id.in.includes(notification.id) : true;
        const matchesEntityType = where.entityType ? notification.entityType === where.entityType : true;
        const matchesEntityId = where.entityId ? notification.entityId === where.entityId : true;
        const matchesType = where.type?.in ? where.type.in.includes(notification.type) : true;
        const matchesStatus = where.status?.in ? where.status.in.includes(notification.status) : true;
        if (matchesIds && matchesEntityType && matchesEntityId && matchesType && matchesStatus) {
          Object.assign(notification, data);
          count += 1;
        }
      }
      return { count };
    }
  }
};

const {
  createOperationalNotifications,
  resolveCrmNotificationsForRecord,
  sendDailyNotificationEmails,
  resolveCrmNotificationsForLead,
  syncCrmNotifications,
  syncFinancialNotifications,
  updateNotificationAction
} = loadTsModule(path.join(process.cwd(), "src", "lib", "notifications.ts"), {
  "@/lib/prisma": { prisma },
  "@/lib/audit": { recordAudit: async () => null }
});

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});

async function main() {
  const now = new Date("2026-06-26T00:00:00.000Z");
  receivables = [
    receivable("soon-1", "2026-07-03", "client-owner-1", "direct-owner-1"),
    receivable("overdue-1", "2026-06-25", "client-owner-2")
  ];
  notifications.push({
    id: "stale-1",
    userId: "client-owner-1",
    type: "receivable_due_soon",
    entityType: "financial_receivable",
    entityId: "stale-receivable",
    status: "open"
  });

  const created = await syncFinancialNotifications(now);
  assert.equal(created, 2, "due-soon and overdue receivable notifications are created");
  assert(openNotification("soon-1", "receivable_due_soon"), "due-soon receivable notification is created");
  assert.equal(openNotification("soon-1", "receivable_due_soon").userId, "direct-owner-1", "snapshot owner takes precedence over a later client owner change");
  assert(openNotification("overdue-1", "receivable_overdue"), "overdue receivable notification is created");
  assert.equal(notificationById("stale-1").status, "archived", "stale receivable notification is cleaned");

  const secondCreated = await syncFinancialNotifications(now);
  assert.equal(secondCreated, 0, "duplicate notification is not repeatedly created");
  assert.equal(openNotifications("soon-1").length, 1, "repeated sync keeps one open due-soon notification");

  receivables = [receivable("soon-1", "2026-06-25", "client-owner-1")];
  const transitionedCreated = await syncFinancialNotifications(now);
  assert.equal(transitionedCreated, 1, "due-soon transition creates overdue notification");
  assert(!openNotification("soon-1", "receivable_due_soon"), "due-soon transition archives stale due-soon notification");
  assert(openNotification("soon-1", "receivable_overdue"), "due-soon transition leaves current overdue notification");

  crmActions = [
    crmAction("crm-overdue", "Client restant", "2026-06-25", { prospect: crmProspectRef("crm-overdue", "qualified", "2026-06-25") }),
    crmAction("crm-today", "Client azi", "2026-06-26", { opportunity: crmOpportunityRef("crm-today", "quoted", "2026-06-25") }),
    crmAction("crm-tomorrow", "Client maine", "2026-06-27", { opportunity: crmOpportunityRef("crm-tomorrow", "quoted", "2026-06-25") }),
    crmAction("crm-stalled", "Oportunitate blocata", "2026-07-10", { opportunity: crmOpportunityRef("crm-stalled", "quoted", "2026-06-01") }),
    crmAction("crm-close-soon", "Oportunitate aproape", "2026-07-10", { opportunity: crmOpportunityRef("crm-close-soon", "negotiation", "2026-06-25", "2026-06-29") }),
    crmAction("crm-close-overdue", "Oportunitate restanta", "2026-07-10", { opportunity: crmOpportunityRef("crm-close-overdue", "contracting", "2026-06-25", "2026-06-25") }),
    crmAction("crm-future", "Client viitor", "2026-06-28", { opportunity: crmOpportunityRef("crm-future", "quoted", "2026-06-25") })
  ];
  crmProspectsWithoutAction = [missingProspect("crm-missing-prospect", "Prospect fara pas")];
  crmOpportunitiesWithoutAction = [missingOpportunity("crm-missing-opportunity", "Oportunitate fara pas")];
  const crmCreated = await syncCrmNotifications(now);
  assert.equal(crmCreated, 8, "CRM sync creates follow-up, missing-action, stalled and close-date notifications");
  assert(openNotification("crm-overdue", "crm_followup_overdue"), "overdue CRM notification is created");
  assert(openNotification("crm-today", "crm_followup_due_today"), "today CRM notification is created");
  assert(openNotification("crm-missing-prospect", "crm_next_step_missing"), "missing prospect action notification is created");
  assert(openNotification("crm-missing-opportunity", "crm_next_step_missing"), "missing opportunity action notification is created");
  assert(openNotification("crm-tomorrow", "crm_followup_due_tomorrow"), "tomorrow CRM notification is created");
  assert(openNotification("crm-stalled", "crm_stage_stalled"), "a stalled commercial stage creates one attention reminder");
  assert(openNotification("crm-close-soon", "crm_close_due_soon"), "a committed opportunity near close date creates a reminder");
  assert(openNotification("crm-close-overdue", "crm_close_overdue"), "a best-case opportunity past close date creates an overdue reminder");
  assert.equal(await syncCrmNotifications(now), 0, "CRM notifications remain idempotent");
  assert.equal(await resolveCrmNotificationsForRecord("crm_opportunity", "crm-today", "seller-1", now).then((result) => result.count), 1, "saved CRM work resolves the related notification");
  assert(!openNotification("crm-today", "crm_followup_due_today"), "resolved CRM work is removed from active notifications immediately");
  const digest = await sendDailyNotificationEmails(now);
  assert.equal(digest.enabled, false, "email digest remains safely disabled without provider configuration");

  crmActions = [crmAction("crm-overdue", "Client restant", "2026-06-30", { prospect: crmProspectRef("crm-overdue", "qualified", "2026-06-26") })];
  crmProspectsWithoutAction = [];
  crmOpportunitiesWithoutAction = [];
  await syncCrmNotifications(now);
  assert(!openNotification("crm-overdue", "crm_followup_overdue"), "resolved CRM timing archives stale overdue notification");

  const operationalCreated = await createOperationalNotifications({
    recipientUserIds: ["seller-1"],
    actorUserId: "field-1",
    type: "operation_decoration_completed",
    title: "Decorare finalizata",
    message: "B01 a fost finalizata.",
    entityId: "reservation-1:decoration:base"
  });
  assert.equal(operationalCreated, 1, "operational completion notifies the responsible seller");
  const operational = openNotification("reservation-1:decoration:base", "operation_decoration_completed");
  assert.equal(operational.userId, "seller-1", "operational notification is assigned to the responsible seller");
  assert.equal(await createOperationalNotifications({
    recipientUserIds: ["seller-1"],
    actorUserId: "field-1",
    type: "operation_decoration_completed",
    title: "Decorare finalizata",
    message: "B01 a fost finalizata.",
    entityId: "reservation-1:decoration:base"
  }), 0, "operational notification is idempotent while open");
  await assert.rejects(
    () => updateNotificationAction(operational.id, "resolve", null, {
      id: "finance-1",
      email: "finance@example.test",
      name: "Finance",
      role: "FINANCE_OPERATOR",
      tokenVersion: 0,
      iat: 0,
      exp: 1
    }),
    /doar notificarile tale/,
    "non-privileged users cannot resolve another user's notification"
  );

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "due-soon receivable notification created",
      "overdue receivable notification created",
      "stale receivable notifications cleaned",
      "due-soon transitions to overdue without stale duplicate",
      "duplicate notification not repeatedly created",
      "CRM due and missing-next-step notifications are idempotent",
      "CRM tomorrow and missing-action reminders are generated without duplicate noise",
      "CRM stalled-stage and decision-date reminders are generated without duplicate noise",
      "saving CRM work resolves its active reminder immediately",
      "stale CRM notifications are archived",
      "operational completion notification is scoped and idempotent",
      "non-privileged notification ownership is enforced"
    ]
  }, null, 2));
}

function receivable(id, dueDate, ownerId, directOwnerId = null) {
  return {
    id,
    uploadId: "active-upload",
    accountOwnerUserId: directOwnerId,
    dueDate: new Date(`${dueDate}T00:00:00.000Z`),
    clientName: `Client ${id}`,
    currency: "RON",
    remainingAmount: 100,
    client: { accountOwnerUserId: ownerId, companyName: `Client ${id}` }
  };
}

function crmAction(id, companyName, dueDate, related) {
  return {
    id,
    ownerId: "seller-1",
    type: "initial_call",
    description: null,
    dueAt: new Date(`${dueDate}T00:00:00.000Z`),
    company: { name: companyName },
    prospect: related.prospect || null,
    opportunity: related.opportunity || null
  };
}

function crmProspectRef(id, status, updatedAt) {
  return { id, status, updatedAt: new Date(`${updatedAt}T00:00:00.000Z`) };
}

function crmOpportunityRef(id, stage, updatedAt, decisionDate = null) {
  return {
    id,
    name: `Oportunitate ${id}`,
    stage,
    decisionDate: decisionDate ? new Date(`${decisionDate}T00:00:00.000Z`) : null,
    updatedAt: new Date(`${updatedAt}T00:00:00.000Z`),
    quotedValue: 4000,
    revisedValue: null,
    agreedValue: null,
    currency: "EUR"
  };
}

function missingProspect(id, name) {
  return { id, ownerId: "seller-1", status: "prospecting", updatedAt: new Date("2026-06-25T00:00:00.000Z"), company: { name } };
}

function missingOpportunity(id, name) {
  return { id, ownerId: "seller-1", name, stage: "opportunity", updatedAt: new Date("2026-06-25T00:00:00.000Z"), company: { name } };
}

function openNotification(entityId, type) {
  return notifications.find((notification) =>
    notification.entityId === entityId &&
    notification.type === type &&
    ["open", "in_progress"].includes(notification.status)
  );
}

function openNotifications(entityId) {
  return notifications.filter((notification) =>
    notification.entityId === entityId &&
    ["open", "in_progress"].includes(notification.status)
  );
}

function notificationById(id) {
  return notifications.find((notification) => notification.id === id);
}

function includes(values, value) {
  return Array.isArray(values) ? values.includes(value) : true;
}
