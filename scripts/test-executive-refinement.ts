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
assert(component.includes("Widgeturile nu pot fi eliminate"));
assert(search.includes('role="combobox"') && search.includes('aria-controls="executive-search-results"'));

for (const route of ["people", "customers", "activity", "search"]) {
  const source = read(`src/app/api/admin/executive/${route}/route.ts`);
  assert(source.includes('requirePermission(request, "dashboard.executive.view")'));
  assert(source.includes('"cache-control": "private, no-store"'));
}

console.log(JSON.stringify({
  ok: true,
  checks: 31,
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
