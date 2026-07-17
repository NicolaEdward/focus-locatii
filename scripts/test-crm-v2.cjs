const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

const crm = loadTsModule(path.join(process.cwd(), "src", "lib", "crm.ts"));

main();

function main() {
  const now = new Date("2026-07-16T12:00:00.000Z");
  const seller = actor("seller-1", "SALES_AGENT");
  const director = actor("director-1", "SALES_DIRECTOR");
  const coo = actor("coo-1", "COO");

  assert.equal(crm.normalizeCrmStatus("NEW"), "cold");
  assert.equal(crm.normalizeCrmStatus("CONTACTED"), "contacted");
  assert.equal(crm.normalizeCrmStatus("NEGOTIATION"), "in_negotiation");
  assert.equal(crm.normalizeCrmStatus("account_management"), "won");
  assert.equal(crm.isKnownCrmStatus("new"), true);
  assert.equal(crm.isKnownCrmStatus("contacted"), true);
  assert.equal(crm.isKnownCrmStatus("not-a-real-stage"), false);
  assert.equal(crm.crmDefaultProbability("cold"), 10);
  assert.equal(crm.crmDefaultProbability("contacted"), 20);
  assert.equal(crm.crmDefaultProbability("qualified"), 35);
  const qualification = crm.crmQualificationScore({
    needConfirmed: true,
    periodKnown: true,
    geographyKnown: true,
    formatsKnown: false,
    budgetKnown: true
  });
  assert.equal(qualification.completed, 4);
  assert.equal(qualification.total, 6);
  assert.equal(qualification.percent, 67);
  assert.equal(crm.crmStageAgeDays("2026-07-01T00:00:00.000Z", now), 15);
  assert.equal(crm.crmStageIsStalled({ status: "in_offer", stageChangedAt: "2026-07-01T00:00:00.000Z" }, now), true);
  assert.equal(crm.crmOpportunityPriority({
    status: "qualified",
    nextFollowUpDate: "2026-07-15T00:00:00.000Z"
  }, now), "urgent");
  assert.equal(crm.crmLeadScope(seller).assignedToUserId, "seller-1");
  assert.equal(Object.keys(crm.crmLeadScope(coo)).length, 0);
  assert.equal(Object.keys(crm.crmLeadScope(director)).length, 0);
  assert.doesNotThrow(() => crm.assertCrmRole(director));
  assert.equal(crm.canAccessCrmLead(seller, { assignedToUserId: "seller-1" }), true);
  assert.equal(crm.canAccessCrmLead(seller, { assignedToUserId: "seller-2" }), false);

  assert.throws(
    () => crm.validateCrmState({ status: "qualified", nextFollowUpDate: null }),
    /urmatorul follow-up/
  );
  assert.throws(
    () => crm.validateCrmState({ status: "lost", lostReason: "" }),
    /motivul/
  );
  assert.throws(
    () => crm.validateCrmState({ status: "lost", lostReason: "Buget insuficient", lostReasonCode: "" }),
    /categoria/
  );
  assert.equal(crm.validateCrmState({
    status: "lost",
    lostReason: "Buget insuficient",
    lostReasonCode: "price"
  }), "lost");
  assert.throws(
    () => crm.validateCrmState({ status: "won", clientId: null }),
    /client/
  );
  assert.equal(crm.validateCrmState({
    status: "offer_sent",
    nextFollowUpDate: new Date("2026-07-20T00:00:00.000Z")
  }), "offer_sent");

  assert.equal(crm.crmLeadAttention({
    status: "cold",
    nextFollowUpDate: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z"
  }, now), "overdue");
  assert.equal(crm.crmLeadAttention({
    status: "qualified",
    nextFollowUpDate: null,
    updatedAt: "2026-07-15T00:00:00.000Z"
  }, now), "missing");
  assert.equal(crm.crmLeadAttention({
    status: "won",
    nextFollowUpDate: null,
    updatedAt: "2026-07-15T00:00:00.000Z"
  }, now), null);
  assert.equal(crm.crmLeadClassificationAttention({
    status: "cold",
    updatedAt: "2026-07-01T00:00:00.000Z"
  }, now), "cold");
  assert.equal(crm.crmLeadClassificationAttention({
    status: "contacted",
    updatedAt: "2026-07-01T00:00:00.000Z"
  }, now), "contacted");
  assert.equal(crm.crmLeadClassificationAttention({
    status: "qualified",
    updatedAt: "2026-07-01T00:00:00.000Z"
  }, now), null);

  const summary = crm.summarizeCrmLeads([
    row("qualified", "2026-07-15", 100, "EUR", 50, "2026-07-15"),
    row("in_offer", "2026-07-16", 200, "RON", 25, "2026-07-16"),
    row("cold", null, 300, "EUR", null, "2026-07-16"),
    row("won", null, 500, "EUR", 100, "2026-07-10"),
    row("lost", null, 100, "RON", 0, "2026-07-11")
  ], now);
  assert.equal(summary.active, 3);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.dueToday, 1);
  assert.equal(summary.missingNextStep, 1);
  assert.equal(summary.wonThisMonth, 1);
  assert.equal(summary.lostThisMonth, 1);
  assert.equal(summary.pipelineByCurrency.EUR, 400);
  assert.equal(summary.pipelineByCurrency.RON, 200);
  assert.equal(summary.weightedByCurrency.EUR, 50);
  assert.equal(summary.weightedByCurrency.RON, 50);
  const outcomes = crm.monthlyCrmOutcomes([
    { leadId: "lead-1", statusAtTime: "lost", activityDate: "2026-07-03T10:00:00.000Z" },
    { leadId: "lead-1", statusAtTime: "won", activityDate: "2026-07-08T10:00:00.000Z" },
    { leadId: "lead-2", statusAtTime: "lost", activityDate: "2026-07-09T10:00:00.000Z" },
    { leadId: "lead-old", statusAtTime: "won", activityDate: "2026-06-30T10:00:00.000Z" }
  ], now);
  assert.equal(outcomes.wonThisMonth, 1);
  assert.equal(outcomes.lostThisMonth, 1);

  sourceArchitectureChecks();

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "canonical CRM statuses and legacy mappings",
      "OOH Cold and Contactat stages remain distinct",
      "stage probability suggestions preserve deterministic forecast defaults",
      "stale Cold and Contactat leads are identified for classification",
      "qualification score is deterministic and optional at creation",
      "stage aging and opportunity priority are calculated automatically",
      "sales agents see only owned leads",
      "Sales Director can use and coordinate CRM",
      "active leads require a next follow-up",
      "lost and won terminal-state validation",
      "attention and deterministic pipeline metrics",
      "monthly won/lost metrics use real status events",
      "paginated summary/detail API architecture",
      "all-client duplicate visibility without cross-owner lead access",
      "COO dashboard metrics and CRM notifications",
      "no selector, reservation or Media Plan integration"
    ]
  }, null, 2));
}

function sourceArchitectureChecks() {
  const service = read("src/lib/crm-service.ts");
  const workspace = read("src/components/admin/CrmWorkspace.tsx");
  const adminHeader = read("src/components/admin/AdminHeader.tsx");
  const notificationBell = read("src/components/admin/NotificationBell.tsx");
  const crmPage = read("src/app/admin/crm/page.tsx");
  const dashboard = read("src/lib/dashboard.ts");
  const notifications = read("src/lib/notifications.ts");
  const cron = read("src/app/api/cron/sync-financial-notifications/route.ts");
  const rbac = read("src/lib/rbac.ts");
  const listRoute = read("src/app/api/admin/crm/leads/route.ts");
  const activityRoute = read("src/app/api/admin/crm/leads/[id]/activities/route.ts");
  const contactsRoute = read("src/app/api/admin/crm/leads/[id]/contacts/route.ts");
  const assigneesRoute = read("src/app/api/admin/crm/assignees/route.ts");
  const schema = read("prisma/schema.prisma");
  const migration = read("prisma/migrations/20260716000000_crm_opportunity_productivity_v3/migration.sql");

  assert(service.includes("skip: (page - 1) * limit"), "CRM list must be paginated");
  assert(service.includes("take: limit"), "CRM list must have a bounded page size");
  assert(service.includes("select: crmLeadSummarySelect"), "CRM list must use a summary DTO");
  assert(service.includes("take: 50"), "CRM detail activity history must stay bounded");
  assert(service.includes('role: { in: ["SALES_AGENT", "SALES_DIRECTOR"] }'), "CRM assignees must be active sales agents or the sales director");
  assert(service.includes("prisma.clientAccount.findMany"), "duplicate search must show registered clients");
  assert(!/clientAccount\.findMany\([\s\S]*accountOwnerUserId:\s*actor\.id/.test(service), "client duplicate lookup must not hide registered clients from sellers");
  assert(!service.includes("prisma.reservation"), "CRM conversion must not create or change reservations");
  assert(!service.includes("prisma.mediaPlan"), "CRM must not depend on Media Plan");
  assert(!workspace.includes("/admin/selectie-locatii"), "CRM must stay independent from the offer selector");
  assert(!workspace.includes("Media Plan"), "CRM must not activate Media Plan");
  assert(workspace.includes('type ViewMode = "today" | "pipeline" | "all"'), "CRM must expose daily, pipeline and list workflows");
  assert(workspace.includes("Urmatorul follow-up"), "CRM must make follow-up ownership visible");
  assert(workspace.includes("Actiuni rapide"), "CRM must provide fast seller actions");
  assert(workspace.includes("Nu raspunde"), "CRM must support a no-answer follow-up preset");
  assert(workspace.includes("De clasificat"), "daily CRM must surface stale Cold and Contactat leads");
  assert(workspace.includes("Calificare OOH"), "CRM detail must offer a compact OOH qualification checklist");
  assert(workspace.includes("Detalii comerciale optionale"), "new opportunity form must keep secondary fields progressive");
  assert(workspace.includes("Oportunitate / campanie"), "CRM must separate company from the commercial opportunity");
  assert(workspace.includes("Brief primit"), "CRM must offer a one-click brief-received workflow");
  assert(workspace.includes("Oferta trimisa"), "CRM must offer a one-click offer-sent workflow");
  assert(workspace.includes('status: "contacted"'), "quick contact action must classify a Cold prospect as Contactat");
  assert(workspace.includes("initialLeadId"), "notification deep links must open lead detail without client search-param coupling");
  assert(!workspace.includes("grid-flow-col"), "CRM pipeline must wrap instead of extending indefinitely to the right");
  assert(workspace.includes("md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"), "CRM pipeline must use responsive wrapped columns");
  assert(workspace.includes("grid gap-3 xl:hidden"), "CRM lead list must use cards below wide desktop");
  assert(workspace.includes("hidden overflow-x-auto xl:block"), "wide CRM table must be isolated to desktop widths");
  assert(adminHeader.includes("order-3 col-span-3"), "admin navigation must move to a dedicated responsive row");
  assert(notificationBell.includes('className="hidden sm:inline"'), "notification label must collapse on narrow screens");
  assert(crmPage.includes("initialLeadId={params.lead || null}"), "CRM page must pass the notification deep link safely");
  assert(dashboard.includes('["COO", "SUPER_ADMIN"].includes(session.role)'), "team CRM metrics must be limited to COO and super admin");
  assert(dashboard.includes("financeOnly || !canReadCrm"), "dashboard payload must not include CRM rows for roles without CRM access");
  assert(notifications.includes("syncCrmNotifications"), "CRM follow-up notifications must be synchronized");
  assert(notifications.includes("crm_followup_due_tomorrow"), "CRM must notify sellers before tomorrow's follow-up");
  assert(notifications.includes("crm_classification_due"), "CRM must remind sellers to classify stale prospects");
  assert(notifications.includes('{ OR: [{ type: { notIn: crmNotificationTypes } }, { userId: session.id }] }'), "Sales Director must receive own CRM notifications without losing broader non-CRM oversight");
  assert(cron.includes("syncCrmNotifications()"), "protected cron must run CRM notification synchronization");
  assert(roleBlock(rbac, "SALES_DIRECTOR").includes('"leads.view"'), "Sales Director must have CRM read access");
  assert(roleBlock(rbac, "SALES_DIRECTOR").includes('"leads.manage"'), "Sales Director must have CRM write access");
  assert(listRoute.includes('["leads.view", "leads.view.own"]'), "CRM list API must require CRM permission");
  assert(listRoute.includes("const optionalEmail = z.preprocess"), "CRM lead creation must accept an omitted email without rejecting the lead");
  assert(contactsRoute.includes("const optionalEmail = z.preprocess"), "CRM contacts must accept an omitted email");
  assert(activityRoute.includes("status: z.string().trim().refine(isKnownCrmStatus"), "quick actions must validate CRM stage changes");
  assert(assigneesRoute.includes('["leads.view"]'), "only global CRM roles may list all CRM assignees");
  for (const field of ["opportunityName", "qualificationData", "nextStep", "stageChangedAt", "lastActivityAt", "noResponseCount"]) {
    assert(schema.includes(field), `CRM schema must include additive ${field}`);
    assert(migration.includes("`" + field + "`"), `CRM migration must add ${field}`);
  }
  assert(!migration.includes("DROP TABLE"), "CRM migration must not drop tables");
  assert(!migration.includes("DROP COLUMN"), "CRM migration must not drop columns");
}

function row(status, nextFollowUpDate, estimatedValue, currency, probability, updatedAt) {
  return {
    status,
    nextFollowUpDate: nextFollowUpDate ? new Date(`${nextFollowUpDate}T00:00:00.000Z`) : null,
    estimatedValue,
    currency,
    probability,
    updatedAt: new Date(`${updatedAt}T00:00:00.000Z`)
  };
}

function actor(id, role) {
  return {
    id,
    role,
    name: role,
    email: `${id}@example.test`,
    tokenVersion: 0,
    iat: 0,
    exp: 1
  };
}

function roleBlock(source, role) {
  const start = source.indexOf(`${role}: [`);
  assert.notEqual(start, -1, `Missing role block ${role}`);
  const end = source.indexOf("],", start);
  assert.notEqual(end, -1, `Unterminated role block ${role}`);
  return source.slice(start, end);
}

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}
