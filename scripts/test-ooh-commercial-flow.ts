import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import type { AuthSession } from "../src/lib/auth";
import { createCampaign, updateCampaign } from "../src/lib/campaigns";
import { updateReservationGroupStatus } from "../src/lib/reservations";
import { prepareCrmCommercialDraft } from "../src/lib/crm-handoff";
import { deriveCampaignCommercialSummary, syncCampaignCommercialSummary } from "../src/lib/campaigns/campaign-commercial-summary";
import * as commercial from "../src/lib/commercial-workbench";
import { assertSyntheticEnvironment } from "./release/env-utils";

assertSyntheticEnvironment();
assert.ok(["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname), "Only local synthetic databases are allowed");
const tag = "ooh-flow-" + randomUUID();
const userIds: string[] = [], companyIds: string[] = [], opportunityIds: string[] = [], locationIds: string[] = [], clientIds: string[] = [], campaignIds: string[] = [];
let categoryId = "";
let groups = 0;
const check = (name: string) => { groups++; console.log("✓ " + name); };
const rejects = (run: () => Promise<unknown>, code: string) => assert.rejects(run, (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === code));
async function user(role: AuthSession["role"], suffix: string): Promise<AuthSession> {
  const row = await prisma.user.create({ data: { role, name: tag + suffix, email: tag + suffix + "@example.invalid", passwordHash: "synthetic-unused", active: true } });
  userIds.push(row.id);
  return { ...row, tokenVersion: row.tokenVersion, iat: 1, exp: 9999999999 };
}
async function opportunity(owner: AuthSession, suffix: string) {
  const company = await prisma.crmCompany.create({ data: { name: tag + suffix, normalizedName: tag + suffix, taxId: "RO" + String(90000000 + companyIds.length), ownerId: owner.id, contacts: { create: { name: "Synthetic decision maker", email: "synthetic@example.invalid", isPrimary: true } } } });
  companyIds.push(company.id);
  const row = await prisma.crmOpportunity.create({ data: { companyId: company.id, ownerId: owner.id, name: tag + suffix + " campaign", stage: "opportunity", currency: "EUR", desiredPeriodStart: new Date("2091-01-01"), desiredPeriodEnd: new Date("2091-01-31"), initialSnapshot: {} } });
  opportunityIds.push(row.id);
  return row;
}

async function main() {
  assert.equal(await prisma.commercialPolicy.count(), 0, "Use an empty policy dataset; existing policy cannot be overwritten");
  const manager = await user("COO", "manager"), seller = await user("SALES_AGENT", "seller"), other = await user("SALES_AGENT", "other");
  const source = await opportunity(seller, "first");
  const preparation = { opportunityId: source.id, version: source.version, idempotencyKey: randomUUID(), currency: "EUR" as const, companyEntity: "Focus Media" };
  const prepared = await prepareCrmCommercialDraft(preparation, seller);
  clientIds.push(prepared.clientId); campaignIds.push(prepared.campaignId);
  const client = await prisma.clientAccount.findUniqueOrThrow({ where: { id: prepared.clientId } });
  const draft = await prisma.campaign.findUniqueOrThrow({ where: { id: prepared.campaignId } });
  assert.equal(client.status, "prospect"); assert.equal(client.accountOwnerUserId, seller.id);
  assert.equal(draft.status, "draft"); assert.equal(draft.currency, "EUR"); assert.equal(draft.totalContractValue, null);
  assert.equal(draft.paymentTermType, null); assert.equal(draft.paymentTermDays, null); assert.equal(draft.billingRule, null); assert.equal(draft.billingFrequency, null);
  assert.equal((await prisma.crmOpportunity.findUniqueOrThrow({ where: { id: source.id } })).stage, "opportunity");
  assert.equal(await prisma.reservation.count({ where: { campaignId: draft.id } }), 0);
  assert.ok(prepared.href.includes("opportunityId="));
  check("first prospect prepares a client and draft campaign without a won sale, booked value or inventory allocation");

  const repeated = await Promise.all([prepareCrmCommercialDraft(preparation, seller), prepareCrmCommercialDraft(preparation, seller)]);
  assert.ok(repeated.every((result) => result.repeated && result.clientId === client.id && result.campaignId === draft.id));
  assert.equal((await prepareCrmCommercialDraft({ ...preparation, idempotencyKey: randomUUID() }, seller)).campaignId, draft.id);
  assert.equal(await prisma.campaign.count({ where: { clientId: client.id } }), 1);
  await rejects(() => prepareCrmCommercialDraft({ ...preparation, currency: "RON" }, seller), "CRM_IDEMPOTENCY_CONFLICT");
  await rejects(() => prepareCrmCommercialDraft(preparation, other), "CRM_NOT_FOUND");
  await prisma.user.update({ where: { id: seller.id }, data: { tokenVersion: 1 } });
  await rejects(() => prepareCrmCommercialDraft(preparation, seller), "CRM_ACTOR_STALE");
  await prisma.user.update({ where: { id: seller.id }, data: { tokenVersion: 0 } });
  check("concurrent retries deduplicate, payload changes conflict, and foreign or stale actors cannot replay preparation");

  const foreignSource = await opportunity(seller, "foreign-client");
  const foreignClient = await prisma.clientAccount.create({ data: { companyName: tag + "foreign-client", normalizedName: tag + "foreign-client", taxId: "RO90000001", accountOwnerUserId: other.id, status: "active" } });
  clientIds.push(foreignClient.id);
  await rejects(() => prepareCrmCommercialDraft({ ...preparation, opportunityId: foreignSource.id, idempotencyKey: randomUUID() }, seller), "CRM_CLIENT_OWNER_CONFLICT");
  assert.equal(await prisma.campaign.count({ where: { clientId: foreignClient.id } }), 0);
  assert.equal(await prisma.crmEvent.count({ where: { opportunityId: foreignSource.id, type: "COMMERCIAL_DRAFT_PREPARED" } }), 0);
  check("existing foreign client is neither duplicated nor reassigned by pre-sale preparation");

  const directCampaign = await createCampaign({ clientId: client.id, campaignName: tag + " direct", currency: "EUR", companyEntity: "Focus Media" }, seller);
  campaignIds.push(directCampaign.id);
  await prisma.$transaction((tx) => syncCampaignCommercialSummary(tx, draft.id));
  const synchronized = await prisma.campaign.findUniqueOrThrow({ where: { id: draft.id } });
  assert.equal(synchronized.currency, "EUR"); assert.equal(synchronized.totalContractValue, null);
  assert.equal(synchronized.startDate?.toISOString().slice(0, 10), "2091-01-01");
  await updateCampaign(directCampaign.id, { currency: "RON" }, seller);
  assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: directCampaign.id } })).currency, "RON");
  check("campaign currency is explicit and editable before booking, and empty synchronization preserves the proposal");

  const economicSettings = { vatRateBps: 2100, vatTreatment: "exclusive", rateCardCurrency: "EUR", quoteValidityDays: 7, approvalHours: 24 };
  const initialPolicy = await commercial.saveCommercialSettings({ ...economicSettings, expectedVersion: null }, manager);
  assert.equal(initialPolicy.agentToolsEnabled, false); assert.equal(initialPolicy.outboundEnabled, false); assert.equal(initialPolicy.generationEnabled, false);
  const automationSettings = { agentToolsEnabled: false, generationEnabled: false, outboundEnabled: false, maxDailyModelCalls: 2 };
  const automatedPolicy = await commercial.saveCommercialAutomation({ ...automationSettings, expectedVersion: initialPolicy.version }, manager);
  assert.equal(automatedPolicy.vatRateBps, 2100);
  await rejects(() => commercial.saveCommercialSettings({ ...economicSettings, vatRateBps: 1900, expectedVersion: initialPolicy.version }, manager), "POLICY_VERSION_CONFLICT");
  await commercial.stopCommercialAutomation(manager);
  await rejects(() => commercial.saveCommercialAutomation({ ...automationSettings, agentToolsEnabled: true, expectedVersion: automatedPolicy.version }, manager), "POLICY_VERSION_CONFLICT");
  const policyVersion = (await prisma.commercialPolicy.findUniqueOrThrow({ where: { id: "default" } })).version;
  const concurrentPolicies = await Promise.allSettled([
    commercial.saveCommercialSettings({ ...economicSettings, expectedVersion: policyVersion }, manager),
    commercial.saveCommercialSettings({ ...economicSettings, quoteValidityDays: 8, expectedVersion: policyVersion }, manager),
  ]);
  assert.equal(concurrentPolicies.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrentPolicies.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await prisma.commercialPolicy.findUniqueOrThrow({ where: { id: "default" } })).agentToolsEnabled, false);
  check("commercial and automation settings are separate; version conflicts preserve changed tax settings and the kill switch");
  const category = await prisma.category.create({ data: { name: tag, slug: tag } }); categoryId = category.id;
  for (let i = 0; i < 2; i++) {
    const location = await prisma.location.create({ data: { categoryId, code: tag + i, type: "Billboard", city: "Synthetic", lifecycleStatus: "ACTIVE", rateCardValue: 100, showInPublic: false } });
    locationIds.push(location.id);
  }
  const quoteInput = { clientId: client.id, campaignId: draft.id, opportunityId: source.id, recipient: "synthetic@example.invalid", companyEntity: "Focus Media", periodStart: "2091-01-01", periodEnd: "2091-01-31", locationIds, linePrices: [{ locationId: locationIds[0], monthlyRate: "80.00", reason: "Synthetic negotiated client rate" }], requestKey: randomUUID() };
  const unready = await commercial.createCommercialQuote({ ...quoteInput, requestKey: randomUUID() }, seller);
  await rejects(() => commercial.requestCommercialApproval({ revisionId: unready.revision.id, action: "send_quote" }, seller), "CAMPAIGN_TERMS_REQUIRED");
  await updateCampaign(draft.id, { paymentTermType: "custom", paymentTermDays: 15, billingRule: "monthly_after_service", billingFrequency: "monthly" }, seller);
  const quoted = await commercial.createCommercialQuote(quoteInput, seller);
  const payload = quoted.revision.payload as Record<string, unknown>;
  const lines = payload.lines as Array<Record<string, unknown>>;
  assert.equal(quoted.revision.totalNet.toFixed(2), "180.00");
  assert.equal(quoted.revision.totalTax.toFixed(2), "37.80");
  assert.equal(quoted.revision.totalGross.toFixed(2), "217.80");
  assert.equal(payload.pricingApprovalRequired, true);
  const discounted = lines.find((row) => row.locationId === locationIds[0])!;
  assert.equal(discounted.listMonthlyRate, "100.00"); assert.equal(discounted.monthlyRate, "80.00"); assert.equal(discounted.discountBps, 2000);
  assert.equal((await prisma.location.findUniqueOrThrow({ where: { id: locationIds[0] } })).rateCardValue, 100);
  assert.equal((await commercial.createCommercialQuote(quoteInput, seller)).revision.id, quoted.revision.id);
  await rejects(() => commercial.createCommercialQuote({ ...quoteInput, linePrices: [{ ...quoteInput.linePrices[0], monthlyRate: "79.00" }] }, seller), "IDEMPOTENCY_CONFLICT");
  await rejects(() => commercial.createCommercialQuote({ ...quoteInput, companyEntity: "Excellence Media", requestKey: randomUUID() }, seller), "COMPANY_ENTITY_MISMATCH");
  await rejects(() => commercial.createCommercialQuote({ ...quoteInput, opportunityId: foreignSource.id, requestKey: randomUUID() }, seller), "INVALID_OPPORTUNITY");
  const pending = await commercial.requestCommercialApproval({ revisionId: quoted.revision.id, action: "send_quote" }, seller);
  await rejects(() => commercial.decideCommercialApproval({ approvalId: pending.id, decision: "approved" }, seller), "FORBIDDEN");
  assert.equal((await commercial.decideCommercialApproval({ approvalId: pending.id, decision: "approved" }, manager)).state, "approved");
  await updateCampaign(draft.id, { paymentTermDays: 20 }, seller);
  await rejects(() => commercial.requestCommercialApproval({ revisionId: quoted.revision.id, action: "send_quote" }, seller), "CAMPAIGN_TERMS_CHANGED");
  await updateCampaign(draft.id, { paymentTermDays: 15 }, seller);
  check("negotiated prices retain catalog provenance and exact totals, cannot mutate tariffs, and require a version-bound manager approval");

  await rejects(() => commercial.createCommercialQuote({ ...quoteInput, requestKey: randomUUID(), linePrices: [{ ...quoteInput.linePrices[0], locationId: "outside-selection" }] }, seller), "INVALID_LINE_PRICES");
  await assert.rejects(() => commercial.createCommercialQuote({ ...quoteInput, requestKey: randomUUID(), linePrices: [{ ...quoteInput.linePrices[0], monthlyRate: "80.001" }] }, seller));
  let latest = quoted.quote.latestRevision;
  for (let n = 0; n < 21; n++) {
    const result = await commercial.createCommercialQuote({ ...quoteInput, quoteId: quoted.quote.id, expectedRevision: latest, requestKey: randomUUID(), assumptions: "Synthetic revision " + n }, seller);
    latest = result.quote.latestRevision;
  }
  await commercial.createCommercialQuote({ ...quoteInput, requestKey: randomUUID() }, seller);
  const page = await commercial.commercialWorkspace(seller, { page: 2, pageSize: 1, quoteId: quoted.quote.id, revisionPage: 2, revisionPageSize: 5 });
  assert.equal(page.quotePage.total, 3); assert.equal(page.quotePage.ids.length, 1); assert.equal(page.revisionPage?.total, 22); assert.equal(page.revisionPage?.ids.length, 5);
  const selected = page.quotes.find((row) => row.id === quoted.quote.id)!;
  assert.ok(selected.revisions.some((row) => row.revision === 22));
  assert.deepEqual(selected.revisions.filter((row) => page.revisionPage!.ids.includes(row.id)).map((row) => row.revision), [17, 16, 15, 14, 13]);
  const oldest = await commercial.commercialWorkspace(seller, { quoteId: quoted.quote.id, revisionPage: 5, revisionPageSize: 5 });
  assert.ok(oldest.quotes.find((row) => row.id === quoted.quote.id)!.revisions.some((row) => row.revision === 1));
  assert.equal((await commercial.commercialWorkspace(seller, { q: client.companyName })).quotePage.total, 3);
  await rejects(() => commercial.commercialWorkspace(other, { quoteId: quoted.quote.id }), "NOT_FOUND");
  assert.equal((await commercial.commercialWorkspace(other, { q: client.companyName })).quotePage.total, 0);
  check("quote search, actual page IDs and all 22 revisions remain accessible without exposing foreign portfolio data");

  const finalRevision = await prisma.quoteRevision.findUniqueOrThrow({ where: { quoteId_revision: { quoteId: quoted.quote.id, revision: latest } } });
  let concurrentApproval: Promise<unknown> | undefined, concurrentQuote: Promise<unknown> | undefined;
  const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  async function waitForTableWaiter(table: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await prisma.$queryRaw<Array<{ waiting: bigint }>>`SELECT COUNT(*) AS waiting FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON w.REQUESTING_ENGINE_LOCK_ID = l.ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA = ${databaseName} AND l.OBJECT_NAME = ${table}`;
      if (Number(rows[0]?.waiting) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Expected InnoDB lock waiter on " + table);
  }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM portfolio_client_accounts WHERE id = ${client.id} FOR UPDATE`;
    concurrentApproval = commercial.requestCommercialApproval({ revisionId: finalRevision.id, action: "send_quote" }, seller);
    await waitForTableWaiter("portfolio_client_accounts");
    concurrentQuote = commercial.createCommercialQuote({ ...quoteInput, requestKey: randomUUID() }, seller);
    await waitForTableWaiter("portfolio_users");
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000 });
  await Promise.all([concurrentApproval, concurrentQuote]);
  check("real InnoDB create and approval requests acquire the actor before the portfolio and both commit without a lock inversion");

  const holdApproval = await commercial.requestCommercialApproval({ revisionId: finalRevision.id, action: "create_hold", holdExpiresAt: new Date(Date.now() + 3600000).toISOString() }, seller);
  await commercial.decideCommercialApproval({ approvalId: holdApproval.id, decision: "approved" }, manager);
  const executed = await commercial.executeCommercialHold({ approvalId: holdApproval.id }, manager);
  const holdIds = (executed.result as { reservationIds: string[] }).reservationIds;
  const held = await prisma.reservation.findMany({ where: { id: { in: holdIds } } });
  assert.equal(held.length, 2);
  for (const row of held) {
    assert.equal(row.status, "HOLD");
    assert.equal(row.amount, row.locationId === locationIds[0] ? 80 : 100);
    assert.equal(row.monthlyRentTotal, 180); assert.equal(row.currency, "EUR");
    assert.equal(row.paymentTermDays, 15); assert.equal(row.billingRule, "monthly_after_service");
    assert.ok(row.notes?.includes(finalRevision.id));
  }
  assert.equal((await commercial.executeCommercialHold({ approvalId: holdApproval.id }, manager)).replayed, true);
  await prisma.location.updateMany({ where: { id: { in: locationIds } }, data: { rateCardValue: 999 } });
  const bookingOptions = { cancellationReason: null, expectedVersions: Object.fromEntries(held.map((row) => [row.id, row.updatedAt.toISOString()])) };
  await updateReservationGroupStatus(holdIds[0], "BOOKED", manager, bookingOptions);
  const booked = await prisma.reservation.findMany({ where: { id: { in: holdIds } }, include: { priceSegments: true } });
  for (const row of booked) {
    assert.equal(row.amount, row.locationId === locationIds[0] ? 80 : 100);
    assert.equal(Number(row.priceSegments[0].monthlyRent), row.amount);
    assert.equal(row.paymentTermDays, 15);
  }
  assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: draft.id } })).totalContractValue?.toFixed(2), "180.00");
  check("approved negotiated per-face prices survive HOLD, retry and BOOKED even after the catalog tariff changes");

  const rental = await prisma.reservation.create({ data: { locationId: locationIds[0], clientId: client.id, campaignId: directCampaign.id, ownerId: seller.id, sellerUserId: seller.id, clientName: "Synthetic", status: "BOOKED", periodStart: new Date("2092-01-01"), periodEnd: new Date("2092-01-31"), currency: "RON", amount: 200, monthlyRentShare: 200, priceSegments: { create: [{ effectiveFrom: new Date("2092-01-01"), effectiveTo: new Date("2092-01-15"), monthlyRent: new Prisma.Decimal(100), currency: "RON" }, { effectiveFrom: new Date("2092-01-16"), effectiveTo: new Date("2092-01-31"), monthlyRent: new Prisma.Decimal(200), currency: "RON" }] } } });
  await assert.rejects(() => updateCampaign(directCampaign.id, { currency: "EUR" }, seller), /Moneda trebuie/);
  await prisma.$transaction((tx) => syncCampaignCommercialSummary(tx, directCampaign.id));
  assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: directCampaign.id } })).totalContractValue?.toFixed(2), "151.61");
  await prisma.rentalPriceSegment.updateMany({ where: { rentalId: rental.id, monthlyRent: 100 }, data: { effectiveTo: new Date("2092-01-14") } });
  await prisma.$transaction((tx) => syncCampaignCommercialSummary(tx, directCampaign.id));
  assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: directCampaign.id } })).totalContractValue, null);
  const grouped = deriveCampaignCommercialSummary([33.33, 33.33, 33.34].map((amount) => ({ status: "BOOKED", periodStart: "2092-01-01", periodEnd: "2092-01-05", contractGroupId: "round-once", amount, currency: "RON" })));
  assert.equal(grouped.totalContractValue, 16.13);
  check("amended segments determine campaign totals; gaps fail closed and physical-face shares are rounded once per contract month");
  console.log(JSON.stringify({ ok: true, groups, syntheticOnly: true, customerContacts: 0, fiscalInvoices: 0 }));
}

async function cleanup() {
  const quotes = await prisma.commercialQuote.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
  const revisions = await prisma.quoteRevision.findMany({ where: { quoteId: { in: quotes.map((row) => row.id) } }, select: { id: true } });
  await prisma.commercialApproval.deleteMany({ where: { revisionId: { in: revisions.map((row) => row.id) } } });
  await prisma.quoteRevision.deleteMany({ where: { id: { in: revisions.map((row) => row.id) } } });
  await prisma.commercialQuote.deleteMany({ where: { id: { in: quotes.map((row) => row.id) } } });
  await prisma.commercialPolicy.deleteMany({ where: { approvedByUserId: { in: userIds } } });
  await prisma.reservation.deleteMany({ where: { locationId: { in: locationIds } } });
  await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
  await prisma.clientContact.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.clientAccount.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.crmEvent.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.crmOpportunity.deleteMany({ where: { id: { in: opportunityIds } } });
  await prisma.crmCompanyContact.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
  await prisma.location.deleteMany({ where: { id: { in: locationIds } } });
  if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await cleanup(); await prisma.$disconnect(); });
