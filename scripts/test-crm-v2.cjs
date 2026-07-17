const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");
const { loadTsModule } = require("./load-ts-module.cjs");

const crm = loadTsModule(path.join(process.cwd(), "src", "lib", "crm.ts"));
const taxId = loadTsModule(path.join(process.cwd(), "src", "lib", "tax-id.ts"));

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});

async function main() {
  const now = new Date("2026-07-16T12:00:00.000Z");
  const seller = actor("seller-1", "SALES_AGENT");
  const director = actor("director-1", "SALES_DIRECTOR");
  const coo = actor("coo-1", "COO");

  assert.equal(taxId.normalizeTaxId(" ro 12.345.678 "), "RO12345678");
  assert.equal(taxId.canonicalTaxId("RO12345678"), "12345678");
  assert.equal(taxId.taxIdsMatch("RO 12345678", "12345678"), true);
  assert.equal(taxId.isUsableTaxId("RO1"), false);

  assert.equal(crm.normalizeCrmStatus("NEW"), "cold");
  assert.equal(crm.normalizeCrmStatus("CONTACTED"), "contacted");
  assert.equal(crm.normalizeCrmStatus("NEGOTIATION"), "in_negotiation");
  assert.equal(crm.normalizeCrmStatus("account_management"), "won");
  assert.equal(crm.isKnownCrmStatus("new"), true);
  assert.equal(crm.isKnownCrmStatus("contacted"), true);
  assert.equal(crm.isKnownCrmStatus("not-a-real-stage"), false);
  assert.equal(crm.crmForecastCategoryForStatus("cold"), "pipeline");
  assert.equal(crm.crmForecastCategoryForStatus("qualified", 49), "pipeline");
  assert.equal(crm.crmForecastCategoryForStatus("qualified", 50), "best_case");
  assert.equal(crm.crmForecastCategoryForStatus("qualified", 79), "best_case");
  assert.equal(crm.crmForecastCategoryForStatus("qualified", 80), "commit");
  assert.equal(crm.crmForecastCategoryForStatus("on_hold"), "omitted");
  assert.equal(crm.crmForecastCategoryForStatus("won"), "closed");
  assert.equal(crm.nextCrmForecastCategory({ nextStatus: "offer_sent", probability: 80 }), "commit");
  assert.equal(crm.nextCrmForecastCategory({ nextStatus: "contacted", probability: 20 }), "pipeline");
  assert.equal(crm.nextCrmForecastCategory({ nextStatus: "won", probability: 80 }), "closed");
  assert.equal(crm.crmEffectiveProbability(null, "in_negotiation"), 80, "legacy leads use the stage suggestion without a data backfill");
  for (const invalid of [-1, 101, 50.5]) {
    assert.throws(() => crm.crmEffectiveProbability(invalid, "qualified"), /numar intreg intre 0 si 100/);
  }
  assert.equal(crm.crmProbabilityForUpdate({ currentProbability: 80, nextStatus: "contacted" }), 80, "stage changes preserve manually entered probability");
  assert.equal(crm.crmProbabilityForUpdate({ currentProbability: null, nextStatus: "contacted" }), 20, "legacy null probability follows the new stage suggestion");
  assert.equal(crm.crmProbabilityForUpdate({ currentProbability: 80, requestedProbability: 55, nextStatus: "qualified" }), 55, "explicit probability edits are saved");
  assert.equal(crm.crmProbabilityForUpdate({ currentProbability: 80, nextStatus: "won" }), 100);
  assert.equal(crm.crmProbabilityForUpdate({ currentProbability: 80, nextStatus: "lost" }), 0);
  assert.throws(
    () => crm.validateCrmForecast({ status: "offer_sent", probability: 80, estimatedValue: 1000, expectedCloseDate: null }),
    /data estimata/
  );
  assert.equal(crm.validateCrmForecast({
    status: "offer_sent",
    probability: 80,
    estimatedValue: 4000,
    expectedCloseDate: new Date("2026-07-30T00:00:00.000Z")
  }), "commit");
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
    row("qualified", "2026-07-15", 100, "EUR", 35, "2026-08-15", "2026-07-15"),
    row("in_offer", "2026-07-16", 200, "RON", 60, "2026-07-28", "2026-07-16"),
    row("in_negotiation", null, 4000, "EUR", 80, "2026-07-30", "2026-07-16"),
    row("won", null, 500, "EUR", 100, "2026-07-10", "2026-07-10"),
    row("lost", null, 100, "RON", 0, "2026-07-11", "2026-07-11")
  ], now);
  assert.equal(summary.active, 3);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.dueToday, 1);
  assert.equal(summary.missingNextStep, 1);
  assert.equal(summary.wonThisMonth, 1);
  assert.equal(summary.lostThisMonth, 1);
  assert.equal(summary.pipelineByCurrency.EUR, 4100);
  assert.equal(summary.pipelineByCurrency.RON, 200);
  assert.equal(summary.bestCaseByCurrency.RON, 200);
  assert.equal(summary.commitByCurrency.EUR, 4000, "4000 EUR at 80% enters forecast as the full 4000 EUR");
  assert.equal(summary.likelyByCurrency.EUR, 4000);
  assert.equal(summary.likelyByCurrency.RON, 200);
  assert.notEqual(summary.commitByCurrency.EUR, 3200, "the CRM must never multiply opportunity value by probability");

  const fullValueTotals = crm.summarizeCrmLeads([
    row("in_negotiation", "2026-07-20", 4000, "EUR", 80, "2026-07-25", "2026-07-16"),
    row("brief_received", "2026-07-20", 2000, "EUR", 50, "2026-07-26", "2026-07-16")
  ], now);
  assert.equal(fullValueTotals.pipelineByCurrency.EUR, 6000);
  assert.equal(fullValueTotals.likelyByCurrency.EUR, 6000, "multiple opportunities are summed at full value regardless of probability");
  const outcomes = crm.monthlyCrmOutcomes([
    { leadId: "lead-1", statusAtTime: "lost", activityDate: "2026-07-03T10:00:00.000Z" },
    { leadId: "lead-1", statusAtTime: "won", activityDate: "2026-07-08T10:00:00.000Z" },
    { leadId: "lead-2", statusAtTime: "lost", activityDate: "2026-07-09T10:00:00.000Z" },
    { leadId: "lead-old", statusAtTime: "won", activityDate: "2026-06-30T10:00:00.000Z" }
  ], now);
  assert.equal(outcomes.wonThisMonth, 1);
  assert.equal(outcomes.lostThisMonth, 1);

  sourceArchitectureChecks();
  await testCrmExport();

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "canonical CRM statuses and legacy mappings",
      "OOH Cold and Contactat stages remain distinct",
      "full-value forecast categories replace misleading weighted amounts",
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
      "COO-only CRM export with leads, contacts and seller observations",
      "no selector, reservation or Media Plan integration"
    ]
  }, null, 2));
}

async function testCrmExport() {
  let role = "COO";
  const lead = {
    id: "lead-export-1",
    leadDate: new Date("2026-07-01T00:00:00.000Z"),
    companyName: "Client test",
    taxId: "RO12345678",
    industry: "Retail",
    opportunityName: "Campanie test",
    clientType: "direct_client",
    contactName: "Contact Principal",
    phone: "0700000000",
    email: "contact@example.test",
    source: "Recomandare",
    status: "qualified",
    estimatedValue: 4000,
    currency: "EUR",
    probability: 80,
    forecastCategory: "commit",
    expectedCloseDate: new Date("2026-08-01T00:00:00.000Z"),
    nextFollowUpDate: new Date("2026-07-20T00:00:00.000Z"),
    nextStep: "Apel",
    locationsInterested: "Bucuresti",
    notes: "Observatie vanzator",
    lostReason: null,
    lostReasonCode: null,
    lastContactAt: new Date("2026-07-16T10:00:00.000Z"),
    lastActivityAt: new Date("2026-07-16T10:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-16T10:00:00.000Z"),
    assignedTo: { name: "Agent Test", email: "agent@example.test" },
    client: null,
    contacts: [{
      id: "contact-export-1",
      name: "Contact Principal",
      role: "Marketing",
      phone: "0700000000",
      email: "contact@example.test",
      isPrimary: true,
      notes: "Decident",
      createdAt: new Date("2026-07-01T00:00:00.000Z")
    }],
    activities: [{
      activityDate: new Date("2026-07-16T10:00:00.000Z"),
      actionType: "call_connected",
      type: "call",
      statusAtTime: "qualified",
      details: "Discutie",
      note: "Revine vineri",
      nextStep: "Oferta",
      nextFollowUpDate: new Date("2026-07-20T00:00:00.000Z"),
      user: { name: "Agent Test", email: "agent@example.test" }
    }]
  };
  const route = loadTsModule(path.join(process.cwd(), "src", "app", "api", "admin", "crm", "export.xlsx", "route.ts"), {
    "@/lib/auth": {
      requireAnyPermission: async () => ({
        session: { id: "actor-1", role, email: "coo@example.test" },
        response: null
      })
    },
    "@/lib/audit": { recordAudit: async () => null },
    "@/lib/crm": {
      crmEffectiveProbability: (value) => value,
      crmForecastCategoryForStatus: (_status, probability) => probability >= 80 ? "commit" : probability >= 50 ? "best_case" : "pipeline",
      crmForecastCategoryLabel: (value) => value,
      crmStatusLabel: (value) => value
    },
    "@/lib/prisma": { prisma: { crmLead: { findMany: async () => [lead] } } }
  });

  const request = { headers: new Headers() };
  const response = await route.GET(request);
  assert.equal(response.status, 200, "COO can download the CRM workbook");
  const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
  assert.deepEqual(workbook.SheetNames, ["Lead-uri", "Persoane contact", "Istoric observatii"]);
  const leadRows = XLSX.utils.sheet_to_json(workbook.Sheets["Lead-uri"]);
  const contactRows = XLSX.utils.sheet_to_json(workbook.Sheets["Persoane contact"]);
  const activityRows = XLSX.utils.sheet_to_json(workbook.Sheets["Istoric observatii"]);
  assert.equal(leadRows[0]["Domeniu activitate"], "Retail");
  assert.equal(leadRows[0]["Observatii vanzator"], "Observatie vanzator");
  assert.equal(leadRows[0]["Valoare oportunitate"], 4000);
  assert.equal(leadRows[0]["Sanse de castig (%)"], 80);
  assert.equal(leadRows[0]["Nivel forecast"], "commit");
  assert.equal(leadRows[0]["Valoare estimata"], undefined);
  assert.equal(contactRows[0]["Persoana contact"], "Contact Principal");
  assert.equal(activityRows[0].Observatii, "Revine vineri");

  role = "SALES_DIRECTOR";
  assert.equal((await route.GET(request)).status, 403, "team CRM access does not grant the full COO export");
}

function sourceArchitectureChecks() {
  const service = read("src/lib/crm-service.ts");
  const workspace = read("src/components/admin/CrmWorkspace.tsx");
  const cooCommandCenter = read("src/components/admin/CooCommandCenter.tsx");
  const adminHeader = read("src/components/admin/AdminHeader.tsx");
  const notificationBell = read("src/components/admin/NotificationBell.tsx");
  const crmPage = read("src/app/admin/crm/page.tsx");
  const dashboard = read("src/lib/dashboard.ts");
  const notifications = read("src/lib/notifications.ts");
  const cron = read("src/app/api/cron/sync-financial-notifications/route.ts");
  const rbac = read("src/lib/rbac.ts");
  const listRoute = read("src/app/api/admin/crm/leads/route.ts");
  const detailRoute = read("src/app/api/admin/crm/leads/[id]/route.ts");
  const activityRoute = read("src/app/api/admin/crm/leads/[id]/activities/route.ts");
  const contactsRoute = read("src/app/api/admin/crm/leads/[id]/contacts/route.ts");
  const assigneesRoute = read("src/app/api/admin/crm/assignees/route.ts");
  const agendaRoute = read("src/app/api/admin/crm/agenda/route.ts");
  const duplicatesRoute = read("src/app/api/admin/crm/duplicates/route.ts");
  const exportRoute = read("src/app/api/admin/crm/export.xlsx/route.ts");
  const schema = read("prisma/schema.prisma");
  const migration = read("prisma/migrations/20260716000000_crm_opportunity_productivity_v3/migration.sql");
  const forecastMigration = read("prisma/migrations/20260717000000_crm_forecast_categories/migration.sql");

  assert(service.includes("skip: (page - 1) * limit"), "CRM list must be paginated");
  assert(service.includes("take: limit"), "CRM list must have a bounded page size");
  assert(service.includes("select: crmLeadSummarySelect"), "CRM list must use a summary DTO");
  assert(service.includes("take: 50"), "CRM detail activity history must stay bounded");
  assert(service.includes('role: { in: ["SALES_AGENT", "SALES_DIRECTOR"] }'), "CRM assignees must be active sales agents or the sales director");
  assert(service.includes("prisma.clientAccount.findMany"), "duplicate search must show registered clients");
  assert(service.includes("taxIdSearchValues"), "duplicate search must compare normalized CUI values");
  assert(service.includes("assertCrmCompanyOwnership"), "lead writes must enforce company ownership rules server-side");
  assert(service.includes("Firma este deja lucrata"), "sales agents must be warned and blocked from cross-owner company overlap");
  assert(service.includes("listCrmDailyAgenda"), "CRM service must expose a bounded daily agenda");
  assert(service.includes('where: { activeVersion: true, status: "confirmed" }'), "CRM receivables must use only the active confirmed financial upload");
  assert(service.includes("take: 30"), "daily agenda sections must stay bounded");
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
  assert(workspace.includes("Situatie comerciala"), "new opportunity form must group commercial fields clearly");
  assert(workspace.includes("Oportunitate / campanie"), "CRM must separate company from the commercial opportunity");
  assert(workspace.includes("CUI / CIF"), "new CRM opportunities must request the company CUI");
  assert(workspace.includes("Domeniu de activitate"), "new CRM opportunities must request the business industry");
  assert(workspace.includes("CRM_INDUSTRY_OPTIONS"), "CRM must use one controlled industry vocabulary");
  assert(workspace.includes("/api/admin/crm/export.xlsx"), "COO must have an explicit full CRM export action");
  assert(workspace.includes("Incasari de urmarit"), "daily agenda must combine calls with receivables");
  assert(workspace.includes("Datele de incasari nu sunt disponibile"), "CRM must not present missing financial source data as zero receivables");
  assert(workspace.includes("Oportunitati de decis"), "daily agenda must show forecast decisions due soon");
  assert(workspace.includes("Istoric companie"), "lead detail must show safe company-wide contact history");
  assert(workspace.includes("Inchide oportunitatea"), "CRM must close won/lost opportunities through an explicit flow");
  assert(workspace.includes("Creeaza client si marcheaza castigata"), "client creation must happen only as part of a won close flow");
  assert(!workspace.includes("Converteste in client"), "standalone client conversion must not remain visible");
  assert(!workspace.includes("Forecast ponderat"), "seller CRM must not show misleading weighted forecast");
  assert(!workspace.includes("Valoare ponderata"), "seller CRM must never label a weighted amount");
  assert(workspace.includes('label="Sanse de castig (%)"'), "seller CRM must expose editable win probability");
  assert(workspace.includes("Valoarea intra integral in forecast"), "seller CRM must explain the full-value rule");
  assert(!workspace.includes("CRM_FORECAST_CATEGORY_OPTIONS"), "seller CRM must not expose a second manual forecast category");
  assert(!cooCommandCenter.includes("Forecast ponderat"), "COO dashboard must use full-value forecast categories");
  assert(!cooCommandCenter.includes("Valoare ponderata"), "COO dashboard must not present weighted values");
  assert(!cooCommandCenter.includes(">Disciplina<"), "COO dashboard must not show a vacuous discipline score");
  assert(cooCommandCenter.includes("Sanse >=80% luna"), "COO dashboard must show high-confidence opportunities at full value");
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
  assert(notifications.includes("crm_close_due_soon"), "CRM must notify sellers about opportunities near their close date");
  assert(notifications.includes("sendDailyNotificationEmails"), "CRM must provide an optional daily email digest");
  assert(notifications.includes('{ OR: [{ type: { notIn: crmNotificationTypes } }, { userId: session.id }] }'), "Sales Director must receive own CRM notifications without losing broader non-CRM oversight");
  assert(cron.includes("syncCrmNotifications()"), "protected cron must run CRM notification synchronization");
  assert(roleBlock(rbac, "SALES_DIRECTOR").includes('"leads.view"'), "Sales Director must have CRM read access");
  assert(roleBlock(rbac, "SALES_DIRECTOR").includes('"leads.manage"'), "Sales Director must have CRM write access");
  assert(listRoute.includes('["leads.view", "leads.view.own"]'), "CRM list API must require CRM permission");
  assert(listRoute.includes("const optionalEmail = z.preprocess"), "CRM lead creation must accept an omitted email without rejecting the lead");
  assert(contactsRoute.includes("const optionalEmail = z.preprocess"), "CRM contacts must accept an omitted email");
  assert(activityRoute.includes("status: z.string().trim().refine(isKnownCrmStatus"), "quick actions must validate CRM stage changes");
  assert(assigneesRoute.includes('["leads.view"]'), "only global CRM roles may list all CRM assignees");
  assert(agendaRoute.includes('["leads.view", "leads.view.own"]'), "daily agenda must require CRM permission");
  assert(duplicatesRoute.includes('searchParams.get("taxId")'), "duplicate lookup must accept CUI as a strict identifier");
  assert(listRoute.includes('searchParams.get("industry")'), "CRM list API must support industry filtering");
  assert(listRoute.includes('industry: z.string().trim().min(2'), "new CRM leads must require an industry");
  assert(listRoute.includes('probability: z.number().int().min(0).max(100)'), "CRM create API must validate probability from 0 to 100");
  assert(detailRoute.includes('probability: z.number().int().min(0).max(100)'), "CRM update API must validate probability from 0 to 100");
  assert(service.includes("probability: crmEffectiveProbability(row.probability, row.status)"), "CRM list DTO must expose effective probability");
  assert(service.includes("probability: crmEffectiveProbability(lead.probability, lead.status)"), "CRM detail DTO must expose effective probability");
  assert(service.includes("forecastCategory: nextForecastCategory"), "stored forecast category must be server-derived");
  assert(exportRoute.includes('["COO", "SUPER_ADMIN"]'), "full CRM export must be restricted to COO and super admin");
  assert(exportRoute.includes('"Lead-uri"'), "CRM export must contain a lead sheet");
  assert(exportRoute.includes('"Persoane contact"'), "CRM export must contain a contact sheet");
  assert(exportRoute.includes('"Istoric observatii"'), "CRM export must contain an activity and notes sheet");
  assert(exportRoute.includes('"Observatii vanzator"'), "CRM export must contain seller observations");
  assert(exportRoute.includes('"Valoare oportunitate"'), "CRM export must include the full opportunity value");
  assert(exportRoute.includes('"Sanse de castig (%)"'), "CRM export must include probability separately");
  assert(exportRoute.includes('"Nivel forecast"'), "CRM export must include the derived forecast level");
  assert(schema.includes("forecastCategory"), "CRM schema must store an explicit forecast category");
  assert(schema.includes("taxId             String?"), "CRM schema must store normalized company CUI additively");
  assert(schema.includes("industry          String?"), "CRM schema must store business industry additively");
  assert(forecastMigration.includes("`forecastCategory`"), "CRM migration must add forecast category additively");
  assert(forecastMigration.includes("`taxId`"), "CRM migration must add CUI additively");
  assert(forecastMigration.includes("`industry`"), "CRM migration must add industry additively");
  assert(!forecastMigration.includes("DROP TABLE"), "forecast migration must not drop tables");
  assert(!forecastMigration.includes("DROP COLUMN"), "forecast migration must not drop columns");
  assert(service.includes("alreadyCompleted: true"), "won close must be idempotent");
  assert(service.includes("crmContact.updateMany"), "CRM contacts must link to the client after a win");
  assert(service.includes("Foloseste actiunea Inchide oportunitatea"), "direct won updates must be blocked outside the controlled close flow");
  assert(service.includes("Doar oportunitatile active pot fi inchise"), "lost or inactive opportunities must not be converted to won directly");
  for (const field of ["opportunityName", "qualificationData", "nextStep", "stageChangedAt", "lastActivityAt", "noResponseCount"]) {
    assert(schema.includes(field), `CRM schema must include additive ${field}`);
    assert(migration.includes("`" + field + "`"), `CRM migration must add ${field}`);
  }
  assert(!migration.includes("DROP TABLE"), "CRM migration must not drop tables");
  assert(!migration.includes("DROP COLUMN"), "CRM migration must not drop columns");
}

function row(status, nextFollowUpDate, estimatedValue, currency, probability, expectedCloseDate, updatedAt) {
  return {
    status,
    nextFollowUpDate: nextFollowUpDate ? new Date(`${nextFollowUpDate}T00:00:00.000Z`) : null,
    estimatedValue,
    currency,
    probability,
    forecastCategory: crm.crmForecastCategoryForStatus(status, probability),
    expectedCloseDate: expectedCloseDate ? new Date(`${expectedCloseDate}T00:00:00.000Z`) : null,
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
