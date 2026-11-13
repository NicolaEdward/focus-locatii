import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthSession } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";
import { commercialHash, commercialPolicyHash, tokenHash } from "../src/lib/commercial-workbench-core";
import { getCommercialQuotePrint } from "../src/lib/commercial-quote-print";
import * as commercial from "../src/lib/commercial-workbench";
import { assertSyntheticEnvironment } from "./release/env-utils";

assertSyntheticEnvironment();
const connection = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(connection.hostname) || !/^\/focus_(preview|test)_/.test(connection.pathname) || process.env.VERCEL_ENV === "production") throw Error("Local synthetic database required");
const tag = `policy-separation-${randomUUID()}`;
const ids: { users: string[]; client?: string; campaign?: string; category?: string; location?: string } = { users: [] };
const economic = { vatRateBps: 2100, vatTreatment: "exclusive", rateCardCurrency: "EUR", quoteValidityDays: 7, approvalHours: 24 };
const automation = { agentToolsEnabled: true, generationEnabled: false, outboundEnabled: false, maxDailyModelCalls: 3 };
const rejects = (run: () => Promise<unknown>, code: string) => assert.rejects(run, (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === code));

async function actor(role: AuthSession["role"], suffix: string): Promise<AuthSession> {
  const row = await prisma.user.create({ data: { name: tag, email: `${tag}-${suffix}@example.invalid`, role, passwordHash: "unused-synthetic" } }); ids.users.push(row.id);
  return { ...row, iat: 1, exp: 9999999999 };
}
async function currentPolicy() { return prisma.commercialPolicy.findUniqueOrThrow({ where: { id: "default" } }); }

async function main() {
  assert.equal(await prisma.commercialPolicy.count(), 0, "Use a dedicated empty policy dataset");
  try {
    const manager = await actor("COO", "manager"), seller = await actor("SALES_AGENT", "seller");
    const initial = await commercial.saveCommercialSettings({ ...economic, expectedVersion: null }, manager);
    const client = await prisma.clientAccount.create({ data: { companyName: tag, accountOwnerUserId: seller.id } }); ids.client = client.id;
    const campaign = await prisma.campaign.create({ data: { clientId: client.id, campaignName: tag, sellerUserId: seller.id, currency: "EUR", companyEntity: "Focus Media", paymentTermType: "30_days", paymentTermDays: 30, billingRule: "monthly_in_advance", billingFrequency: "monthly" } }); ids.campaign = campaign.id;
    const category = await prisma.category.create({ data: { name: tag, slug: tag } }); ids.category = category.id;
    const location = await prisma.location.create({ data: { categoryId: category.id, code: tag, type: "Panou", city: "Synthetic", lifecycleStatus: "ACTIVE", rateCardValue: 100, showInPublic: false } }); ids.location = location.id;
    const input = { clientId: client.id, campaignId: campaign.id, recipient: "synthetic@example.invalid", companyEntity: "Focus Media", periodStart: "2091-01-01", periodEnd: "2091-01-31", locationIds: [location.id], requestKey: randomUUID() };
    const quote = await commercial.createCommercialQuote(input, seller);
    assert.equal((quote.revision.payload as Record<string, unknown>).commercialPolicyHash, commercialPolicyHash(initial));
    const approval = await commercial.requestCommercialApproval({ revisionId: quote.revision.id, action: "send_quote" }, seller);
    await commercial.decideCommercialApproval({ approvalId: approval.id, decision: "approved" }, manager);
    assert.equal((await getCommercialQuotePrint(quote.quote.id, quote.revision.id, seller)).state, "approved");

    const afterAutomation = await commercial.saveCommercialAutomation({ ...automation, expectedVersion: initial.version }, manager);
    assert.ok(afterAutomation.version > initial.version, "global CAS version must still detect automation edits");
    assert.equal((await getCommercialQuotePrint(quote.quote.id, quote.revision.id, seller)).state, "approved", "a tool budget change does not alter the human-approved offer");
    await commercial.requestCommercialApproval({ revisionId: quote.revision.id, action: "send_quote" }, seller);
    const principal = await prisma.agentPrincipal.create({ data: { name: tag, ownerUserId: seller.id, createdByUserId: manager.id, tokenHash: tokenHash(tag), scopes: ["inventory.search"], mode: "shadow", maxDailyCommands: 5, expiresAt: new Date(Date.now() + 86400000) } });
    const tool = await commercial.executeAgentTool(principal, { tool: "inventory.search", requestKey: randomUUID(), input: { query: tag, limit: 1 } });
    assert.equal(tool.failed, false);
    await commercial.stopCommercialAutomation(manager);
    await rejects(() => commercial.executeAgentTool(principal, { tool: "inventory.search", requestKey: randomUUID(), input: { query: tag, limit: 1 } }), "AGENT_STOPPED");
    assert.equal((await getCommercialQuotePrint(quote.quote.id, quote.revision.id, seller)).state, "approved", "the AI kill switch does not invalidate a human-only commercial offer");
    await rejects(() => commercial.saveCommercialAutomation({ ...automation, expectedVersion: afterAutomation.version }, manager), "POLICY_VERSION_CONFLICT");

    const beforeTax = await currentPolicy();
    await commercial.saveCommercialSettings({ ...economic, vatRateBps: 1900, expectedVersion: beforeTax.version }, manager);
    await rejects(() => commercial.requestCommercialApproval({ revisionId: quote.revision.id, action: "send_quote" }, seller), "POLICY_CHANGED");
    await rejects(() => commercial.queueCommercialDispatch({ approvalId: approval.id }, seller), "POLICY_CHANGED");
    assert.equal((await getCommercialQuotePrint(quote.quote.id, quote.revision.id, seller)).state, "draft");
    assert.equal(await prisma.commercialDispatch.count({ where: { revisionId: quote.revision.id } }), 0);
    await commercial.saveCommercialSettings({ ...economic, expectedVersion: (await currentPolicy()).version }, manager);
    await commercial.saveCommercialSettings({ ...economic, approvalHours: 12, expectedVersion: (await currentPolicy()).version }, manager);
    await rejects(() => commercial.requestCommercialApproval({ revisionId: quote.revision.id, action: "send_quote" }, seller), "POLICY_CHANGED");
    await commercial.saveCommercialSettings({ ...economic, expectedVersion: (await currentPolicy()).version }, manager);

    // Existing versions are left byte-for-byte intact and retain the strict
    // global-version rule because they have no economic fingerprint.
    const legacyPayload = { ...(quote.revision.payload as Record<string, unknown>) };
    delete legacyPayload.commercialPolicyHash;
    const legacyQuote = await prisma.commercialQuote.create({ data: { ownerUserId: seller.id, clientId: client.id, campaignId: campaign.id } });
    const legacyRevision = await prisma.quoteRevision.create({ data: { quoteId: legacyQuote.id, revision: 1, createdByUserId: seller.id, payload: legacyPayload as Prisma.InputJsonObject, payloadHash: commercialHash(legacyPayload), requestKey: randomUUID(), intentHash: commercialHash(tag), totalNet: quote.revision.totalNet, totalTax: quote.revision.totalTax, totalGross: quote.revision.totalGross, currency: "EUR", expiresAt: quote.revision.expiresAt, availabilityHash: quote.revision.availabilityHash } });
    await rejects(() => commercial.requestCommercialApproval({ revisionId: legacyRevision.id, action: "send_quote" }, seller), "POLICY_CHANGED");
    assert.equal((await getCommercialQuotePrint(legacyQuote.id, legacyRevision.id, seller)).currentPolicy, false);

    await prisma.campaign.update({ where: { id: campaign.id }, data: { billingRule: "fixed_custom_date" } });
    const custom = await commercial.createCommercialQuote({ ...input, requestKey: randomUUID() }, seller);
    await rejects(() => commercial.requestCommercialApproval({ revisionId: custom.revision.id, action: "send_quote" }, seller), "CAMPAIGN_CALENDAR_REQUIRED");
    const recipientHash = tokenHash(input.recipient);
    const legacyCustomApproval = await prisma.commercialApproval.create({ data: { revisionId: custom.revision.id, action: "send_quote", state: "approved", payloadHash: commercialHash({ revisionHash: custom.revision.payloadHash, action: "send_quote", recipientHash, holdExpiresAt: null }), recipientHash, requestedByUserId: seller.id, approvedByUserId: manager.id, expiresAt: new Date(Date.now() + 3600000) } });
    await rejects(() => commercial.queueCommercialDispatch({ approvalId: legacyCustomApproval.id }, seller), "CAMPAIGN_CALENDAR_REQUIRED");
    assert.equal((await getCommercialQuotePrint(custom.quote.id, custom.revision.id, seller)).state, "draft");
    assert.equal(await prisma.commercialDispatch.count({ where: { revisionId: custom.revision.id } }), 0);
    await prisma.campaign.update({ where: { id: campaign.id }, data: { billingRule: "manual_per_contract", billingFrequency: "custom" } });
    const customFrequency = await commercial.createCommercialQuote({ ...input, requestKey: randomUUID() }, seller);
    await rejects(() => commercial.requestCommercialApproval({ revisionId: customFrequency.revision.id, action: "create_hold", holdExpiresAt: new Date(Date.now() + 3600000).toISOString() }, seller), "CAMPAIGN_CALENDAR_REQUIRED");
    console.log(JSON.stringify({ ok: true, groups: 8, scope: "independent economic fingerprint, global CAS, live AI kill switch, legacy fallback, fiscal invalidation and custom-calendar fail-closed approvals" }));
  } finally {
    const quotes = await prisma.commercialQuote.findMany({ where: { ownerUserId: { in: ids.users } }, select: { id: true } });
    const revisions = await prisma.quoteRevision.findMany({ where: { quoteId: { in: quotes.map((quote) => quote.id) } }, select: { id: true } });
    await prisma.commercialDispatch.deleteMany({ where: { revisionId: { in: revisions.map((revision) => revision.id) } } });
    await prisma.commercialApproval.deleteMany({ where: { revisionId: { in: revisions.map((revision) => revision.id) } } });
    await prisma.quoteRevision.deleteMany({ where: { quoteId: { in: quotes.map((quote) => quote.id) } } });
    await prisma.commercialQuote.deleteMany({ where: { id: { in: quotes.map((quote) => quote.id) } } });
    const principals = await prisma.agentPrincipal.findMany({ where: { ownerUserId: { in: ids.users } }, select: { id: true } });
    await prisma.agentCommand.deleteMany({ where: { principalId: { in: principals.map((principal) => principal.id) } } });
    await prisma.agentUsageDay.deleteMany({ where: { principalId: { in: principals.map((principal) => principal.id) } } });
    await prisma.agentPrincipal.deleteMany({ where: { id: { in: principals.map((principal) => principal.id) } } });
    await prisma.commercialPolicy.deleteMany({ where: { approvedByUserId: { in: ids.users } } });
    if (ids.campaign) await prisma.campaign.deleteMany({ where: { id: ids.campaign } });
    if (ids.client) await prisma.clientAccount.deleteMany({ where: { id: ids.client } });
    if (ids.location) await prisma.location.deleteMany({ where: { id: ids.location } });
    if (ids.category) await prisma.category.deleteMany({ where: { id: ids.category } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
