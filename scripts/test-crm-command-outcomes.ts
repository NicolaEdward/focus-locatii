import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { ADMIN_COOKIE, createSessionToken, hashPassword, type AuthSession } from "../src/lib/auth";
import { createCrmCommandIntention, sendCrmCommandIntention, verifyCrmCommandIntention } from "../src/lib/crm-command-client";
import { crmDomainIntentionKey } from "../src/lib/crm-command-intents";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";

loadEnvFile();
assertSyntheticEnvironment();
assert.ok(["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname), "Run only against a local isolated synthetic database");
const tag = `crm-outcome-${randomUUID()}`;
const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3111";
const userIds: string[] = [];
const initialMfaMode = process.env.MFA_ENFORCEMENT_MODE;
process.env.MFA_ENFORCEMENT_MODE = "off";

async function actor(suffix: string): Promise<AuthSession> {
  const id = `${tag}-${suffix}`;
  userIds.push(id);
  await prisma.user.create({ data: { id, name: `Synthetic ${suffix}`, email: `${id}@example.invalid`, role: "SALES_AGENT", passwordHash: await hashPassword("Synthetic-CRM-Outcome-Only-2026!") } });
  const now = Math.floor(Date.now() / 1000);
  return { id, name: `Synthetic ${suffix}`, email: `${id}@example.invalid`, role: "SALES_AGENT", tokenVersion: 0, iat: now, exp: now + 3600 };
}

function request(session: AuthSession, payload?: Record<string, unknown>, query = "") {
  return new NextRequest(`${base}/api/admin/crm/commands${query}`, {
    method: payload ? "POST" : "GET",
    headers: { origin: base, "content-type": "application/json", cookie: `${ADMIN_COOKIE}=${createSessionToken(session)}` },
    ...(payload ? { body: JSON.stringify(payload) } : {})
  });
}

function prospectPayload(suffix: string, session: AuthSession) {
  return { action: "create_prospect", companyName: `${tag}-${suffix}`, ownerId: session.id, allowPotentialDuplicate: true, idempotencyKey: randomUUID() };
}

/** Fail only the post-commit route audit. Real CRM SQL and its CrmEvent commit. */
async function failRouteAudit<T>(action: string, command: () => Promise<T>) {
  const delegate = prisma.auditLog as unknown as { create: (...args: unknown[]) => Promise<unknown> };
  const original = delegate.create;
  delegate.create = (...args: unknown[]) => {
    const input = args[0] as { data?: { action?: string } };
    if (input.data?.action === action) throw new Error("Synthetic post-commit audit unavailable");
    return original.apply(prisma.auditLog, args);
  };
  try { return await command(); } finally { delegate.create = original; }
}

/** Preserve durable request intent, then inject the domain transaction timeout. */
async function failDomainTransaction<T>(number: number, command: () => Promise<T>) {
  const mutable = prisma as unknown as { $transaction: (...args: unknown[]) => Promise<unknown> };
  const original = mutable.$transaction;
  let domainTransactions = 0;
  mutable.$transaction = (...args: unknown[]) => {
    const options = args[1] as { timeout?: number } | undefined;
    if (options?.timeout === 30_000 && ++domainTransactions === number) {
      const error = new Error("Synthetic transaction response lost") as Error & { code: string };
      error.code = "P2028";
      return Promise.reject(error);
    }
    return original.apply(prisma, args);
  };
  try { return await command(); } finally { mutable.$transaction = original; }
}

async function main() {
  const routes = await import("../src/app/api/admin/crm/commands/route");
  assert.equal(typeof routes.GET, "function", "Read-only intention verification must be available");
  const a = await actor("seller-a"), b = await actor("seller-b");
  const committed = prospectPayload("committed-audit-failure", a);
  const response = await failRouteAudit("crm.v4.create_prospect", () => routes.POST(request(a, committed)));
  assert.equal(response.status, 200, "A known committed command cannot be reported as an execution failure");
  const data = await response.json();
  assert.equal(data.outcome, "committed");
  assert.equal(data.auditStatus, "incomplete");
  assert.ok(data.warning, "The incomplete route audit must remain visible");
  assert.ok(data.auditRequestId, "The durable request identifier is available for investigation");
  assert.equal(data.commandKey, committed.idempotencyKey);
  const stored = await prisma.crmProspect.findFirstOrThrow({ where: { company: { name: committed.companyName } } });
  assert.equal(data.result.id, stored.id, "Return the preserved committed result to the caller");
  assert.equal(await prisma.crmProspect.count({ where: { companyId: stored.companyId } }), 1);
  assert.equal(await prisma.crmEvent.count({ where: { idempotencyKey: crmDomainIntentionKey(a.id, committed.idempotencyKey) } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { userId: a.id, action: "crm.v4.create_prospect", entityId: stored.id } }), 0, "This is a real post-commit audit failure rather than a mocked result");

  const verified = await routes.GET(request(a, undefined, `?intentKey=${committed.idempotencyKey}`));
  assert.equal(verified.status, 200);
  const verifiedData = await verified.json();
  assert.equal(verifiedData.outcome, "committed");
  assert.ok(verifiedData.records.some((row: { kind: string; id: string }) => row.kind === "prospect" && row.id === stored.id));
  assert.equal(await prisma.crmProspect.count({ where: { companyId: stored.companyId } }), 1, "Verification reads without replaying the command");
  const foreign = await routes.GET(request(b, undefined, `?intentKey=${committed.idempotencyKey}`));
  assert.equal(foreign.status, 200);
  const foreignData = await foreign.json();
  assert.equal(foreignData.outcome, "unknown");
  assert.deepEqual(foreignData.records, [], "Another seller cannot look up the issued command or its record IDs");

  const replayed = await routes.POST(request(a, committed));
  assert.equal(replayed.status, 409);
  const replayData = await replayed.json();
  assert.equal(replayData.code, "CRM_INTENT_ALREADY_SUBMITTED");
  assert.equal(replayData.outcome, "unknown");
  assert.equal(await prisma.crmProspect.count({ where: { companyId: stored.companyId } }), 1, "A same-intention replay never executes another mutation");
  const changed = { ...committed, companyName: `${tag}-changed-payload-must-not-run` };
  const mismatched = await routes.POST(request(a, changed));
  assert.equal(mismatched.status, 409);
  assert.equal((await mismatched.json()).code, "CRM_INTENT_PAYLOAD_MISMATCH");
  assert.equal(await prisma.crmCompany.count({ where: { name: changed.companyName } }), 0);

  const foreignPayload = { ...prospectPayload("foreign-same-caller-key", b), idempotencyKey: committed.idempotencyKey };
  const foreignPost = await routes.POST(request(b, foreignPayload));
  assert.equal(foreignPost.status, 200, "Caller keys are namespaced by actor rather than colliding globally");
  const foreignPostData = await foreignPost.json();
  assert.equal(foreignPostData.outcome, "committed");
  assert.notEqual(foreignPostData.result.id, stored.id, "Reusing a known foreign caller key never returns the foreign result");
  const ownForeignKeyRow = await prisma.crmProspect.findUniqueOrThrow({ where: { id: foreignPostData.result.id } });
  assert.equal(ownForeignKeyRow.ownerId, b.id);
  assert.equal(await prisma.crmEvent.count({ where: { idempotencyKey: crmDomainIntentionKey(b.id, committed.idempotencyKey), actorUserId: b.id } }), 1);
  const foreignNowOwn = await routes.GET(request(b, undefined, `?intentKey=${committed.idempotencyKey}`));
  const foreignNowOwnData = await foreignNowOwn.json();
  assert.equal(foreignNowOwnData.outcome, "committed");
  assert.ok(foreignNowOwnData.records.every((row: { id: string }) => row.id !== stored.id));

  const ordinary = prospectPayload("committed-complete", a);
  const success = await routes.POST(request(a, ordinary));
  assert.equal(success.status, 200);
  const successData = await success.json();
  assert.equal(successData.outcome, "committed");
  assert.equal(successData.auditStatus, "complete");
  assert.equal(successData.commandKey, ordinary.idempotencyKey);

  // update_company is a legacy domain command with no idempotency key column
  // on its event. The route claim still prevents repeating its write, and its
  // completed route audit can answer a read-only outcome lookup.
  const companyBefore = await prisma.crmCompany.findUniqueOrThrow({ where: { id: stored.companyId } });
  const unkeyedDomain = { action: "update_company", companyId: stored.companyId, version: companyBefore.version, industry: "Synthetic outcome review", idempotencyKey: randomUUID() };
  assert.equal((await routes.POST(request(a, unkeyedDomain))).status, 200);
  assert.equal(await prisma.crmEvent.count({ where: { idempotencyKey: crmDomainIntentionKey(a.id, unkeyedDomain.idempotencyKey) } }), 0);
  assert.equal((await (await routes.GET(request(a, undefined, `?intentKey=${unkeyedDomain.idempotencyKey}`))).json()).outcome, "committed");
  assert.equal((await routes.POST(request(a, unkeyedDomain))).status, 409);
  assert.equal((await prisma.crmCompany.findUniqueOrThrow({ where: { id: stored.companyId } })).version, companyBefore.version + 1);

  const invalidPayload = { action: "create_prospect", companyName: "X", idempotencyKey: randomUUID() };
  const invalid = await routes.POST(request(a, invalidPayload));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).outcome, "rejected");
  const invalidRetry = await routes.POST(request(a, invalidPayload));
  assert.equal(invalidRetry.status, 400, "A known rejected intention can be retried with its same unchanged payload");
  assert.equal((await invalidRetry.json()).outcome, "rejected");
  assert.equal(await prisma.auditLog.count({ where: { action: "crm.command.intention.rejected", entityId: crmDomainIntentionKey(a.id, invalidPayload.idempotencyKey) } }), 2, "Each rejection has a durable marker instead of silently reopening an uncertain claim");

  const concurrentPayload = prospectPayload("concurrent-one-intention", a);
  const concurrent = await Promise.all([0, 1].map(() => routes.POST(request(a, concurrentPayload))));
  assert.deepEqual(concurrent.map((row) => row.status).sort(), [200, 409]);
  assert.equal(await prisma.crmCompany.count({ where: { name: concurrentPayload.companyName } }), 1);
  assert.equal(await prisma.crmEvent.count({ where: { idempotencyKey: crmDomainIntentionKey(a.id, concurrentPayload.idempotencyKey) } }), 1, "Concurrent claims have only one domain winner");

  const uncertain = prospectPayload("uncertain-timeout", a);
  const timedOut = await failDomainTransaction(1, () => routes.POST(request(a, uncertain)));
  assert.equal(timedOut.status, 503);
  assert.equal(timedOut.headers.get("retry-after"), null, "Unknown writes must not invite an automatic retry");
  const timeoutData = await timedOut.json();
  assert.equal(timeoutData.outcome, "unknown");
  assert.equal(timeoutData.recovery, "verify_before_retry");
  assert.equal(timeoutData.commandKey, uncertain.idempotencyKey);
  assert.ok(timeoutData.auditRequestId);
  assert.ok(!/nu au fost salvate partial|incearca din nou/i.test(timeoutData.error), "A timeout cannot promise rollback or advise blind replay");
  const missing = await routes.GET(request(a, undefined, `?intentKey=${uncertain.idempotencyKey}`));
  assert.equal((await missing.json()).outcome, "unknown", "No event is not proof that a command did not commit");

  const partialKey = randomUUID();
  const partialPayload = { action: "create_inbound", companyName: `${tag}-partial-inbound`, taxId: `RO${Date.now()}`, ownerId: a.id, contactName: "Synthetic contact", needSummary: "Synthetic OOH brief", allowPotentialDuplicate: true, idempotencyKey: partialKey };
  const partial = await failDomainTransaction(2, () => routes.POST(request(a, partialPayload)));
  assert.equal(partial.status, 503);
  assert.equal((await partial.json()).outcome, "unknown");
  assert.equal(await prisma.crmEvent.count({ where: { idempotencyKey: `${crmDomainIntentionKey(a.id, partialKey)}:prospect` } }), 1, "The first inbound transaction really committed");
  assert.equal(await prisma.crmEvent.count({ where: { idempotencyKey: `${crmDomainIntentionKey(a.id, partialKey)}:opportunity` } }), 0);
  const partialRead = await routes.GET(request(a, undefined, `?intentKey=${partialKey}`));
  const partialData = await partialRead.json();
  assert.equal(partialData.outcome, "partial");
  assert.equal(partialData.recovery, "verify_before_retry");
  assert.ok(partialData.records.some((row: { kind: string }) => row.kind === "prospect"));

  // Browser-side response loss must never turn an unkeyed legacy command into
  // an automatic replay merely because a local intention key exists.
  const lost = createCrmCommandIntention({ action: "update_company", companyId: "synthetic-only", name: "Synthetic" }, randomUUID());
  let writes = 0;
  const lostResponse = async () => { writes++; throw new Error("Synthetic response lost after server write"); };
  assert.equal((await sendCrmCommandIntention(lost, lostResponse)).outcome, "unknown");
  assert.equal((await sendCrmCommandIntention(lost, lostResponse)).outcome, "unknown");
  assert.equal(writes, 1, "An uncertain intention blocks all further POST attempts");
  const verifiedRequests: { url: string; method: string | undefined }[] = [];
  const stillUnknown = await verifyCrmCommandIntention(lost, async (input, init) => {
    verifiedRequests.push({ url: String(input), method: init?.method });
    return Response.json({ outcome: "unknown", records: [], message: "Read-only verification found no conclusive event" });
  });
  assert.equal(stillUnknown.outcome, "unknown");
  assert.equal(verifiedRequests[0].method, "GET");
  assert.ok(verifiedRequests[0].url.includes(encodeURIComponent(lost.key)));
  await sendCrmCommandIntention(lost, lostResponse);
  assert.equal(writes, 1, "An inconclusive read never unlocks a write retry");
  const recovered = await verifyCrmCommandIntention(lost, async (_input, init) => {
    assert.equal(init?.method, "GET");
    return Response.json({ outcome: "committed", records: [{ kind: "prospect", id: stored.id }], message: "Committed event found" });
  });
  assert.equal(recovered.outcome, "committed");
  assert.equal(lost.state, "committed");
  await sendCrmCommandIntention(lost, lostResponse);
  assert.equal(writes, 1, "A recovered committed intention cannot replay the command");

  const retryable = createCrmCommandIntention({ action: "create_prospect", companyName: "Synthetic unchanged payload" }, randomUUID());
  const attemptBodies: Record<string, unknown>[] = [];
  const rejectedThenCommitted = async (_input: RequestInfo | URL, init?: RequestInit) => {
    attemptBodies.push(JSON.parse(String(init?.body)));
    return attemptBodies.length === 1
      ? Response.json({ outcome: "rejected", code: "CRM_INPUT_INVALID", error: "Known validation rejection" }, { status: 400 })
      : Response.json({ outcome: "committed", result: { id: stored.id }, auditStatus: "incomplete", warning: "Synthetic incomplete route audit", auditRequestId: randomUUID() });
  };
  assert.equal((await sendCrmCommandIntention(retryable, rejectedThenCommitted)).outcome, "rejected");
  const retryResult = await sendCrmCommandIntention(retryable, rejectedThenCommitted);
  assert.equal(retryResult.outcome, "committed");
  assert.deepEqual(retryResult.result, { id: stored.id });
  assert.equal(retryResult.message, "Synthetic incomplete route audit");
  assert.equal(attemptBodies[0].idempotencyKey, attemptBodies[1].idempotencyKey, "A permitted retry retains the same intention key");
  assert.deepEqual(attemptBodies[0], attemptBodies[1]);

  const partiallyVerified = createCrmCommandIntention({ action: "create_inbound" }, randomUUID());
  partiallyVerified.state = "unknown";
  await verifyCrmCommandIntention(partiallyVerified, async (_input, init) => {
    assert.equal(init?.method, "GET");
    return Response.json({ outcome: "partial", records: [{ kind: "prospect", id: stored.id }] });
  });
  assert.equal(partiallyVerified.state, "partial");
  await sendCrmCommandIntention(partiallyVerified, lostResponse);
  assert.equal(writes, 1, "A partial inbound outcome also blocks replay");

  console.log(JSON.stringify({ ok: true, checks: ["committed result survives post-commit audit failure", "route audit incompleteness stays visible", "actor-scoped read-only intention lookup", "actor-scoped POST keys cannot return foreign results", "same key and mismatched payload replay refusal", "concurrent intention has one winner", "known input rejection can retry with durable rejection marker", "unknown timeout blocks blind replay", "partial multi-transaction inbound is discoverable", "lost response never replays an unkeyed command", "verification uses GET and keeps uncertain/partial results blocked", "known rejected retry retains one intention key"] }, null, 2));
}

main().finally(async () => {
  if (initialMfaMode === undefined) delete process.env.MFA_ENFORCEMENT_MODE; else process.env.MFA_ENFORCEMENT_MODE = initialMfaMode;
  const companies = await prisma.crmCompany.findMany({ where: { createdByUserId: { in: userIds } }, select: { id: true } });
  const companyIds = companies.map((row) => row.id);
  await prisma.crmNextAction.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.crmEvent.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.crmOpportunity.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.crmProspect.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.crmCompanyContact.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}).catch((error) => { console.error(error instanceof Error ? error.stack : "CRM outcome tests failed"); process.exitCode = 1; });
