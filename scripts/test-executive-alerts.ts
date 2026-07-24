import assert from "node:assert/strict";
import fs from "node:fs";
import {
  alertFingerprint,
  businessDaysBetween,
  campaignRiskSeverity,
  dedupeExecutiveAlerts,
  filterAlerts,
  holdExpirySeverity,
  isOverdueReceivable,
  makeAlert,
  receivableAgingSeverity,
  summarizeAlerts
} from "../src/lib/dashboard/executive/alerts";
import {
  executiveAlertCacheContext,
  executiveAlertFilters,
  executiveAlertsCacheKey
} from "../src/lib/dashboard/executive/alerts-scope";
import { executiveScopeForSession } from "../src/lib/dashboard/executive/scope";
import type { AuthSession } from "../src/lib/auth";

const fingerprint = alertFingerprint("OVERDUE_RECEIVABLE", "financial_receivable", "invoice-1", "due:2026-06-01");
assert.equal(fingerprint, alertFingerprint("OVERDUE_RECEIVABLE", "financial_receivable", "invoice-1", "due:2026-06-01"));
assert.notEqual(fingerprint, alertFingerprint("OVERDUE_RECEIVABLE", "financial_receivable", "invoice-2", "due:2026-06-01"));

assert.equal(receivableAgingSeverity(1), "P2");
assert.equal(receivableAgingSeverity(30), "P2");
assert.equal(receivableAgingSeverity(31), "P1");
assert.equal(receivableAgingSeverity(90), "P1");
assert.equal(receivableAgingSeverity(91), "P0");
assert.equal(holdExpirySeverity(72), "P2");
assert.equal(holdExpirySeverity(24), "P1");
assert.equal(holdExpirySeverity(0), null);
assert.equal(holdExpirySeverity(73), null);
assert.equal(campaignRiskSeverity("ACTIVE", 20), "P0");
assert.equal(campaignRiskSeverity("SCHEDULED", 1), "P0");
assert.equal(campaignRiskSeverity("SCHEDULED", 3), "P1");
assert.equal(campaignRiskSeverity("SCHEDULED", 7), "P2");
assert.equal(businessDaysBetween("2026-07-17", "2026-07-20"), 1, "Weekend days must not inflate CRM delay.");

const snapshot = new Date("2026-07-24T00:00:00.000Z");
assert.equal(isOverdueReceivable({
  includedInReport: true,
  needsReview: false,
  remainingAmount: "100.00",
  dueDate: new Date("2026-07-23T00:00:00.000Z"),
  snapshotDate: snapshot
}), true);
assert.equal(isOverdueReceivable({
  includedInReport: true,
  needsReview: false,
  remainingAmount: "0.01",
  dueDate: new Date("2026-07-23T00:00:00.000Z"),
  snapshotDate: snapshot
}), false, "A settled invoice must disappear when the predicate becomes false.");
assert.equal(isOverdueReceivable({
  includedInReport: true,
  needsReview: true,
  remainingAmount: "100.00",
  dueDate: new Date("2026-07-23T00:00:00.000Z"),
  snapshotDate: snapshot
}), false);

const first = sampleAlert({
  entityId: "invoice-1",
  currency: "RON",
  amount: "100.00",
  responsibleUserId: "owner-1",
  responsibleLabel: "Owner One"
});
const duplicate = { ...first, sourceRefs: [...first.sourceRefs, { id: "source-2", label: "Sursa 2", href: "/two" }] };
const eur = sampleAlert({ entityId: "invoice-2", currency: "EUR", amount: "80.00" });
const deduped = dedupeExecutiveAlerts([first, duplicate, eur]);
assert.equal(deduped.length, 2);
assert.equal(deduped.find((row) => row.entityId === "invoice-1")?.sourceRefs.length, 2);
assert.equal(deduped[0].impact.currency, "RON");
assert.equal(deduped[1].impact.currency, "EUR", "RON and EUR must remain separate impacts.");

assert.equal(filterAlerts(deduped, {
  severity: "P2",
  domain: "ALL",
  owner: "",
  dataQuality: "ALL",
  ruleType: "ALL"
}).length, 2);
assert.equal(filterAlerts(deduped, {
  severity: "ALL",
  domain: "FINANCE",
  owner: "owner-1",
  dataQuality: "HIGH",
  ruleType: "OVERDUE_RECEIVABLE"
}).length, 1);
assert.equal(filterAlerts(deduped, {
  severity: "ALL",
  domain: "ALL",
  owner: "UNASSIGNED",
  dataQuality: "ALL",
  ruleType: "ALL"
}).length, 1);
assert.deepEqual(summarizeAlerts(deduped).bySeverity, { P0: 0, P1: 0, P2: 2, DATA_QUALITY: 0 });

const dceo = session("D_CEO");
assert.equal(executiveAlertFilters({}).limit, 50, "Lipsa parametrului limit trebuie să folosească valoarea implicită 50.");
const scope = executiveScopeForSession(dceo, { entity: "FOCUS_MEDIA", snapshot: "2026-07-24" });
const defaultFilters = executiveAlertFilters({});
const financeFilters = executiveAlertFilters({ severity: "P1", domain: "FINANCE", owner: "owner-1", dataQuality: "HIGH", cursor: "b2Zmc2V0OjUw", limit: "50" });
const defaultKey = executiveAlertsCacheKey(executiveAlertCacheContext(scope, defaultFilters));
const filteredKey = executiveAlertsCacheKey(executiveAlertCacheContext(scope, financeFilters));
assert.notEqual(defaultKey, filteredKey, "Filters, owner and cursor must isolate alert cache entries.");
const cooKey = executiveAlertsCacheKey(executiveAlertCacheContext(executiveScopeForSession(session("COO"), { entity: "FOCUS_MEDIA", snapshot: "2026-07-24" }), defaultFilters));
assert.notEqual(defaultKey, cooKey, "Role and permission hash must isolate alert cache entries.");

const service = read("src/lib/dashboard/executive/alerts.ts");
const route = read("src/app/api/admin/executive/alerts/route.ts");
const component = read("src/components/admin/ExecutiveAlertsPanel.tsx");
const overview = read("src/lib/dashboard/executive/overview.ts");
assert.match(route, /requirePermission\(request, "dashboard\.executive\.view"\)/);
assert.match(route, /cache-control": "private, no-store"/);
assert(!/prisma\.[a-zA-Z]+\.create\s*\(/.test(service));
assert(!/prisma\.[a-zA-Z]+\.update\s*\(/.test(service));
assert(!/prisma\.[a-zA-Z]+\.delete\s*\(/.test(service));
assert(!service.includes("AppNotification"), "Executive alert load must not create a notification source.");
assert.match(service, /queryBudget: 6/);
assert.match(service, /dedupeExecutiveAlerts/);
assert.match(component, /name="severity"/);
assert.match(component, /name="domain"/);
assert.match(component, /name="owner"/);
assert.match(component, /name="dataQuality"/);
assert.match(component, /Informativ pentru D-CEO/);
assert.match(component, /URLSearchParams/);
assert.match(overview, /getExecutiveAlerts/);

console.log(JSON.stringify({
  ok: true,
  checks: 48,
  fingerprint,
  deduplicated: deduped.length,
  cacheIsolation: true,
  zeroWriteSourceCheck: true
}, null, 2));

function sampleAlert(input: {
  entityId: string;
  currency: string;
  amount: string;
  responsibleUserId?: string | null;
  responsibleLabel?: string;
}) {
  return makeAlert({
    ruleType: "OVERDUE_RECEIVABLE",
    reasonCode: "OVERDUE_RECEIVABLE",
    domain: "FINANCE",
    entityType: "financial_receivable",
    entityId: input.entityId,
    entityLabel: input.entityId,
    companyEntity: "FOCUS_MEDIA",
    title: "Factură restantă",
    summary: "Test",
    severity: "P2",
    impact: { kind: "MONEY", label: "Sold", amount: input.amount, currency: input.currency },
    confidence: 100,
    dataQualityState: "HIGH",
    responsibleUserId: input.responsibleUserId || null,
    responsibleLabel: input.responsibleLabel || "Nealocat",
    detectedAt: new Date("2026-07-01T00:00:00.000Z"),
    dueAt: new Date("2026-07-01T00:00:00.000Z"),
    recommendedAction: "Verifică.",
    evidence: [],
    sourceRefs: [{ id: input.entityId, label: input.entityId, href: "/one" }],
    deepLink: "/one",
    relevantWindow: "due:2026-07-01",
    groupKey: `OVERDUE:${input.currency}`,
    occurrenceCount: 1,
    asOf: new Date("2026-07-24T00:00:00.000Z"),
    ageReference: new Date("2026-07-24T00:00:00.000Z")
  });
}

function session(role: "D_CEO" | "COO"): AuthSession {
  return {
    id: `test-${role}`,
    email: `${role.toLowerCase()}@example.test`,
    name: role,
    role,
    tokenVersion: 0,
    iat: 1,
    exp: 4_000_000_000
  };
}

function read(file: string) {
  return fs.readFileSync(file, "utf8");
}
