const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

let receivables = [];
let crmLeads = [];
const users = [
  { id: "director-1", role: "SALES_DIRECTOR", active: true },
  { id: "coo-1", role: "COO", active: true },
  { id: "seller-1", role: "SALES_AGENT", active: true }
];
const notifications = [];
let nextNotificationId = 1;

const prisma = {
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
  crmLead: {
    findMany: async () => crmLeads
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
    receivable("soon-1", "2026-07-03", "client-owner-1"),
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

  crmLeads = [
    crmLead("crm-overdue", "Client restant", "qualified", "2026-06-25", "2026-06-25"),
    crmLead("crm-today", "Client azi", "in_offer", "2026-06-26", "2026-06-25"),
    crmLead("crm-missing", "Client fara pas", "new", null, "2026-06-25"),
    crmLead("crm-tomorrow", "Client maine", "offer_sent", "2026-06-27", "2026-06-25"),
    crmLead("crm-classify", "Prospect vechi", "cold", "2026-07-10", "2026-06-10"),
    crmLead("crm-no-answer", "Client fara raspuns", "qualified", "2026-07-10", "2026-06-25", {
      noResponseCount: 3,
      stageChangedAt: "2026-06-25"
    }),
    crmLead("crm-stalled", "Oportunitate blocata", "in_offer", "2026-07-10", "2026-06-25", {
      stageChangedAt: "2026-06-01"
    }),
    crmLead("crm-future", "Client viitor", "offer_sent", "2026-06-28", "2026-06-25")
  ];
  const crmCreated = await syncCrmNotifications(now);
  assert.equal(crmCreated, 7, "CRM sync creates due, classification, no-answer and stalled-stage notifications");
  assert(openNotification("crm-overdue", "crm_followup_overdue"), "overdue CRM notification is created");
  assert(openNotification("crm-today", "crm_followup_due_today"), "today CRM notification is created");
  assert(openNotification("crm-missing", "crm_next_step_missing"), "missing-next-step CRM notification is created");
  assert(openNotification("crm-tomorrow", "crm_followup_due_tomorrow"), "tomorrow CRM notification is created");
  assert(openNotification("crm-classify", "crm_classification_due"), "stale Cold prospect receives a classification reminder");
  assert(openNotification("crm-no-answer", "crm_no_response_attention"), "repeated no-answer attempts create one attention reminder");
  assert(openNotification("crm-stalled", "crm_stage_stalled"), "a stalled commercial stage creates one attention reminder");
  assert.equal(await syncCrmNotifications(now), 0, "CRM notifications remain idempotent");

  crmLeads = [
    crmLead("crm-overdue", "Client restant", "qualified", "2026-06-30", "2026-06-26"),
    crmLead("crm-today", "Client azi", "in_offer", "2026-06-26", "2026-06-26"),
    crmLead("crm-missing", "Client fara pas", "new", null, "2026-06-26")
  ];
  await syncCrmNotifications(now);
  assert(!openNotification("crm-overdue", "crm_followup_overdue"), "resolved CRM timing archives stale overdue notification");
  assert.equal(await resolveCrmNotificationsForLead("crm-today", "seller-1", now).then((result) => result.count), 1, "saved CRM work resolves the related notification");
  assert(!openNotification("crm-today", "crm_followup_due_today"), "resolved CRM work is removed from active notifications immediately");

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
      "CRM tomorrow and stale-classification reminders are generated without duplicate noise",
      "CRM no-answer and stalled-stage reminders are generated without duplicate noise",
      "saving CRM work resolves its active reminder immediately",
      "stale CRM notifications are archived",
      "operational completion notification is scoped and idempotent",
      "non-privileged notification ownership is enforced"
    ]
  }, null, 2));
}

function receivable(id, dueDate, ownerId) {
  return {
    id,
    dueDate: new Date(`${dueDate}T00:00:00.000Z`),
    clientName: `Client ${id}`,
    currency: "RON",
    remainingAmount: 100,
    client: { accountOwnerUserId: ownerId, companyName: `Client ${id}` }
  };
}

function crmLead(id, companyName, status, nextFollowUpDate, updatedAt, extra = {}) {
  return {
    id,
    companyName,
    opportunityName: null,
    status,
    assignedToUserId: "seller-1",
    nextFollowUpDate: nextFollowUpDate ? new Date(`${nextFollowUpDate}T00:00:00.000Z`) : null,
    nextStep: "Revenire comerciala",
    stageChangedAt: new Date(`${extra.stageChangedAt || updatedAt}T00:00:00.000Z`),
    lastActivityAt: new Date(`${updatedAt}T00:00:00.000Z`),
    noResponseCount: extra.noResponseCount || 0,
    updatedAt: new Date(`${updatedAt}T00:00:00.000Z`)
  };
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
