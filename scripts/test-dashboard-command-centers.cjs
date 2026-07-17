const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
const page = read("src", "app", "admin", "dashboard", "page.tsx");
const dispatcher = read("src", "lib", "dashboard", "role-dashboard.ts");
const cooService = read("src", "lib", "dashboard", "coo-dashboard.ts");
const salesService = read("src", "lib", "dashboard", "sales-dashboard.ts");
const coo = read("src", "components", "admin", "CooCommandCenter.tsx");
const sales = read("src", "components", "admin", "SalesCommandCenter.tsx");
const financePage = read("src", "app", "admin", "financiar", "incasari", "page.tsx");
const clientsPage = read("src", "app", "admin", "clienti", "page.tsx");

assert(page.includes("getRoleDashboardData"), "dashboard route must load role-specific DTOs");
assert(dispatcher.includes('["COO", "SUPER_ADMIN"]'), "COO and SUPER_ADMIN must receive the executive command center");
assert(dispatcher.includes('["SALES_AGENT", "SALES_DIRECTOR"]'), "sales roles must receive the sales agenda");
assert(!dispatcher.includes("getDashboardData"), "active roles must not execute the heavy legacy dashboard service");

assert(cooService.includes("prisma.financialReceivable.groupBy"), "COO finance KPIs must use aggregate queries");
assert(cooService.includes("includedInReport: true, needsReview: false"), "COO finance must use canonical validated invoices");
assert(cooService.includes("take: 20"), "COO attention rows must be limited");
assert(!cooService.includes("prisma.mediaPlan"), "dashboard must not query the inactive Media Plan model");
assert(!cooService.includes("operationTaskReadsEnabled"), "dashboard must not enable or query disabled OperationTask reads");
assert(cooService.includes("effectiveHoldWhere(now)"), "COO active HOLD count must use the canonical exact-expiry rule");
assert(cooService.includes("row.periodStart <= today && row.periodEnd >= today"), "COO current occupancy must not count future HOLD periods");
assert(!coo.includes("SmartBillDashboard"), "COO must not render legacy SmartBill widgets");
assert(!coo.includes("FinancialDashboardPanel"), "COO must not render the import/report dashboard");
assert(!coo.includes("Creanțe"), "COO must use Facturi clienți terminology");
assert(!coo.includes("MediaPlan"), "COO must not show fake Media Plan pipeline metrics");
assert(coo.includes("Rezumat executiv") && coo.includes("Atenție azi") && coo.includes("Decizii recomandate"), "COO command-center hierarchy must be present");
assert(coo.includes("?status=overdue") && coo.includes("?status=due_soon"), "finance KPI cards must have filtered actions");
assert(!coo.includes('method: "POST"') && !coo.includes('fetch("/api/admin/command-center"'), "COO dashboard must not mutate business data");

assert(sales.includes("Agenda mea"), "sales dashboard must lead with the daily agenda");
assert(sales.includes("Scadențe clienții mei") && sales.includes("Follow-up-uri") && sales.includes("Campaniile mele"), "sales workflow sections must be present");
assert(!sales.includes("Facturat companie") && !sales.includes("Venit global"), "regular sales dashboard must not expose company-wide finance totals");
assert(salesService.includes("accountOwnerUserId: ownerId"), "seller invoice ownership must be explicit");
assert(salesService.includes("sellerUserId: ownerId"), "seller campaign ownership must be explicit");
assert(salesService.includes("AND: [") && salesService.includes("campaignOwnership"), "campaign date filters must not override ownership filters");
assert(!salesService.includes("prisma.mediaPlan"), "sales agenda must not depend on Media Plan");
assert(salesService.includes("effectiveHoldWhere(now)"), "sales agenda must exclude expired HOLDs at query time");
assert(!salesService.includes("addUtcDays(row.createdAt, 14)"), "sales agenda must use the five-day canonical HOLD fallback");
assert(!salesService.includes("create(") && !salesService.includes("update("), "sales dashboard load must remain read-only");
assert(salesService.includes("/admin/clienti?tab=invoices"), "sales invoices must link to the role-safe client workspace");

assert(financePage.includes("params.status") && financePage.includes("initialFilters={filters}"), "COO filtered finance links must initialize the invoice workspace");
assert(clientsPage.includes("params.tab") && clientsPage.includes("initialTab={initialTab}"), "sales links must open the requested client workspace tab");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "role-specific dashboard dispatcher",
    "canonical aggregate COO finance",
    "read-only executive command center",
    "conservative seller ownership",
    "daily sales agenda",
    "actionable filtered links",
    "no Media Plan or OperationTask activation"
  ]
}, null, 2));
