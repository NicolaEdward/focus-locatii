import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import type { AuthSession } from "../src/lib/auth";
import * as service from "../src/lib/commercial-workbench";
import {
  commercialHash,
  quoteMoney,
  checkedPeriod,
  remainingDoohCapacity,
  summarizePilot,
} from "../src/lib/commercial-workbench-core";
import {
  verifyCommercialWebhook,
  applyCommercialDeliveryEvent,
} from "../src/lib/commercial-webhook";

const url = new URL(process.env.DATABASE_URL || "invalid:");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.startsWith("/focus_preview_") ||
  process.env.VERCEL_ENV === "production" ||
  !["ci", "test", "preview"].includes(process.env.APP_ENV || "")
)
  throw new Error(
    "Commercial tests require a local isolated synthetic database.",
  );
const tag = "commercial-test-" + Date.now();
const users: string[] = [],
  locations: string[] = [],
  clients: string[] = [],
  campaigns: string[] = [];
let categoryId = "";
const actor = (u: {
  id: string;
  email: string;
  name: string;
  role: AuthSession["role"];
  tokenVersion: number;
}): AuthSession => ({ ...u, iat: 1, exp: 9999999999 });
const rejects = (fn: () => Promise<unknown>, code: string) =>
  assert.rejects(fn, (e: unknown) =>
    Boolean(e && typeof e === "object" && "code" in e && e.code === code),
  );
const period = { periodStart: "2090-01-01", periodEnd: "2090-01-31" };
let count = 0;
function check(message: string) {
  count++;
  process.stdout.write("✓ " + message + "\n");
}

async function main() {
  assert.equal(
    await prisma.commercialPolicy.count(),
    0,
    "Use an empty commercial test dataset; existing policy must not be overwritten.",
  );
  assert.equal(
    await prisma.agentPrincipal.count(),
    0,
    "Use an empty commercial test dataset; existing principals must not be revoked.",
  );
  assert.deepEqual(
    quoteMoney(
      "100.00",
      new Date("2090-01-01"),
      new Date("2090-01-31"),
      1900,
      "exclusive",
    ),
    { net: "100.00", tax: "19.00", gross: "119.00" },
  );
  assert.deepEqual(
    quoteMoney(
      "119.00",
      new Date("2090-01-01"),
      new Date("2090-01-31"),
      1900,
      "inclusive",
    ),
    { net: "100.00", tax: "19.00", gross: "119.00" },
  );
  assert.throws(() => checkedPeriod("2026-02-30", "2026-03-01"));
  assert.equal(commercialHash({ a: 1, b: 2 }), commercialHash({ b: 2, a: 1 }));
  check("deterministic money, canonical hashes and real calendar validation");
  const made = await Promise.all(
    (["COO", "SALES_AGENT", "SALES_AGENT", "D_CEO"] as const).map(
      async (role, n) => {
        const row = await prisma.user.create({
          data: {
            role,
            name: tag + n,
            email: tag + n + "@example.invalid",
            active: true,
            passwordHash: "unused-synthetic",
          },
        });
        users.push(row.id);
        return actor(row);
      },
    ),
  );
  const [coo, seller, foreign, observer] = made;
  const category = await prisma.category.create({
    data: { name: tag, slug: tag },
  });
  categoryId = category.id;
  for (let i = 0; i < 6; i++) {
    const l = await prisma.location.create({
      data: {
        categoryId,
        code: tag + i,
        city: "Synthetic",
        type: i === 3 || i === 4 ? "DOOH LED" : "Billboard",
        rateCardValue: 100,
        lifecycleStatus: "ACTIVE",
        showInPublic: false,
      },
    });
    locations.push(l.id);
  }
  for (const owner of [seller, foreign]) {
    const c = await prisma.clientAccount.create({
      data: {
        companyName: tag + owner.id,
        accountOwnerUserId: owner.id,
        status: "active",
      },
    });
    clients.push(c.id);
    const campaign = await prisma.campaign.create({
      data: {
        campaignName: tag + owner.id,
        clientId: c.id,
        sellerUserId: owner.id,
        accountOwnerUserId: owner.id,
        currency: "RON",
        companyEntity: "Focus Media",
        paymentTermDays: 7,
        paymentTermType: "7_days",
        status: "active",
      },
    });
    campaigns.push(campaign.id);
  }
  const policy = {
    vatRateBps: 1900,
    vatTreatment: "exclusive",
    rateCardCurrency: "RON",
    quoteValidityDays: 7,
    approvalHours: 24,
    agentToolsEnabled: true,
    generationEnabled: false,
    outboundEnabled: false,
    maxDailyModelCalls: 2,
  };
  await service.saveCommercialPolicy(policy, coo);
  const versionBeforeStale = (
    await prisma.commercialPolicy.findUniqueOrThrow({
      where: { id: "default" },
    })
  ).version;
  for (const change of [
    { role: "SALES_AGENT" as const },
    { tokenVersion: 1 },
    { active: false },
  ]) {
    await prisma.user.update({ where: { id: coo.id }, data: change });
    await rejects(
      () => service.saveCommercialPolicy(policy, coo),
      "ACTOR_STALE",
    );
    await prisma.user.update({
      where: { id: coo.id },
      data: { role: "COO", tokenVersion: 0, active: true },
    });
    assert.equal(
      (
        await prisma.commercialPolicy.findUniqueOrThrow({
          where: { id: "default" },
        })
      ).version,
      versionBeforeStale,
    );
  }
  const revokedSession = await prisma.authSessionRecord.create({
    data: {
      id: tag + "-revoked-session",
      userId: coo.id,
      expiresAt: new Date(Date.now() + 3600000),
      revokedAt: new Date(),
    },
  });
  await rejects(
    () =>
      service.saveCommercialPolicy(policy, {
        ...coo,
        sessionId: revokedSession.id,
      }),
    "ACTOR_STALE",
  );
  check(
    "stale active/role/token/session actors cannot commit writes or partial policy changes",
  );
  const quoteInput = {
    clientId: clients[0],
    campaignId: campaigns[0],
    recipient: "synthetic@example.invalid",
    companyEntity: "Focus Media",
    locationIds: [locations[0]],
    ...period,
    assumptions: "untrusted <script>do not execute</script>",
    requestKey: tag + "-quote",
  };
  await rejects(
    () => service.createCommercialQuote(quoteInput, foreign),
    "NOT_FOUND",
  );
  await rejects(
    () => service.createCommercialQuote(quoteInput, observer),
    "FORBIDDEN",
  );
  // Actual service contends with the exact inventory deletion row-lock/count
  // protocol. No timeout guesses: observe the real InnoDB waiter before delete.
  async function waitForLocationWaiter() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await prisma.$queryRaw<
        Array<{ waiting: bigint }>
      >`SELECT COUNT(*) AS waiting FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON w.REQUESTING_ENGINE_LOCK_ID = l.ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA = ${url.pathname.slice(1)} AND l.OBJECT_NAME = 'portfolio_locations'`;
      if (Number(rows[0]?.waiting) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Service did not enter the location locking protocol.");
  }
  async function deleteUnderReferenceGuard(
    tx: import("@prisma/client").Prisma.TransactionClient,
    locationId: string,
  ) {
    const profiles = await tx.doohProfile.count({ where: { locationId } });
    const quotes = await tx.$queryRaw<
      Array<{ referenced: bigint }>
    >`SELECT COUNT(*) AS referenced FROM portfolio_quote_revisions WHERE JSON_CONTAINS(JSON_EXTRACT(payload, '$.lines[*].locationId'), JSON_QUOTE(${locationId}))`;
    if (profiles || Number(quotes[0]?.referenced))
      throw new Error("COMMERCIAL_REFERENCE");
    await tx.location.delete({ where: { id: locationId } });
  }
  for (const [locationId, create] of [
    [
      locations[4],
      () =>
        service.saveDoohProfile(
          {
            locationId: locations[4],
            timezone: "Europe/Bucharest",
            loopSeconds: 100,
            slotSeconds: 10,
            state: "verified",
            sourceReference: "synthetic concurrent profile",
          },
          coo,
        ),
    ],
    [
      locations[5],
      () =>
        service.createCommercialQuote(
          {
            ...quoteInput,
            locationIds: [locations[5]],
            requestKey: tag + "-deleted-source",
          },
          seller,
        ),
    ],
  ] as const) {
    let contender: Promise<{ ok: boolean }> | undefined;
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM portfolio_locations WHERE id = ${locationId} FOR UPDATE`;
        contender = create().then(
          () => ({ ok: true }),
          () => ({ ok: false }),
        );
        await waitForLocationWaiter();
        await deleteUnderReferenceGuard(tx, locationId);
      },
      { isolationLevel: "ReadCommitted", timeout: 20000 },
    );
    assert.equal((await contender!).ok, false);
    assert.equal(await prisma.doohProfile.count({ where: { locationId } }), 0);
    const orphanQuotes = await prisma.$queryRaw<
      Array<{ referenced: bigint }>
    >`SELECT COUNT(*) AS referenced FROM portfolio_quote_revisions WHERE JSON_CONTAINS(JSON_EXTRACT(payload, '$.lines[*].locationId'), JSON_QUOTE(${locationId}))`;
    assert.equal(Number(orphanQuotes[0]?.referenced), 0);
  }
  check(
    "real InnoDB delete-vs-profile and delete-vs-quote races leave no orphan source references",
  );
  const first = await service.createCommercialQuote(quoteInput, seller),
    replay = await service.createCommercialQuote(quoteInput, seller);
  assert.equal(first.revision.id, replay.revision.id);
  assert.equal(first.revision.totalGross.toFixed(2), "119.00");
  await rejects(
    () =>
      service.createCommercialQuote(
        { ...quoteInput, assumptions: "different" },
        seller,
      ),
    "IDEMPOTENCY_CONFLICT",
  );
  check(
    "quote ownership, read-only role, exact decimal totals and one-intent idempotency",
  );
  for (const scope of ["client", "campaign"]) {
    if (scope === "client")
      await prisma.clientAccount.update({
        where: { id: clients[0] },
        data: { accountOwnerUserId: foreign.id },
      });
    else
      await prisma.campaign.update({
        where: { id: campaigns[0] },
        data: { sellerUserId: foreign.id },
      });
    await rejects(
      () =>
        service.requestCommercialApproval(
          { revisionId: first.revision.id, action: "send_quote" },
          seller,
        ),
      "PORTFOLIO_CHANGED",
    );
    await prisma.clientAccount.update({
      where: { id: clients[0] },
      data: { accountOwnerUserId: seller.id },
    });
    await prisma.campaign.update({
      where: { id: campaigns[0] },
      data: { sellerUserId: seller.id },
    });
  }
  await assert.rejects(
    () =>
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM portfolio_locations WHERE id = ${locations[0]} FOR UPDATE`;
        await deleteUnderReferenceGuard(tx, locations[0]);
      }),
    /COMMERCIAL_REFERENCE/,
  );
  check(
    "live portfolio reassignment invalidates approvals and frozen quote history blocks inventory deletion",
  );
  const oldApproval = await service.requestCommercialApproval(
    { revisionId: first.revision.id, action: "send_quote" },
    seller,
  );
  await rejects(
    () =>
      service.decideCommercialApproval(
        { approvalId: oldApproval.id, decision: "approved" },
        seller,
      ),
    "FORBIDDEN",
  );
  await service.decideCommercialApproval(
    { approvalId: oldApproval.id, decision: "approved" },
    coo,
  );
  const second = await service.createCommercialQuote(
    {
      ...quoteInput,
      quoteId: first.quote.id,
      expectedRevision: 1,
      requestKey: tag + "-v2",
      assumptions: "new immutable version",
    },
    seller,
  );
  assert.equal(second.revision.revision, 2);
  assert.equal(
    (
      await prisma.quoteRevision.findUniqueOrThrow({
        where: { id: first.revision.id },
      })
    ).payloadHash,
    first.revision.payloadHash,
  );
  await rejects(
    () =>
      service.queueCommercialDispatch({ approvalId: oldApproval.id }, seller),
    "APPROVAL_INVALID",
  );
  const approval = await service.requestCommercialApproval(
    { revisionId: second.revision.id, action: "send_quote" },
    seller,
  );
  await service.decideCommercialApproval(
    { approvalId: approval.id, decision: "approved" },
    coo,
  );
  const queued = await service.queueCommercialDispatch(
      { approvalId: approval.id },
      seller,
    ),
    queuedAgain = await service.queueCommercialDispatch(
      { approvalId: approval.id },
      seller,
    );
  assert.equal(queued.id, queuedAgain.id);
  await rejects(
    () => service.processCommercialDispatch(queued.id, coo),
    "OUTBOUND_NOT_CONFIGURED",
  );
  check(
    "immutable revisions invalidate old approvals; queue consumes one exact approval; disabled outbound cannot send",
  );
  const acceptanceInput = {
    revisionId: second.revision.id,
    decision: "accepted",
    evidenceReference: "synthetic signed document reference",
    requestKey: tag + "-accept",
  };
  const accepted = await service.recordCommercialAcceptance(
    acceptanceInput,
    seller,
  );
  assert.equal(
    (await service.recordCommercialAcceptance(acceptanceInput, seller)).id,
    accepted.id,
  );
  const delegated = await service.issueAgentPrincipal(
    {
      name: tag,
      ownerUserId: seller.id,
      scopes: [
        "inventory.search",
        "availability.check",
        "quote.draft",
        "approval.request",
        "hold.execute",
        "receipt.read",
      ],
      mode: "copilot",
      maxDailyCommands: 20,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
    coo,
  );
  const principal = await service.authenticateAgentBearer(
    "Bearer " + delegated.token,
  );
  assert.notEqual(principal.tokenHash, delegated.token);
  await prisma.user.update({
    where: { id: seller.id },
    data: { tokenVersion: 1 },
  });
  const currentDelegation = await service.executeAgentTool(principal, {
    tool: "inventory.search",
    input: { query: tag },
    requestKey: tag + "-current-delegator-version",
  });
  assert.equal(
    currentDelegation.failed,
    false,
    "service actor must preserve the current DB credential version",
  );
  await rejects(
    () =>
      service.createCommercialQuote(
        { ...quoteInput, requestKey: tag + "-stale-seller-token" },
        seller,
      ),
    "ACTOR_STALE",
  );
  await prisma.user.update({
    where: { id: seller.id },
    data: { tokenVersion: 0 },
  });

  const read = {
    tool: "inventory.search",
    input: { query: tag },
    requestKey: tag + "-read",
  };
  const receipt = await service.executeAgentTool(principal, read),
    receiptAgain = await service.executeAgentTool(principal, read);
  assert.equal(receipt.receiptId, receiptAgain.receiptId);
  assert.equal(receiptAgain.replayed, true);
  await rejects(
    () =>
      service.executeAgentTool(principal, {
        ...read,
        input: { query: "different" },
      }),
    "IDEMPOTENCY_CONFLICT",
  );
  const invalid = {
    tool: "quote.draft",
    input: {
      ...quoteInput,
      clientId: clients[1],
      campaignId: campaigns[1],
      requestKey: tag + "-forbidden",
    },
    requestKey: tag + "-failed",
  };
  const failed = await service.executeAgentTool(principal, invalid);
  assert.equal(failed.failed, true);
  assert.equal(
    (await service.executeAgentTool(principal, invalid)).replayed,
    true,
  );
  assert.equal(
    await prisma.commercialQuote.count({ where: { ownerUserId: foreign.id } }),
    0,
  );
  check(
    "hashed revocable scoped credentials, immutable command receipts, payload conflict and failed-tool full transaction rollback",
  );
  const shadowIssued = await service.issueAgentPrincipal(
    {
      name: tag + " shadow",
      ownerUserId: seller.id,
      scopes: ["quote.draft"],
      mode: "shadow",
      maxDailyCommands: 1,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
    coo,
  );
  const shadow = await service.authenticateAgentBearer(
    "Bearer " + shadowIssued.token,
  );
  await rejects(
    () =>
      service.executeAgentTool(shadow, {
        tool: "quote.draft",
        requestKey: tag + "-shadow",
        input: quoteInput,
      }),
    "SHADOW_READ_ONLY",
  );
  const holdQuote = await service.createCommercialQuote(
    {
      ...quoteInput,
      locationIds: [locations[1]],
      requestKey: tag + "-hold-quote",
    },
    seller,
  );
  const holdApproval = await service.requestCommercialApproval(
    {
      revisionId: holdQuote.revision.id,
      action: "create_hold",
      principalId: principal.id,
      holdExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
    seller,
  );
  await service.decideCommercialApproval(
    { approvalId: holdApproval.id, decision: "approved" },
    coo,
  );
  const command = {
    tool: "hold.execute",
    input: { approvalId: holdApproval.id },
    requestKey: tag + "-hold-command",
  };
  const result = await service.executeAgentTool(principal, command);
  assert.equal(result.failed, false, JSON.stringify(result));
  assert.equal(
    (await service.executeAgentTool(principal, command)).receiptId,
    result.receiptId,
  );
  assert.equal(
    await prisma.reservation.count({
      where: { locationId: locations[1], status: "HOLD" },
    }),
    1,
  );
  assert.ok(
    (
      await prisma.commercialApproval.findUniqueOrThrow({
        where: { id: holdApproval.id },
      })
    ).consumedAt,
  );
  check(
    "shadow cannot write; a service creates one HOLD only through exact consumed human approval and canonical reservation locks",
  );
  await service.revokeAgentPrincipal(principal.id, coo);
  await rejects(
    () => service.authenticateAgentBearer("Bearer " + delegated.token),
    "AGENT_UNAUTHENTICATED",
  );
  const profile = await service.saveDoohProfile(
    {
      locationId: locations[3],
      timezone: "Europe/Bucharest",
      loopSeconds: 100,
      slotSeconds: 10,
      state: "verified",
      sourceReference: "synthetic verified capacity ledger",
    },
    coo,
  );
  await assert.rejects(
    () =>
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM portfolio_locations WHERE id = ${locations[3]} FOR UPDATE`;
        await deleteUnderReferenceGuard(tx, locations[3]);
      }),
    /COMMERCIAL_REFERENCE/,
  );
  const capacity = {
    profileId: profile.id,
    periodStart: "2090-02-01T00:00:00Z",
    periodEnd: "2090-02-02T00:00:00Z",
    daypartStartMinute: 0,
    daypartEndMinute: 1440,
    shareBps: 6000,
  };
  const snapshot = await service.checkDoohCapacity(capacity, seller);
  const allocations = await Promise.allSettled(
    [0, 1].map((n) =>
      service.bookDoohCapacity(
        {
          capacity,
          campaignId: campaigns[0],
          approvalReference: "synthetic verified human approval",
          expectedSnapshot: snapshot.snapshotHash,
          requestKey: tag + "-capacity-" + n,
        },
        coo,
      ),
    ),
  );
  assert.equal(allocations.filter((x) => x.status === "fulfilled").length, 1);
  const booking = allocations.find(
    (
      x,
    ): x is PromiseFulfilledResult<
      Awaited<ReturnType<typeof service.bookDoohCapacity>>
    > => x.status === "fulfilled",
  )!.value;
  const proofInput = {
    bookingId: booking.id,
    periodStart: capacity.periodStart,
    periodEnd: capacity.periodEnd,
    actualPlays: 60,
    expectedPlays: 100,
    sourceReference: "synthetic manual player report",
    evidenceHash: commercialHash("synthetic player proof"),
  };
  const proof = await service.recordDoohProof(proofInput, coo);
  assert.equal((await service.recordDoohProof(proofInput, coo)).id, proof.id);
  await rejects(
    () => service.recordDoohProof({ ...proofInput, actualPlays: 70 }, coo),
    "EVIDENCE_CONFLICT",
  );
  await rejects(
    () =>
      service.saveDoohProfile(
        {
          locationId: locations[3],
          timezone: "Europe/Bucharest",
          loopSeconds: 120,
          slotSeconds: 10,
          state: "verified",
          sourceReference: "synthetic changed source",
        },
        coo,
      ),
    "CAPACITY_IN_USE",
  );
  check(
    "DOOH concurrent capacity cannot oversell; evidence is replay-safe and allocated profile terms remain immutable",
  );
  const timeline = {
    periodStart: new Date("2090-01-01"),
    periodEnd: new Date("2090-01-03"),
    daypartStartMinute: 0,
    daypartEndMinute: 1440,
  };
  assert.equal(
    remainingDoohCapacity(
      [
        { ...timeline, periodEnd: new Date("2090-01-02"), shareBps: 6000 },
        { ...timeline, periodStart: new Date("2090-01-02"), shareBps: 6000 },
      ],
      timeline,
    ),
    4000,
  );
  check("disjoint DOOH time windows are not incorrectly summed");
  await prisma.commercialDispatch.update({
    where: { id: queued.id },
    data: { providerReceipt: tag + "-provider", state: "sent" },
  });
  const raw = JSON.stringify({
      type: "email.bounced",
      data: { email_id: tag + "-provider" },
    }),
    secret = "whsec_" + randomBytes(32).toString("base64"),
    timestamp = String(Math.floor(Date.now() / 1000)),
    eventId = tag + "-event";
  const headers = new Headers({
    "svix-id": eventId,
    "svix-timestamp": timestamp,
    "svix-signature":
      "v1," +
      createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
        .update(eventId + "." + timestamp + "." + raw)
        .digest("base64"),
  });
  assert.equal(verifyCommercialWebhook(raw, headers, secret), eventId);
  assert.throws(() => verifyCommercialWebhook(raw + " ", headers, secret));
  await applyCommercialDeliveryEvent(eventId, JSON.parse(raw));
  assert.equal(
    (await applyCommercialDeliveryEvent(eventId, JSON.parse(raw))).replayed,
    true,
  );
  assert.ok(
    (await prisma.commercialSuppression.findUnique({
      where: { recipientHash: commercialHash("not matching") },
    })) === null,
  );
  await applyCommercialDeliveryEvent(tag + "-late-delivery", {
    type: "email.delivered",
    data: { email_id: tag + "-provider" },
  });
  assert.equal(
    (
      await prisma.commercialDispatch.findUniqueOrThrow({
        where: { id: queued.id },
      })
    ).state,
    "bounced",
  );
  check(
    "signed provider callbacks deduplicate and late delivery cannot erase bounce suppression",
  );
  const protocol = {
    objective: "Measure assisted selling on synthetic fixtures",
    eligibility: "Comparable OOH companies only",
    maturityDays: 7,
    targetCasesPerArm: 10,
    minimumSourcePrecision: 0.99,
    maximumModelCostPerCase: 2,
    costCurrency: "RON",
    permittedData: "Synthetic internal availability and opportunities only",
    channels: "none",
    humanApprovalAtEveryCommercialEffect: true,
  };
  const pilot = await service.createSalesPilot(
    { name: tag, mode: "offline", protocol },
    coo,
  );
  await service.decideSalesPilot(
    {
      pilotId: pilot.id,
      action: "activate",
      expectedProtocolHash: pilot.protocolHash,
      reason: "synthetic controlled evaluation approved",
    },
    coo,
  );
  const entry = await service.enrollPilotCase(
      { pilotId: pilot.id, companyKey: tag + "company" },
      coo,
    ),
    repeat = await service.enrollPilotCase(
      { pilotId: pilot.id, companyKey: tag + "company" },
      coo,
    );
  assert.equal(entry.id, repeat.id);
  const metrics = {
    humanMinutes: 10,
    modelCost: 0,
    reworkMinutes: 1,
    validSources: 1,
    totalClaims: 1,
    calculationErrors: 0,
    unauthorizedEffects: 0,
    availabilityErrors: 0,
    booked: false,
    paidAmount: 0,
    verifiedMargin: null,
    complaints: 0,
  };
  await rejects(
    () =>
      service.reviewPilotCase(
        {
          caseId: entry.id,
          metrics,
          matured: true,
          evidenceReference: "synthetic evaluator evidence",
        },
        coo,
      ),
    "CASE_IMMATURE",
  );
  await service.reviewPilotCase(
    {
      caseId: entry.id,
      metrics: { ...metrics, unauthorizedEffects: 1 },
      matured: false,
      evidenceReference: "synthetic adversarial test incident",
    },
    coo,
  );
  const report = await service.salesPilotReport(pilot.id, coo);
  assert.equal(report.pilot.state, "stopped");
  assert.equal(report.replacementDecision, "NOT_ESTABLISHED");
  assert.equal(
    report.arms.reduce((s, x) => s + x.mature, 0),
    0,
  );
  const stopped = await prisma.commercialPolicy.findUniqueOrThrow({
    where: { id: "default" },
  });
  assert.equal(stopped.agentToolsEnabled, false);
  assert.equal(stopped.outboundEnabled, false);
  assert.equal(stopped.generationEnabled, false);
  assert.equal(summarizePilot([])[0].sourcePrecision, null);
  check(
    "company-level stable cohorts, honest immature reports and incident-triggered global kill switch",
  );
  for (const [suffix, changed] of [
    ["calculation", { calculationErrors: 1 }],
    ["cost", { modelCost: 3 }],
    ["grounding", { validSources: 0 }],
  ] as const) {
    const sample = await service.createSalesPilot(
      { name: tag + suffix, mode: "offline", protocol },
      coo,
    );
    await service.decideSalesPilot(
      {
        pilotId: sample.id,
        action: "activate",
        expectedProtocolHash: sample.protocolHash,
        reason: "synthetic threshold boundary test",
      },
      coo,
    );
    const sampleCase = await service.enrollPilotCase(
      { pilotId: sample.id, companyKey: tag + suffix },
      coo,
    );
    const reviewed = await service.reviewPilotCase(
      {
        caseId: sampleCase.id,
        metrics: { ...metrics, ...changed },
        matured: false,
        evidenceReference: "synthetic threshold evidence",
      },
      coo,
    );
    assert.equal(reviewed.stopRequired, true);
    const sampleReport = await service.salesPilotReport(sample.id, coo);
    assert.equal(sampleReport.pilot.state, "stopped");
    assert.equal(
      sampleReport.arms.some((arm) => arm.stopRequired),
      true,
    );
  }
  check(
    "approved calculation, cost and grounding thresholds stop the pilot and remain visible in report flags",
  );
  const workspace = await service.commercialWorkspace(seller);
  assert.equal(workspace.principals.length, 0);
  assert.equal(
    workspace.quotes.some((q) => q.ownerUserId !== seller.id),
    false,
  );
  assert.equal(
    workspace.quotes[0].revisions.some((r) => r.revision === 1),
    true,
  );
  await rejects(
    () => service.readCommercialReceipt(receipt.receiptId, foreign),
    "NOT_FOUND",
  );
  assert.ok(
    (await prisma.auditLog.count({
      where: {
        userId: { in: users },
        metadata: { path: "$.durability", equals: "business-transaction" },
      },
    })) > 20,
  );
  check(
    "authorized workspace and receipt views preserve portfolio isolation and durable atomic audit markers",
  );
  console.log(
    JSON.stringify({
      ok: true,
      suites: count,
      syntheticOnly: true,
      providerCalls: 0,
      modelCalls: 0,
    }),
  );
}
async function cleanup() {
  const quoteIds = (
    await prisma.commercialQuote.findMany({
      where: { ownerUserId: { in: users } },
      select: { id: true },
    })
  ).map((x) => x.id);
  const revisionIds = (
    await prisma.quoteRevision.findMany({
      where: { quoteId: { in: quoteIds } },
      select: { id: true },
    })
  ).map((x) => x.id);
  const dispatchIds = (
    await prisma.commercialDispatch.findMany({
      where: { revisionId: { in: revisionIds } },
      select: { id: true },
    })
  ).map((x) => x.id);
  await prisma.commercialDeliveryEvent.deleteMany({
    where: { dispatchId: { in: dispatchIds } },
  });
  await prisma.commercialDispatch.deleteMany({
    where: { revisionId: { in: revisionIds } },
  });
  await prisma.commercialAcceptance.deleteMany({
    where: { revisionId: { in: revisionIds } },
  });
  await prisma.commercialApproval.deleteMany({
    where: { revisionId: { in: revisionIds } },
  });
  await prisma.quoteRevision.deleteMany({ where: { id: { in: revisionIds } } });
  await prisma.commercialQuote.deleteMany({ where: { id: { in: quoteIds } } });
  await prisma.commercialSuppression.deleteMany({
    where: { createdByUserId: { in: users } },
  });
  await prisma.agentCommand.deleteMany({
    where: { delegatorUserId: { in: users } },
  });
  const principals = (
    await prisma.agentPrincipal.findMany({
      where: { createdByUserId: { in: users } },
      select: { id: true },
    })
  ).map((x) => x.id);
  await prisma.agentUsageDay.deleteMany({
    where: {
      principalId: { in: [...principals, ...users.map((u) => "human:" + u)] },
    },
  });
  await prisma.agentPrincipal.deleteMany({ where: { id: { in: principals } } });
  const bookings = (
    await prisma.doohCapacityBooking.findMany({
      where: { createdByUserId: { in: users } },
      select: { id: true },
    })
  ).map((x) => x.id);
  await prisma.doohPlaybackProof.deleteMany({
    where: { bookingId: { in: bookings } },
  });
  await prisma.doohCapacityBooking.deleteMany({
    where: { id: { in: bookings } },
  });
  await prisma.doohProfile.deleteMany({
    where: { locationId: { in: locations } },
  });
  const pilots = (
    await prisma.salesPilot.findMany({
      where: { createdByUserId: { in: users } },
      select: { id: true },
    })
  ).map((x) => x.id);
  await prisma.salesPilotCase.deleteMany({
    where: { pilotId: { in: pilots } },
  });
  await prisma.salesPilot.deleteMany({ where: { id: { in: pilots } } });
  await prisma.commercialPolicy.deleteMany({
    where: { approvedByUserId: { in: users } },
  });
  await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
  await prisma.reservation.deleteMany({
    where: { locationId: { in: locations } },
  });
  await prisma.campaign.deleteMany({ where: { id: { in: campaigns } } });
  await prisma.clientAccount.deleteMany({ where: { id: { in: clients } } });
  await prisma.location.deleteMany({ where: { id: { in: locations } } });
  if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
