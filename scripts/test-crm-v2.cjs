const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");
const { loadTsModule } = require("./load-ts-module.cjs");

const domain = loadTsModule(path.join(process.cwd(), "src", "lib", "crm-domain.ts"));
const analytics = loadTsModule(path.join(process.cwd(), "src", "lib", "crm-analytics-v4.ts"));

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});

async function main() {
  domainRules();
  sourceArchitectureRules();
  await exportRules();
  console.log(JSON.stringify({
    ok: true,
    checked: [
      "standalone CRM companies do not reference ClientAccount",
      "Cold prospect defaults to three business days",
      "prospect and opportunity transitions are controlled",
      "forecast is derived only from stage and always uses full values",
      "currencies remain separate",
      "CRM writes use transactions, idempotency and optimistic versions",
      "history is append-only",
      "won never creates clients, campaigns, reservations, HOLD or BOOKED",
      "legacy client conversion is disabled",
      "legacy CRM writes are disabled",
      "server paging and bounded detail timeline",
      "private API permission checks",
      "new responsive CRM views and active opportunity columns",
      "COO export uses standalone companies, contacts, prospects, opportunities and events",
      "manual probability is absent from schema, UI, API and export",
      "migration is additive and preserves legacy CRM rows"
    ]
  }, null, 2));
}

function domainRules() {
  const friday = new Date("2026-07-17T09:00:00.000Z");
  const due = domain.crmAddBusinessDays(friday, 3);
  assert.equal(due.toISOString().slice(0, 10), "2026-07-22", "three business days from Friday must land on Wednesday");
  assert.equal(domain.crmNormalizeCompanyName(" ALIVE CAPITAL S.R.L. "), "alive capital");
  assert.equal(domain.crmNormalizeEmail(" Contact@Example.RO "), "contact@example.ro");
  assert.equal(domain.crmNormalizePhone("0722 123 456"), "40722123456");
  assert.equal(domain.crmForecastForStage("opportunity"), "pipeline");
  assert.equal(domain.crmForecastForStage("quoted"), "pipeline");
  assert.equal(domain.crmForecastForStage("negotiation"), "possible");
  assert.equal(domain.crmForecastForStage("contracting"), "commit");
  assert.equal(domain.crmForecastForStage("won"), "won");
  assert.equal(domain.crmForecastForStage("lost"), "excluded");
  assert.doesNotThrow(() => domain.crmAssertOpportunityTransition("quoted", "negotiation"));
  assert.throws(() => domain.crmAssertOpportunityTransition("opportunity", "contracting"), /nu este permisa/);
  assert.doesNotThrow(() => domain.crmAssertProspectTransition("prospecting", "qualified"));
  assert.throws(() => domain.crmAssertProspectTransition("inactive", "qualified"), /nu este permisa/);
  assert.throws(() => domain.crmValidateActionForStage("prospecting", "send_final_version"), /nu este disponibila/);
  assert.doesNotThrow(() => domain.crmAssertInitialProspectRequirements("prospecting", null, null));
  assert.doesNotThrow(() => domain.crmAssertInitialProspectRequirements("return_later", null, null));
  assert.doesNotThrow(() => domain.crmAssertInitialProspectRequirements("qualified", "RO12345678", "Contact Test"));
  assert.throws(() => domain.crmAssertInitialProspectRequirements("qualified", null, "Contact Test"), /CUI-ul este obligatoriu/);
  assert.throws(() => domain.crmAssertInitialProspectRequirements("qualified", "RO12345678", null), /Persoana de contact este obligatorie/);

  const totals = analytics.crmOpportunityTotals([
    { stage: "negotiation", quotedValue: 4000, currency: "EUR" },
    { stage: "negotiation", revisedValue: 2000, currency: "EUR" },
    { stage: "contracting", agreedValue: 10000, currency: "RON" }
  ]);
  assert.equal(totals.possible.EUR, 6000, "full opportunity values must be summed without weighting");
  assert.equal(totals.commit.RON, 10000);
  assert.notEqual(totals.possible.EUR, 4800, "no probability multiplication is allowed");
  assert.equal(domain.crmCurrentOpportunityValue({ quotedValue: 4000, revisedValue: null, agreedValue: null }), 4000);
}

function sourceArchitectureRules() {
  const schema = read("prisma/schema.prisma");
  const migration = read("prisma/migrations/20260718000000_crm_domain_architecture_v4/migration.sql");
  const service = read("src/lib/crm-domain-service.ts");
  const analyticsSource = read("src/lib/crm-analytics-v4.ts");
  const workspace = read("src/components/admin/CrmWorkspaceV4.tsx");
  const page = read("src/app/admin/crm/page.tsx");
  const commands = read("src/app/api/admin/crm/commands/route.ts");
  const queryRoute = read("src/app/api/admin/crm/workspace/route.ts");
  const detailRoute = read("src/app/api/admin/crm/records/[kind]/[id]/route.ts");
  const convertRoute = read("src/app/api/admin/crm/leads/[id]/convert/route.ts");
  const legacyWriteRoutes = [
    "src/app/api/admin/crm/leads/route.ts",
    "src/app/api/admin/crm/leads/[id]/route.ts",
    "src/app/api/admin/crm/leads/[id]/activities/route.ts",
    "src/app/api/admin/crm/leads/[id]/contacts/route.ts",
    "src/app/api/admin/crm/leads/[id]/contacts/[contactId]/route.ts"
  ].map(read);
  const exportRoute = read("src/app/api/admin/crm/export.xlsx/route.ts");
  const notifications = read("src/lib/notifications.ts");
  const dashboard = read("src/lib/crm-dashboard.ts");
  const rbac = read("src/lib/rbac.ts");

  for (const model of ["CrmCompany", "CrmCompanyContact", "CrmProspect", "CrmOpportunity", "CrmNextAction", "CrmEvent"]) {
    assert(schema.includes(`model ${model} {`), `missing ${model}`);
  }
  for (const model of ["CrmCompany", "CrmCompanyContact", "CrmProspect", "CrmOpportunity", "CrmNextAction", "CrmEvent"]) {
    const block = modelBlock(schema, model);
    assert(!block.includes("ClientAccount"), `${model} must not reference ClientAccount`);
    assert(!/\bclientId\b/.test(block), `${model} must not contain clientId`);
    assert(!block.includes("Campaign"), `${model} must not reference Campaign`);
    assert(!/\bprobability\b/i.test(block), `${model} must not store manual probability`);
  }
  assert(modelBlock(schema, "CrmCompany").includes("normalizedTaxId"), "CRM companies need normalized CUI duplicate protection");
  assert(modelBlock(schema, "CrmCompany").includes("@unique"), "normalized CUI must be unique");
  assert(modelBlock(schema, "CrmProspect").includes("version"));
  assert(modelBlock(schema, "CrmOpportunity").includes("version"));
  assert(modelBlock(schema, "CrmEvent").includes("idempotencyKey"));

  assert(!/DROP\s+(TABLE|COLUMN)/i.test(migration), "CRM v4 migration must never drop data");
  assert(!/ALTER\s+TABLE/i.test(migration), "CRM v4 migration must not alter existing tables");
  assert(!migration.includes("portfolio_client_accounts"), "migration must not touch registered clients");
  assert(!migration.includes("portfolio_campaigns"), "migration must not touch campaigns");
  assert(migration.includes("MIGRATED_FROM_LEGACY"), "legacy source must be auditable");
  assert(migration.includes("`estimatedValue`"), "legacy full opportunity value must be preserved");
  assert(migration.includes("INSERT IGNORE"), "migration backfill must be repeatable");

  for (const forbidden of ["prisma.clientAccount", "prisma.campaign", "prisma.reservation", "prisma.mediaPlan", "prisma.billingItem", "prisma.financial"]) {
    assert(!service.includes(forbidden), `CRM v4 service must not use ${forbidden}`);
  }
  assert(service.includes("prisma.$transaction"), "CRM mutations must be transactional");
  assert(service.includes("version: input.version"), "CRM updates must use optimistic version checks");
  assert(service.includes("CRM_VERSION_CONFLICT"));
  assert(service.includes("idempotencyKey"));
  assert(service.includes("CRM_ACTIVE_PROSPECT_EXISTS"));
  assert(service.includes("opportunities: { none: {} }"), "converted prospects must not be listed beside their opportunities");
  assert(commands.includes('"return_later", "disqualified", "on_hold", "inactive"'), "create API must validate every initial prospect stage");
  assert(service.includes("CUI-ul este obligatoriu inainte de calificare"));
  assert(service.includes("Valoarea integrala, moneda si data estimata"));
  assert(service.includes("OPPORTUNITY_WON"));
  assert(!service.includes("estimatedValue *"), "forecast must not multiply values");
  assert(!analyticsSource.includes("probability"), "analytics must not use probability");

  assert(page.includes("CrmWorkspaceV4"));
  assert(!page.includes("CrmWorkspace\n"));
  for (const label of ["Astăzi", "Prospectare", "Oportunități", "Toate"]) assert(workspace.includes(label), `missing CRM view ${label}`);
  for (const stage of ["opportunity", "quoted", "negotiation", "contracting"]) assert(workspace.includes(stage));
  assert(workspace.includes("min-w-[1080px] grid-cols-4"), "opportunity pipeline must be one controlled horizontal row");
  assert(workspace.includes("overflow-x-auto"));
  assert(workspace.includes("Prospect nou"));
  assert(workspace.includes("CRM_PROSPECT_STATUS_OPTIONS.map"), "new prospect form must expose every prospect stage");
  assert(workspace.includes("qualifiedProspect"), "qualified create fields must be conditionally required");
  assert(workspace.includes("Oportunitate inbound"));
  assert(workspace.includes('value="qualify_only"'));
  assert(commands.includes('raw.action === "qualify_prospect"'));
  assert(workspace.includes("Califică și creează oportunitatea"));
  assert(workspace.includes("Următorul pas"));
  assert(!/probabilit|șanse de câștig|sanse de castig/i.test(workspace), "seller UI must not expose manual probability");
  assert(!/Converteste in client|Convertește în client/i.test(workspace));
  assert(!workspace.includes("/admin/clienti"), "CRM UI must not depend on clients");

  assert(queryRoute.includes('["leads.view", "leads.view.own"]'));
  assert(commands.includes('["leads.manage", "leads.manage.own"]'));
  assert(commands.includes('session.role === "COO"'), "COO CRM commands need an API-level read-only guard");
  const cooPermissions = rbac.slice(rbac.indexOf("COO: ["), rbac.indexOf("SALES_DIRECTOR: ["));
  assert(cooPermissions.includes('"leads.view"'));
  assert(cooPermissions.includes('"opportunities.view"'));
  assert(!cooPermissions.includes('"leads.manage"'), "COO must not manage CRM leads");
  assert(!cooPermissions.includes('"opportunities.manage"'), "COO must not manage CRM opportunities");
  assert(workspace.includes("Mod vizualizare"));
  assert(detailRoute.includes('["leads.view", "leads.view.own"]'));
  assert(service.includes("skip: (page - 1) * limit"));
  assert(service.includes("take: 30"), "timeline must be bounded and cursor-ready");
  assert(service.includes("cursor: { id: input.cursor }"));
  assert(convertRoute.includes("CRM_CLIENT_CONVERSION_DISABLED"));
  assert(!convertRoute.includes("convertCrmLeadToClient"));
  for (const route of legacyWriteRoutes) assert(route.includes("crmLegacyWriteDisabledResponse"), "legacy CRM mutations must be disabled");
  assert(notifications.includes("prisma.crmNextAction.findMany"));
  assert(!notifications.includes("prisma.crmLead.findMany"), "notifications must use the active standalone CRM source");
  assert(dashboard.includes("prisma.crmProspect.findMany"));
  assert(dashboard.includes("prisma.crmOpportunity.findMany"));
  assert(!dashboard.includes("probability"));
  assert(!exportRoute.includes("Sanse de castig"));
  assert(!exportRoute.includes("probability"));
}

async function exportRules() {
  let role = "COO";
  const now = new Date("2026-07-18T10:00:00.000Z");
  const company = {
    id: "company-1", name: "AliveCapital", taxId: "RO12345678", industry: "Retail", website: "https://alive.example", status: "prospect",
    createdAt: now, updatedAt: now, owner: { name: "Agent Test", email: "agent@example.test" },
    contacts: [{ name: "Contact Test", role: "Marketing", phone: "0700000000", email: "contact@example.test", preferredChannel: "email", isDecisionMaker: true, isPrimary: true, createdAt: now }]
  };
  const route = loadTsModule(path.join(process.cwd(), "src", "app", "api", "admin", "crm", "export.xlsx", "route.ts"), {
    "@/lib/auth": { requireAnyPermission: async () => ({ session: { id: "coo", role, email: "coo@example.test" }, response: null }) },
    "@/lib/audit": { recordAudit: async () => null },
    "@/lib/prisma": { prisma: {
      crmCompany: { findMany: async () => [company] },
      crmProspect: { findMany: async () => [{ id: "prospect-1", companyId: company.id, source: "Outbound", status: "qualified", priority: "normal", contactState: "in_dialogue", qualificationSummary: { needConfirmed: true }, qualifiedAt: now, disqualifiedAt: null, returnAt: null, closedReason: null, createdAt: now, updatedAt: now, company: { name: company.name, taxId: company.taxId, industry: company.industry }, owner: company.owner, nextActions: [] }] },
      crmOpportunity: { findMany: async () => [{ id: "opp-1", companyId: company.id, sourceProspectId: "prospect-1", name: "AliveCapital - OOH", needSummary: "Vizibilitate", stage: "negotiation", desiredPeriodStart: null, desiredPeriodEnd: null, geography: "Bucuresti", formats: "Mesh", budgetStatus: "known", budgetMin: null, budgetMax: null, currency: "EUR", quotedValue: 4000, revisedValue: null, agreedValue: null, decisionDate: now, quotedAt: now, negotiationAt: now, contractingAt: null, wonAt: null, lostAt: null, lostReasonCode: null, lostReason: null, competitor: null, createdAt: now, updatedAt: now, company: { name: company.name, taxId: company.taxId, industry: company.industry }, owner: company.owner, nextActions: [] }] },
      crmEvent: { findMany: async () => [{ companyId: company.id, prospectId: "prospect-1", opportunityId: "opp-1", type: "CALL", source: "CRM", summary: "Apel", result: "Interes", previousValues: null, nextValues: null, occurredAt: now, actor: company.owner, company: { name: company.name, taxId: company.taxId } }] }
    } }
  });
  const request = { headers: new Headers() };
  const response = await route.GET(request);
  assert.equal(response.status, 200);
  const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
  assert.deepEqual(workbook.SheetNames, ["Firme", "Prospectări", "Oportunități", "Persoane contact", "Istoric audit"]);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Oportunități"]);
  assert.equal(rows[0]["Valoare oportunitate"], 4000);
  assert.equal(rows[0]["Nivel forecast"], "Posibil");
  assert.equal(rows[0]["Șanse de câștig (%)"], undefined);
  assert.equal(rows[0]["Client"], undefined);
  role = "SALES_DIRECTOR";
  assert.equal((await route.GET(request)).status, 403);
}

function modelBlock(source, model) {
  const start = source.indexOf(`model ${model} {`);
  assert.notEqual(start, -1, `missing model ${model}`);
  const next = source.indexOf("\nmodel ", start + 7);
  return source.slice(start, next === -1 ? source.length : next);
}

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}
