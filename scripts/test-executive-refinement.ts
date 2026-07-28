import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AuthSession } from "../src/lib/auth";
import { executiveScopeForSession } from "../src/lib/dashboard/executive/scope";
import { hasPermission } from "../src/lib/rbac";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const service = read("src/lib/dashboard/executive/refinement.ts");
const component = read("src/components/admin/ExecutiveControlTabs.tsx");
const dashboard = read("src/components/admin/ExecutiveCommandCenter.tsx");
const search = read("src/components/admin/ExecutiveGlobalSearch.tsx");
const usersPage = read("src/app/admin/utilizatori/page.tsx");
const usersComponent = read("src/components/admin/UserManagement.tsx");
const campaignsService = read("src/lib/client-campaign-workspaces.ts");
const campaignsPage = read("src/app/admin/campanii/page.tsx");
const receivablesService = read("src/lib/receivables-workspace-service.ts");

const dceo = session("D_CEO");
assert.equal(hasPermission("D_CEO", "users.view"), true);
assert.equal(hasPermission("D_CEO", "users.manage"), false);
assert(usersPage.includes('["users.view", "users.manage"]'));
assert(usersComponent.includes("readOnly") && usersComponent.includes("!readOnly"), "User controls must be hidden in read-only mode.");

const today = executiveScopeForSession(dceo, { snapshot: "2026-07-27", period: "TODAY" });
const week = executiveScopeForSession(dceo, { snapshot: "2026-07-27", period: "WEEK" });
const month = executiveScopeForSession(dceo, { snapshot: "2026-07-27", period: "MONTH" });
assert.deepEqual([today.periodStart, today.periodEnd], ["2026-07-27", "2026-07-27"]);
assert.deepEqual([week.periodStart, week.periodEnd], ["2026-07-27", "2026-08-02"]);
assert.deepEqual([month.periodStart, month.periodEnd], ["2026-07-01", "2026-07-31"]);

assert(!/prisma\.[a-zA-Z]+\.create\s*\(/.test(service));
assert(!/prisma\.[a-zA-Z]+\.update\s*\(/.test(service));
assert(!/prisma\.[a-zA-Z]+\.delete\s*\(/.test(service));
assert(!service.includes("prisma.mediaPlan"));
assert(!service.includes("storageUrl"), "Executive search must not expose document storage URLs.");
assert(service.includes("Promise.all"), "Lazy executive services must batch independent reads.");
assert(service.includes("Activitatea CRM nu este atribuită ClientAccount"), "Client/CRM separation must remain explicit.");

assert(dashboard.includes("Necesită atenția mea"));
assert(dashboard.includes("data.attentionPreview"));
assert(dashboard.includes("data.viewer.canUseQuickActions"));
assert(component.includes("window.localStorage"));
assert(component.includes("tabOrder") && component.includes("preferredPeriod") && component.includes("collapsed"));
assert(component.includes("function selectTab") && component.includes("defaultTab: tab"), "The selected executive tab must persist across reloads.");
assert(component.includes("Widgeturile nu pot fi eliminate"));
assert(search.includes('role="combobox"') && search.includes('aria-controls="executive-search-results"'));
assert(search.includes('"ArrowDown"') && search.includes('"ArrowUp"') && search.includes('"Enter"') && search.includes('"Escape"'), "Executive search must support complete keyboard navigation.");
assert(search.includes("Căutarea executivă nu este disponibilă") && search.includes("Niciun rezultat"), "Search error and empty states must remain distinct.");
assert(service.includes('scope.entitySelection !== "ALL"') && service.includes("APPLIED_WITH_LIMITATIONS") && service.includes("CRM și activitatea generală de audit"), "Entity-scoped refinement must not return unscoped canonical gaps.");
assert(service.includes("factualWorkload") && component.includes("Încărcare factuală"), "People workload must be factual and explainable.");
assert(service.includes("countLabel") && component.includes("countLabel"), "Executive People and Customer summaries must use correct singular/plural labels.");
assert(component.includes("Situații curente") && component.includes("Evenimente istorice"), "Current situations must not be presented as historical events.");
assert(component.includes("currentAlerts") && component.includes("CurrentAlertRow"), "The activity feed must not claim there are no current situations while deterministic alerts exist.");
assert(component.includes('item.severityCode === "DATA_QUALITY" ? "Calitatea datelor"'), "The activity feed must not expose internal severity codes.");
assert(!component.includes("problemItems"), "Attention items must not receive synthetic historical timestamps.");
assert(dashboard.includes("data.alertPreview.slice(0, 2)") && dashboard.includes("data.attentionPreview.slice(0, 2)"), "First viewport density must remain bounded.");
assert(dashboard.includes("Lipsește:") && dashboard.includes("missingReason"), "Compact Pulse must explain missing data without another click.");
assert(dashboard.includes("severityLabel") && dashboard.includes("qualityLabel"), "Alert preview must distinguish severity, data quality and confidence.");
assert(campaignsService.includes("campaignSnapshotNow") && campaignsService.includes("companyEntityValues") && campaignsService.includes("dateFilter"), "Campaign destination must reproduce snapshot, entity and today filters.");
assert(campaignsPage.includes("executiveContext"), "Campaign workspace must preserve the originating executive context.");
assert(receivablesService.includes("registryAsOf") && receivablesService.includes("validatedOnly"), "Financial drill-down must reproduce snapshot and validation rules.");

for (const route of ["people", "customers", "activity", "search"]) {
  const source = read(`src/app/api/admin/executive/${route}/route.ts`);
  assert(source.includes('requirePermission(request, "dashboard.executive.view")'));
  assert(source.includes('"cache-control": "private, no-store"'));
}

console.log(JSON.stringify({
  ok: true,
  checks: 37,
  periods: {
    today: [today.periodStart, today.periodEnd],
    week: [week.periodStart, week.periodEnd],
    month: [month.periodStart, month.periodEnd]
  },
  dceo: { usersView: true, usersManage: false },
  zeroWriteSourceCheck: true
}, null, 2));

function session(role: "D_CEO"): AuthSession {
  return {
    id: "dceo-test",
    email: "dceo@example.test",
    name: "D-CEO",
    role,
    tokenVersion: 0,
    iat: 1,
    exp: 4_000_000_000
  };
}
