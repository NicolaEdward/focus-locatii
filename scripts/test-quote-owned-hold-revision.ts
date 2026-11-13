import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import * as commercial from "../src/lib/commercial-workbench";
import * as selector from "../src/lib/location-selection-availability";
import * as holdContext from "../src/lib/quote-hold-context";
import * as core from "../src/lib/commercial-workbench-core";
import { assertSyntheticEnvironment } from "./release/env-utils";

assertSyntheticEnvironment();
const db = new URL(process.env.DATABASE_URL || "invalid:");
assert.ok(["127.0.0.1", "localhost"].includes(db.hostname) && db.pathname.startsWith("/focus_preview_"));
assert.notEqual(process.env.NODE_ENV, "production");
const baseline = process.argv.includes("--baseline-observation");
const tag = "SIM-OOH-held-revision-" + randomUUID();
const users: string[] = [], clientIds: string[] = [], quoteIds: string[] = [], locationIds: string[] = [];
let campaignId = "", categoryId = "";
let policyCreated = false;
const checks: Array<Record<string, unknown>> = [];
function ok(id: string, detail: Record<string, unknown> = {}) { checks.push({ id, passed: true, ...detail }); }
const reject = (run: () => Promise<unknown>, code: string) => assert.rejects(run, (error: any) => error?.code === code);
async function actor(role: string, suffix: string) { const row = await prisma.user.create({ data: { name: tag + suffix, email: tag + suffix + "@example.invalid", role: role as any, passwordHash: "synthetic-unusable", active: true } }); users.push(row.id); return { ...row, iat: 1, exp: 9999999999 } as any; }
function availability(actor: any) {
  const require = createRequire(`${process.cwd()}/package.json`);
  const mocks: Record<string, unknown> = { "@/lib/auth": { requirePermission: async () => ({ session: actor, response: null }) }, "@/lib/location-selection-availability": selector, "@/lib/quote-hold-context": holdContext, "@/lib/commercial-workbench-core": core, "@/lib/observability": { observeRoute: async (_request: any, _options: any, callback: any) => callback(), setObservabilityRole: () => undefined } };
  const compiled = ts.transpileModule(fs.readFileSync("src/app/api/admin/location-selection/availability/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exported: { POST?: (request: NextRequest) => Promise<Response> } = {};
  runInNewContext(compiled.outputText, { exports: exported, require: (name: string) => name in mocks ? mocks[name] : require(name), process, Buffer, Request, File, URL, Error });
  return (input: unknown) => exported.POST!(new NextRequest("http://127.0.0.1/api/admin/location-selection/availability", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }));
}
async function main() {
  const manager = await actor("COO", "manager"), seller = await actor("SALES_AGENT", "seller"), other = await actor("SALES_AGENT", "other");
  let policy = await prisma.commercialPolicy.findUnique({ where: { id: "default" } });
  if (!policy) { policy = await prisma.commercialPolicy.create({ data: { id: "default", vatRateBps: 2100, vatTreatment: "exclusive", rateCardCurrency: "EUR", approvedByUserId: manager.id } }); policyCreated = true; }
  const policyHashBefore = core.commercialHash(policy);
  for (let index = 0; index < 2; index++) { const row = await prisma.clientAccount.create({ data: { companyName: tag + index, accountOwnerUserId: seller.id } }); clientIds.push(row.id); }
  const campaign = await prisma.campaign.create({ data: { clientId: clientIds[0], campaignName: tag, accountOwnerUserId: seller.id, sellerUserId: seller.id, status: "active", currency: policy.rateCardCurrency, companyEntity: "Focus Media", paymentTermType: "15_days", paymentTermDays: 15, billingRule: "monthly_after_service", billingFrequency: "monthly" } }); campaignId = campaign.id;
  const category = await prisma.category.create({ data: { name: tag, slug: tag } }); categoryId = category.id;
  for (let index = 0; index < 3; index++) { const row = await prisma.location.create({ data: { code: tag + index, categoryId, type: "Billboard", city: "SIM Bucuresti", lifecycleStatus: "ACTIVE", rateCardValue: 100, showInPublic: false } }); locationIds.push(row.id); }
  const input = { clientId: clientIds[0], campaignId, recipient: "synthetic@example.invalid", companyEntity: "Focus Media", periodStart: "2093-01-01", periodEnd: "2093-01-31", locationIds: locationIds.slice(0, 2), requestKey: randomUUID() };
  const initial = await commercial.createCommercialQuote(input, seller); quoteIds.push(initial.quote.id);
  const unrelated = await commercial.createCommercialQuote({ ...input, requestKey: randomUUID() }, seller); quoteIds.push(unrelated.quote.id);
  const approve = async (revisionId: string, hours: number) => { const approval = await commercial.requestCommercialApproval({ revisionId, action: "create_hold", holdExpiresAt: new Date(Date.now() + hours * 3600000).toISOString() }, seller); await commercial.decideCommercialApproval({ approvalId: approval.id, decision: "approved" }, manager); return approval; };
  const firstApproval = await approve(initial.revision.id, 1);
  const first = await commercial.executeCommercialHold({ approvalId: firstApproval.id }, manager);
  const heldIds = (first.result as any).reservationIds as string[];
  assert.equal(heldIds.length, 2);
  const beforeRows = await prisma.reservation.findMany({ where: { id: { in: heldIds } }, orderBy: { id: "asc" } });
  const api = availability(seller), contextInput = { locationIds: input.locationIds, periodStart: input.periodStart, periodEnd: input.periodEnd, quoteId: initial.quote.id, expectedRevision: 1 };
  const inspected = await api(contextInput), inspectedBody = await inspected.json();
  const available = inspected.status === 200 && input.locationIds.every((id) => inspectedBody.availabilityByLocationId?.[id]?.state === "AVAILABLE");
  checks.push({ id: "HELD-QUOTE-MAP", passed: available, responseStatus: inspected.status, states: input.locationIds.map((id) => inspectedBody.availabilityByLocationId?.[id]?.state) });
  if (baseline) {
    let error: any;
    try { await commercial.createCommercialQuote({ ...input, quoteId: initial.quote.id, expectedRevision: 1, requestKey: randomUUID() }, seller); } catch (cause) { error = cause; }
    checks.push({ id: "HELD-QUOTE-DRAFT", passed: !error, observedCode: error?.code || "saved" });
  } else {
    assert.ok(available, JSON.stringify(inspectedBody)); assert.equal(inspectedBody.quoteHoldContext.count, 2);
    await commercial.requestCommercialApproval({ revisionId: initial.revision.id, action: "send_quote" }, seller);
    ok("V1-POST-HOLD-APPROVAL-RECHECK");
    assert.equal(holdContext.quoteHoldRowsSnapshot(await prisma.reservation.findMany({ where: { id: { in: heldIds } } })), holdContext.quoteHoldRowsSnapshot(beforeRows));
    const ordinary = await api({ locationIds: input.locationIds, periodStart: input.periodStart, periodEnd: input.periodEnd }); const ordinaryBody = await ordinary.json(); assert.ok(input.locationIds.every((id) => ordinaryBody.availabilityByLocationId[id].state === "CONFLICT"));
    ok("READONLY-CONTEXT-PRESERVES-CAPACITY");
    assert.equal((await api({ ...contextInput, ignoreReservationIds: heldIds })).status, 400);
    assert.equal((await api({ ...contextInput, expectedRevision: undefined })).status, 400);
    assert.equal((await availability(other)(contextInput)).status, 404);
    const unrelatedResponse = await api({ ...contextInput, quoteId: unrelated.quote.id }); const unrelatedBody = await unrelatedResponse.json(); assert.equal(unrelatedBody.availabilityByLocationId[locationIds[0]].state, "CONFLICT");
    await reject(() => commercial.createCommercialQuote({ ...input, quoteId: unrelated.quote.id, expectedRevision: 1, requestKey: randomUUID() }, seller), "AVAILABILITY_CONFLICT");
    ok("NO-PUBLIC-EXCLUSION-FOREIGN-OR-UNRELATED-QUOTE");
    assert.equal((await api({ ...contextInput, locationIds: [locationIds[0]] })).status, 409);
    assert.equal((await api({ ...contextInput, periodEnd: "2093-02-28" })).status, 409);
    ok("HELD-SET-AND-PERIOD-REQUIRE-EXPLICIT-REPLAN");
    const alien = await prisma.reservation.create({ data: { locationId: locationIds[0], clientId: clientIds[1], clientName: tag + "other-client", status: "HOLD", ownerId: seller.id, sellerUserId: seller.id, periodStart: new Date(input.periodStart), periodEnd: new Date(input.periodEnd), holdExpiresAt: new Date(Date.now() + 3600000) } });
    const blockedResponse = await api(contextInput), blockedBody = await blockedResponse.json(); assert.equal(blockedBody.availabilityByLocationId[locationIds[0]].state, "CONFLICT");
    await reject(() => commercial.createCommercialQuote({ ...input, quoteId: initial.quote.id, expectedRevision: 1, requestKey: randomUUID() }, seller), "AVAILABILITY_CONFLICT");
    await prisma.reservation.delete({ where: { id: alien.id } }); ok("OTHER-CLIENT-HOLD-STILL-BLOCKS");
    const revision = await commercial.createCommercialQuote({ ...input, quoteId: initial.quote.id, expectedRevision: 1, requestKey: randomUUID(), linePrices: input.locationIds.map((locationId, index) => ({ locationId, monthlyRate: index ? "80.00" : "90.00", reason: "SIM verified negotiated package" })) }, seller);
    assert.equal(revision.revision.revision, 2); assert.equal((revision.revision.payload as any).quoteHoldSnapshot, holdContext.quoteHoldRowsSnapshot(beforeRows));
    assert.equal(holdContext.quoteHoldRowsSnapshot(await prisma.reservation.findMany({ where: { id: { in: heldIds } } })), holdContext.quoteHoldRowsSnapshot(beforeRows));
    ok("HELD-QUOTE-DRAFT", { sameRowsUnchangedUntilApproval: true });
    const secondApproval = await approve(revision.revision.id, 2);
    await prisma.reservation.update({ where: { id: beforeRows[0].id }, data: { holdExpiresAt: new Date(beforeRows[0].holdExpiresAt!.getTime() + 1000) } });
    await reject(() => commercial.executeCommercialHold({ approvalId: secondApproval.id }, manager), "QUOTE_HOLD_CONTEXT_CHANGED");
    assert.equal((await prisma.commercialApproval.findUniqueOrThrow({ where: { id: secondApproval.id } })).state, "approved");
    assert.equal(await prisma.agentCommand.count({ where: { approvalId: secondApproval.id } }), 0);
    await prisma.reservation.update({ where: { id: beforeRows[0].id }, data: { holdExpiresAt: beforeRows[0].holdExpiresAt, updatedAt: beforeRows[0].updatedAt } });
    ok("STALE-APPROVED-HOLD-FAILS-WITHOUT-EFFECT");
    const pair = await Promise.all([commercial.executeCommercialHold({ approvalId: secondApproval.id }, manager), commercial.executeCommercialHold({ approvalId: secondApproval.id }, manager)]);
    assert.equal(pair.filter((row) => row.replayed).length, 1);
    const after = await prisma.reservation.findMany({ where: { id: { in: heldIds } }, orderBy: { id: "asc" } });
    assert.deepEqual(after.map((row) => row.id), beforeRows.map((row) => row.id));
    assert.deepEqual(after.map((row) => row.contractGroupId), beforeRows.map((row) => row.contractGroupId));
    for (const row of after) { assert.equal(row.status, "HOLD"); assert.equal(row.amount, row.locationId === locationIds[0] ? 90 : 80); assert.equal(row.holdExpiresAt!.toISOString(), secondApproval.holdExpiresAt!.toISOString()); assert.ok(row.notes?.includes(revision.revision.id)); }
    assert.equal(await prisma.reservation.count({ where: { campaignId } }), 2);
    assert.equal(await prisma.agentCommand.count({ where: { approvalId: secondApproval.id } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { userId: manager.id, action: "agent.hold.reuse.committed" } }), 1);
    ok("APPROVED-REUSE-SAME-GROUP-IDS-EXACTLY-ONCE");
    const currentContext = await holdContext.resolveQuoteHoldContext({ quoteId: initial.quote.id, expectedRevision: 2, locationIds: input.locationIds, periodStart: input.periodStart, periodEnd: input.periodEnd, actor: seller });
    assert.equal(currentContext.latestReceiptSnapshot, currentContext.snapshot);
    await commercial.requestCommercialApproval({ revisionId: revision.revision.id, action: "send_quote" }, seller);
    assert.equal((await commercial.executeCommercialHold({ approvalId: firstApproval.id }, manager)).replayed, true);
    assert.equal(holdContext.quoteHoldRowsSnapshot(await prisma.reservation.findMany({ where: { id: { in: heldIds } } })), holdContext.quoteHoldRowsSnapshot(after));
    ok("POST-REUSE-SEND-AND-OLD-RECEIPT-RECOVERY");
    const originalStatus = after[0];
    await prisma.reservation.update({ where: { id: originalStatus.id }, data: { status: "CANCELLED" } });
    assert.equal((await api({ ...contextInput, expectedRevision: 2 })).status, 409);
    await prisma.reservation.update({ where: { id: originalStatus.id }, data: { status: originalStatus.status, updatedAt: originalStatus.updatedAt } });
    const extra = await prisma.reservation.create({ data: { locationId: locationIds[2], clientName: tag, status: "HOLD", contractGroupId: after[0].contractGroupId, ownerId: seller.id, sellerUserId: seller.id, periodStart: new Date(input.periodStart), periodEnd: new Date(input.periodEnd), holdExpiresAt: new Date(Date.now() + 3600000) } });
    assert.equal((await api({ ...contextInput, expectedRevision: 2 })).status, 409);
    await prisma.reservation.delete({ where: { id: extra.id } }); ok("PARTIAL-OR-EXPANDED-GROUP-REFUSED");
    await prisma.reservation.updateMany({ where: { id: { in: heldIds } }, data: { status: "BOOKED" } });
    assert.equal((await api({ ...contextInput, expectedRevision: 2 })).status, 409);
    await reject(() => commercial.createCommercialQuote({ ...input, quoteId: initial.quote.id, expectedRevision: 2, requestKey: randomUUID() }, seller), "QUOTE_HOLD_CONTEXT_CHANGED");
    ok("BOOKED-RESERVATIONS-NEVER-IGNORED");
  }
  assert.equal(core.commercialHash(await prisma.commercialPolicy.findUniqueOrThrow({ where: { id: "default" } })), policyHashBefore);
  const report = { syntheticOnly: true, productionWrites: 0, policyUnchanged: true, baseline, cases: checks.length, passed: checks.filter((row) => row.passed).length, observedFailures: checks.filter((row) => !row.passed).length, checks };
  if (process.env.QUOTE_OWNED_HOLD_RESULT) { fs.mkdirSync(path.dirname(process.env.QUOTE_OWNED_HOLD_RESULT), { recursive: true }); fs.writeFileSync(process.env.QUOTE_OWNED_HOLD_RESULT, JSON.stringify(report, null, 2) + "\n"); }
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try {
    const revisions = await prisma.quoteRevision.findMany({ where: { quoteId: { in: quoteIds } }, select: { id: true } });
    await prisma.agentCommand.deleteMany({ where: { delegatorUserId: { in: users } } });
    await prisma.commercialApproval.deleteMany({ where: { revisionId: { in: revisions.map((row) => row.id) } } });
    await prisma.quoteRevision.deleteMany({ where: { quoteId: { in: quoteIds } } }); await prisma.commercialQuote.deleteMany({ where: { id: { in: quoteIds } } });
    await prisma.reservation.deleteMany({ where: { locationId: { in: locationIds } } });
    if (campaignId) await prisma.campaign.deleteMany({ where: { id: campaignId } });
    await prisma.clientAccount.deleteMany({ where: { id: { in: clientIds } } }); await prisma.location.deleteMany({ where: { id: { in: locationIds } } });
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } }); await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
    if (policyCreated) await prisma.commercialPolicy.deleteMany({ where: { id: "default" } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  } finally { await prisma.$disconnect(); }
});
