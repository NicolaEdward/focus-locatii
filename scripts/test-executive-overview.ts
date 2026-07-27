import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildExecutivePulse, EXECUTIVE_PULSE_WEIGHTS } from "../src/lib/dashboard/executive/pulse";
import { executiveCacheKey, executiveScopeForSession } from "../src/lib/dashboard/executive/scope";
import { bucharestDayBounds } from "../src/lib/dashboard/executive/time";
import { operationalRequirementForBooked, proofContractForOperation } from "../src/lib/dashboard/executive/operational-contract";
import { buildInventoryPartition } from "../src/lib/dashboard/executive/overview";
import type { AuthSession } from "../src/lib/auth";
import type { ExecutivePulseDimension } from "../src/lib/dashboard/executive/contracts";

const spring = bucharestDayBounds("2026-03-29");
const autumn = bucharestDayBounds("2026-10-25");
assert.equal((spring.endExclusive.getTime() - spring.start.getTime()) / 3_600_000, 23, "Spring DST business day must have 23 hours.");
assert.equal((autumn.endExclusive.getTime() - autumn.start.getTime()) / 3_600_000, 25, "Autumn DST business day must have 25 hours.");

const dceo = session("D_CEO");
const coo = session("COO");
const allScope = executiveScopeForSession(dceo, { snapshot: "2026-07-23" }, new Date("2026-07-23T12:00:00Z"));
const focusScope = executiveScopeForSession(dceo, { entity: "FOCUS_MEDIA", snapshot: "2026-07-23" }, new Date("2026-07-23T12:00:00Z"));
assert.notEqual(executiveCacheKey(allScope), executiveCacheKey(focusScope), "Entity scope must isolate cache entries.");
assert.notEqual(executiveCacheKey(allScope), executiveCacheKey(executiveScopeForSession(coo, { snapshot: "2026-07-23" })), "Role must isolate cache entries.");

assert.deepEqual(EXECUTIVE_PULSE_WEIGHTS, { finance: 25, operations: 25, campaigns: 20, sales: 15, inventory: 10, crm: 5 });
const dimensions = pulseDimensions();
const insufficient = buildExecutivePulse(dimensions);
assert.equal(insufficient.overallScore, null);
assert.equal(insufficient.status, "INSUFFICIENT_DATA");
assert.match(insufficient.message, /Date insuficiente/);
const complete = buildExecutivePulse(dimensions.map((dimension) => ({ ...dimension, score: 90, confidence: 90, dataCompleteness: 90, reasonCodes: [] })));
assert.equal(complete.overallScore, 90);
assert.equal(complete.totalConfidence, 90);
assert.equal(insufficient.trend.direction, "UNAVAILABLE", "Trend must remain unavailable when the previous score cannot be reconstructed canonically.");
assert(insufficient.mainFactors.length > 0, "Pulse must explain its main confidence factors.");

assert.deepEqual(operationalRequirementForBooked({ reservationStatus: "HOLD", locationType: "Mesh" }).requiredKinds, []);
assert.deepEqual(operationalRequirementForBooked({ reservationStatus: "BOOKED", locationType: "Mesh" }).requiredKinds, ["DECORATION", "NEUTRALIZATION"]);
assert.equal(operationalRequirementForBooked({ reservationStatus: "BOOKED", locationType: "LED screen" }).proofRequirement, "DATA_INSUFFICIENT");
assert.equal(proofContractForOperation({ operationKind: "DECORATION", documentType: "contract", linkedToTaskOrReservation: true }).satisfied, false);
assert.equal(proofContractForOperation({ operationKind: "DECORATION", documentType: "operational_proof_photo", linkedToTaskOrReservation: true }).satisfied, true);

const snapshot = new Date("2026-07-23T00:00:00.000Z");
const inventory = buildInventoryPartition([
  location("available"),
  location("booked", { reservations: [reservation("BOOKED")] }),
  location("hold", { reservations: [reservation("HOLD", "2026-07-25T12:00:00.000Z")] }),
  location("expired-hold", { reservations: [reservation("HOLD", "2026-07-22T12:00:00.000Z")] }),
  location("manual", { availabilityOverrides: [override()] }),
  location("maintenance-booked", { lifecycleStatus: "MAINTENANCE", reservations: [reservation("BOOKED")] }),
  location("inactive", { lifecycleStatus: "INACTIVE" }),
  location("archived", { lifecycleStatus: "ARCHIVED" })
], snapshot, snapshot);
assert.equal(inventory.total, 8);
assert.equal(inventory.available, 2, "Expired HOLD must fall through to available.");
assert.equal(inventory.booked, 1);
assert.equal(inventory.hold, 1);
assert.equal(inventory.manualUnavailable, 1);
assert.equal(inventory.maintenance, 1);
assert.equal(inventory.inactive, 1);
assert.equal(inventory.archived, 1);
assert.equal(inventory.lifecycleBookingConflicts, 1);
assert.equal(
  inventory.inactive + inventory.archived + inventory.maintenance + inventory.lifecycleBlocked +
  inventory.booked + inventory.hold + inventory.manualUnavailable + inventory.available + inventory.unknown,
  inventory.total
);

const service = read("src/lib/dashboard/executive/overview.ts");
const component = read("src/components/admin/ExecutiveCommandCenter.tsx");
const route = read("src/app/api/admin/executive/overview/route.ts");
assert(!/prisma\.[a-zA-Z]+\.create\s*\(/.test(service) && !/prisma\.[a-zA-Z]+\.update\s*\(/.test(service) && !/prisma\.[a-zA-Z]+\.delete\s*\(/.test(service), "Executive load must not write.");
assert(!service.includes("prisma.mediaPlan"), "Executive overview must not activate Media Plan.");
assert(service.includes("queryBudget: 15"), "Executive overview and alert preview must stay within the 15-query first-viewport budget.");
assert(
  service.includes('scope.panel === "campaign-risks" ? campaignRisks : campaignRisks.slice(0, 6)'),
  "Campaign risk drill-down must return the complete result behind the KPI count."
);
assert(component.includes("RON și EUR nu sunt însumate"), "UI must explain currency separation.");
assert(component.includes("pulse.overallScore == null") && component.includes("pulse.message"), "Pulse must render the explicit insufficient-data contract instead of inventing a score.");
assert(component.includes("pulse.mainFactors") && component.includes("pulse.trend"), "Pulse must expose factors and trend confidence.");
assert(component.indexOf("Executive Alerts") < component.indexOf("Company Pulse"), "Alerts must precede the KPI overview in the first viewport.");
assert(route.includes('requirePermission(request, "dashboard.executive.view")'));
assert(route.includes('"cache-control": "private, no-store"'));
assert(component.includes("/admin/dashboard?panel=campaign-risks#campaign-risks"), "Campaign risk card and drill-down must share the same filtered scope.");

console.log(JSON.stringify({
  ok: true,
  checks: 34,
  dst: { springHours: 23, autumnHours: 25 },
  inventory,
  cacheIsolation: true,
  pulse: { insufficient: insufficient.status, completeScore: complete.overallScore }
}, null, 2));

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

function pulseDimensions(): ExecutivePulseDimension[] {
  return (Object.entries(EXECUTIVE_PULSE_WEIGHTS) as Array<[ExecutivePulseDimension["id"], number]>).map(([id, weight]) => ({
    id,
    label: id,
    weight,
    score: id === "operations" ? null : 90,
    confidence: id === "operations" ? 40 : 90,
    dataCompleteness: id === "operations" ? 40 : 90,
    positiveReasons: [],
    negativeReasons: id === "operations" ? ["OPERATIONTASK_CUTOVER_PENDING"] : [],
    reasonCodes: id === "operations" ? ["OPERATIONTASK_CUTOVER_PENDING"] : [],
    href: "/"
  }));
}

function location(id: string, input: Record<string, unknown> = {}): any {
  return {
    id,
    lifecycleStatus: "ACTIVE",
    status: "AVAILABLE",
    availabilityText: null,
    availableFrom: null,
    availableUntil: null,
    bookedFrom: null,
    bookedUntil: null,
    blockedReason: null,
    blockedFrom: null,
    blockedUntil: null,
    reservations: [],
    availabilityOverrides: [],
    ...input
  };
}

function reservation(status: string, holdExpiresAt = "2026-07-25T12:00:00.000Z") {
  return {
    id: `${status}-${holdExpiresAt}`,
    status,
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    periodEnd: new Date("2026-07-31T00:00:00.000Z"),
    holdExpiresAt: status === "BOOKED" ? null : new Date(holdExpiresAt),
    createdAt: new Date("2026-07-20T00:00:00.000Z")
  };
}

function override() {
  return {
    id: "override",
    type: "COMMERCIAL_BLOCK",
    reason: "Test",
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    periodEnd: new Date("2026-07-31T00:00:00.000Z"),
    clearedAt: null
  };
}

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}
