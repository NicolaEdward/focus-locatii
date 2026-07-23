const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
const page = read("src", "app", "admin", "dashboard", "page.tsx");
const dispatcher = read("src", "lib", "dashboard", "role-dashboard.ts");
const executiveService = read("src", "lib", "dashboard", "executive", "overview.ts");
const executiveContracts = read("src", "lib", "dashboard", "executive", "contracts.ts");
const executivePulse = read("src", "lib", "dashboard", "executive", "pulse.ts");
const executive = read("src", "components", "admin", "ExecutiveCommandCenter.tsx");
const cooService = read("src", "lib", "dashboard", "coo-dashboard.ts");
const salesService = read("src", "lib", "dashboard", "sales-dashboard.ts");
const coo = read("src", "components", "admin", "CooCommandCenter.tsx");
const sales = read("src", "components", "admin", "SalesCommandCenter.tsx");
const financePage = read("src", "app", "admin", "financiar", "incasari", "page.tsx");
const clientsPage = read("src", "app", "admin", "clienti", "page.tsx");

assert(page.includes("getRoleDashboardData"), "dashboard route must load role-specific DTOs");
assert(dispatcher.includes('["COO", "D_CEO", "SUPER_ADMIN"]'), "COO, D-CEO and SUPER_ADMIN must receive Executive Overview");
assert(dispatcher.includes("getExecutiveOverview(session, input)"), "executive roles must use Executive Overview V2");
assert(dispatcher.includes('["SALES_AGENT", "SALES_DIRECTOR"]'), "sales roles must receive the sales agenda");
assert(!dispatcher.includes("getDashboardData"), "active roles must not execute the heavy legacy dashboard service");
assert(dispatcher.includes("export { getCooDashboardData }"), "the previous COO service must remain an explicit transitional fallback");

assert(executiveContracts.includes('EXECUTIVE_TIME_ZONE = "Europe/Bucharest"'), "executive periods must use Europe/Bucharest");
assert(executiveContracts.includes("queryBudget: number"), "the DTO must publish its query budget");
assert(executivePulse.includes("EXECUTIVE_PULSE_WEIGHTS"), "Company Pulse must use the approved weighted contract");
assert(executivePulse.includes("totalConfidence >= 75"), "Company Pulse must require the approved total confidence");
assert(
  executivePulse.includes("criticalConfidence.finance") &&
  executivePulse.includes("criticalConfidence.operations") &&
  executivePulse.includes("criticalConfidence.campaigns"),
  "critical domains must gate the general score"
);
assert(executiveService.includes("prisma.financialReceivable.findMany"), "executive finance must use the canonical invoice registry");
assert(executiveService.includes("includedInReport: true") && executiveService.includes("needsReview: false"), "executive finance must use validated invoices");
assert(executiveService.includes("isEffectiveHold"), "executive HOLD counts must use effective expiry");
assert(executiveService.includes("decideAvailability"), "executive inventory must use canonical availability");
assert(executiveService.includes("sum !== partition.total"), "inventory categories must be disjoint and exhaustive");
assert(!executiveService.includes("prisma.mediaPlan"), "executive dashboard must not query inactive Media Plan");
assert(!executiveService.includes(".create(") && !executiveService.includes(".update(") && !executiveService.includes(".delete("), "Executive Overview load must remain read-only");
assert(executive.includes("Company Pulse") && executive.includes("Executive Alerts preview") && executive.includes("Business Bottlenecks preview"), "the approved Executive Overview hierarchy must be present");
assert(executive.includes("HOLD-uri active") && executive.includes("BOOKED-uri active"), "the operational snapshot must remain directly below the first viewport");
assert(executive.includes("Decor") && executive.includes("Neutraliz"), "today operational KPIs must be present");
assert(executive.includes("asOf") && executive.includes("stale"), "executive widgets must expose freshness");
assert(executive.includes('name="entity"') && executive.includes('name="snapshot"'), "executive scope filters must be present");
assert(!executive.includes('method: "POST"') && !executive.includes("fetch("), "Executive Overview must not mutate or trigger client-side writes");
assert(!coo.includes("SmartBillDashboard") && !coo.includes("FinancialDashboardPanel"), "the transitional COO fallback must remain free of legacy finance widgets");
assert(!cooService.includes("prisma.mediaPlan"), "the fallback service must remain free of Media Plan");

assert(sales.includes("Agenda mea"), "sales dashboard must lead with the daily agenda");
assert(sales.includes("Scaden") && sales.includes("Follow-up-uri") && sales.includes("Campaniile mele"), "sales workflow sections must be present");
assert(!sales.includes("Facturat companie") && !sales.includes("Venit global"), "regular sales dashboard must not expose company-wide finance totals");
assert(salesService.includes("accountOwnerUserId: ownerId"), "seller invoice ownership must be explicit");
assert(salesService.includes("sellerUserId: ownerId"), "seller campaign ownership must be explicit");
assert(salesService.includes("AND: [") && salesService.includes("campaignOwnership"), "campaign date filters must not override ownership filters");
assert(!salesService.includes("prisma.mediaPlan"), "sales agenda must not depend on Media Plan");
assert(salesService.includes("effectiveHoldWhere(now)"), "sales agenda must exclude expired HOLDs at query time");
assert(!salesService.includes("addUtcDays(row.createdAt, 14)"), "sales agenda must use the five-day canonical HOLD fallback");
assert(!salesService.includes("create(") && !salesService.includes("update("), "sales dashboard load must remain read-only");
assert(salesService.includes("/admin/clienti?tab=invoices"), "sales invoices must link to the role-safe client workspace");

assert(financePage.includes("params.status") && financePage.includes("initialFilters={filters}"), "executive finance links must initialize the invoice workspace");
assert(clientsPage.includes("params.tab") && clientsPage.includes("initialPortfolioFinance={initialPortfolioFinance}"), "sales invoice links must open the lazy portfolio finance view");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "role-specific dashboard dispatcher",
    "Executive Overview V2 contract",
    "Company Pulse confidence gate",
    "disjoint canonical inventory",
    "read-only executive command center",
    "conservative seller ownership",
    "daily sales agenda",
    "actionable filtered links",
    "no Media Plan activation"
  ]
}, null, 2));
