import assert from "node:assert/strict";
import { selectSalesAgenda, sortSalesAgenda, type SalesAgendaItem } from "../src/lib/dashboard/sales-agenda";
import { calculateLocationProfit } from "../src/lib/profit";

const make = (id: string, kind: SalesAgendaItem["kind"], dueDate: string): SalesAgendaItem => ({
  id, kind, dueDate, urgency: "critical", title: `Client ${id}`, context: `Urmărire ${id}`, amount: null, currency: null, href: "/admin/crm", actionLabel: "Deschide",
});
const invoices = Array.from({ length: 36 }, (_, index) => make(`invoice-${index}`, "invoice", "2026-11-12T00:00:00Z"));
const call = make("overdue-call", "follow_up", "2026-11-10T09:00:00Z");
const hold = make("expiring-hold", "hold", "2026-11-13T13:00:00Z");
const items = [...invoices, call, hold].sort(sortSalesAgenda);
assert.equal(items[0].id, call.id, "an older overdue call is not hidden behind every invoice solely because of type");
assert.equal(selectSalesAgenda(items, { kind: "follow_up" }).rows[0].id, call.id, "calls remain accessible independently of debt volume");
assert.equal(selectSalesAgenda(items, { kind: "hold" }).rows[0].id, hold.id, "HOLD expiry has its own actionable category");
const seen = new Set<string>();
for (let page = 1; page <= 4; page++) for (const item of selectSalesAgenda(items, { page, pageSize: 12 }).rows) seen.add(item.id);
assert.equal(seen.size, 38, "all items survive pagination, including those previously dropped after the first sixteen");
assert.equal(selectSalesAgenda(items, { query: "OVERDUE-CALL" }).total, 1, "search finds a case-insensitive client or action on later pages");
assert.equal(selectSalesAgenda(items, { kind: "operation" }).total, 0, "empty categories are distinct from an incomplete source");
assert.equal(selectSalesAgenda(items, { page: 999 }).page, 4, "a refresh reducing rows cannot leave an inaccessible page");

const period = { periodStart: new Date("2026-11-01"), periodEnd: new Date("2026-11-30"), reportStart: new Date("2026-11-01"), reportEnd: new Date("2026-11-30") };
const ron = calculateLocationProfit({ ...period, monthlyRevenue: 1000, revenueCurrency: "RON", monthlyCost: 200, costCurrency: "RON" });
assert.equal(ron.revenueCurrency, "RON");
assert.equal(ron.grossProfit, 800, "RON revenue must not be labelled EUR or force an unnecessary conversion");
for (const revenueCurrency of [null, "", "USD"]) {
  const result = calculateLocationProfit({ ...period, monthlyRevenue: 1000, revenueCurrency, monthlyCost: 200, costCurrency: "RON" });
  assert.equal(result.grossProfit, null, "unknown currency cannot manufacture a verified margin");
  assert.equal(result.revenueCurrency, null);
}
const unknownCost = calculateLocationProfit({ ...period, monthlyRevenue: 1000, revenueCurrency: "RON", monthlyCost: 200, costCurrency: null });
assert.equal(unknownCost.grossProfit, null, "an unlabelled cost is not silently converted to revenue currency");
console.log(JSON.stringify({ ok: true, groups: 9, scope: "sales queue visibility, pagination, deterministic priority and honest currencies" }));
