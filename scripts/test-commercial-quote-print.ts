import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AuthSession } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";
import { commercialHash, tokenHash } from "../src/lib/commercial-workbench-core";
import { getCommercialQuotePrint } from "../src/lib/commercial-quote-print";
import { assertSyntheticEnvironment } from "./release/env-utils";

assertSyntheticEnvironment();
const database = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(database.hostname) || !/^\/focus_(preview|test)_/.test(database.pathname) || process.env.VERCEL_ENV === "production") throw Error("Isolated local synthetic database required");
const tag = `quote-print-${randomUUID()}`;
const ids: { users: string[]; client?: string; campaign?: string; quote?: string } = { users: [] };
let policyCreated = false;
const now = new Date();
const expiresAt = new Date(now.getTime() + 7 * 86400000);
const rejected = (fn: () => Promise<unknown>, code: string) => assert.rejects(fn, (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === code));

async function user(role: AuthSession["role"], suffix: string) {
  const row = await prisma.user.create({ data: { name: tag + suffix, email: `${tag + suffix}@example.invalid`, role, passwordHash: "synthetic-unused" } }); ids.users.push(row.id);
  return { ...row, iat: 1, exp: 9999999999 };
}

async function main() {
  assert.equal(await prisma.commercialPolicy.count(), 0, "The print fixture requires an empty commercial policy dataset");
  try {
    const seller = await user("SALES_AGENT", "seller"), manager = await user("COO", "manager"), other = await user("SALES_AGENT", "other"), field = await user("FIELD_OPERATOR", "field");
    const client = await prisma.clientAccount.create({ data: { companyName: tag, accountOwnerUserId: seller.id } }); ids.client = client.id;
    const campaign = await prisma.campaign.create({ data: { clientId: client.id, campaignName: tag, sellerUserId: seller.id, currency: "EUR", companyEntity: "Focus Media", paymentTermType: "30_days", paymentTermDays: 30, billingRule: "monthly_in_advance", billingFrequency: "monthly" } }); ids.campaign = campaign.id;
    await prisma.commercialPolicy.create({ data: { id: "default", vatRateBps: 2100, vatTreatment: "exclusive", rateCardCurrency: "EUR", approvedByUserId: manager.id } }); policyCreated = true;
    const payload = { schemaVersion: 2, clientId: client.id, campaignId: campaign.id, clientName: tag, campaignName: tag, companyEntity: "Focus Media", recipient: "synthetic@example.invalid", periodStart: "2091-01-01", periodEnd: "2091-01-31", currency: "EUR", policyVersion: 1, paymentTermType: "30_days", paymentTermDays: 30, billingRule: "monthly_in_advance", billingFrequency: "monthly", vatRateBps: 2100, vatTreatment: "exclusive", assumptions: "Condiții <script>neexecutabile</script>", lines: [{ locationId: "synthetic-face-id", code: "FACE-1", city: "Synthetic City", monthlyRate: "80.00", listMonthlyRate: "100.00", net: "80.00", tax: "16.80", gross: "96.80" }], totals: { net: "80.00", tax: "16.80", gross: "96.80" } };
    const quote = await prisma.commercialQuote.create({ data: { ownerUserId: seller.id, clientId: client.id, campaignId: campaign.id } }); ids.quote = quote.id;
    const revision = await prisma.quoteRevision.create({ data: { quoteId: quote.id, revision: 1, createdByUserId: seller.id, payload, payloadHash: commercialHash(payload), requestKey: tag, intentHash: commercialHash(tag), totalNet: 80, totalTax: 16.8, totalGross: 96.8, currency: "EUR", expiresAt, availabilityHash: commercialHash("synthetic-availability") } });
    const draft = await getCommercialQuotePrint(quote.id, revision.id, seller, now);
    assert.equal(draft.state, "draft"); assert.equal(draft.payload.lines[0].monthlyRate, "80.00");
    assert.equal(draft.payload.assumptions, payload.assumptions, "unsafe-looking notes remain text for React escaping, never HTML");
    assert.equal(draft.payloadHash, revision.payloadHash);
    await rejected(() => getCommercialQuotePrint(quote.id, revision.id, other, now), "QUOTE_PRINT_NOT_FOUND");
    await rejected(() => getCommercialQuotePrint(quote.id, revision.id, field, now), "QUOTE_PRINT_FORBIDDEN");
    await rejected(() => getCommercialQuotePrint(quote.id, "another-revision", manager, now), "QUOTE_PRINT_NOT_FOUND");
    await rejected(() => getCommercialQuotePrint(quote.id, revision.id, { ...seller, tokenVersion: 999 }, now), "QUOTE_PRINT_SESSION_CHANGED");
    const recipientHash = tokenHash(payload.recipient);
    const approval = await prisma.commercialApproval.create({ data: { revisionId: revision.id, action: "send_quote", state: "approved", payloadHash: commercialHash({ revisionHash: revision.payloadHash, action: "send_quote", recipientHash, holdExpiresAt: null }), recipientHash, requestedByUserId: seller.id, approvedByUserId: manager.id, expiresAt } });
    assert.equal((await getCommercialQuotePrint(quote.id, revision.id, seller, now)).state, "approved");
    const customPayload = { ...payload, billingRule: "fixed_custom_date", billingFrequency: "custom" };
    const customHash = commercialHash(customPayload);
    await prisma.campaign.update({ where: { id: campaign.id }, data: { billingRule: "fixed_custom_date", billingFrequency: "custom" } });
    await prisma.quoteRevision.update({ where: { id: revision.id }, data: { payload: customPayload, payloadHash: customHash } });
    await prisma.commercialApproval.update({ where: { id: approval.id }, data: { payloadHash: commercialHash({ revisionHash: customHash, action: "send_quote", recipientHash, holdExpiresAt: null }) } });
    assert.equal((await getCommercialQuotePrint(quote.id, revision.id, seller, now)).state, "draft", "a custom calendar without its dates is not represented as fully validated");
    await prisma.campaign.update({ where: { id: campaign.id }, data: { billingRule: payload.billingRule, billingFrequency: payload.billingFrequency } });
    await prisma.quoteRevision.update({ where: { id: revision.id }, data: { payload, payloadHash: revision.payloadHash } });
    await prisma.commercialApproval.update({ where: { id: approval.id }, data: { payloadHash: commercialHash("tampered") } });
    assert.equal((await getCommercialQuotePrint(quote.id, revision.id, seller, now)).state, "draft", "unbound approval cannot label a printed offer approved");
    await prisma.commercialApproval.update({ where: { id: approval.id }, data: { payloadHash: commercialHash({ revisionHash: revision.payloadHash, action: "send_quote", recipientHash, holdExpiresAt: null }) } });
    await prisma.commercialPolicy.update({ where: { id: "default" }, data: { version: 2 } });
    assert.equal((await getCommercialQuotePrint(quote.id, revision.id, seller, now)).state, "draft", "policy drift invalidates current approval label without changing the immutable prices");
    await prisma.commercialPolicy.update({ where: { id: "default" }, data: { version: 1 } });
    await prisma.campaign.update({ where: { id: campaign.id }, data: { paymentTermDays: 15 } });
    assert.equal((await getCommercialQuotePrint(quote.id, revision.id, seller, now)).state, "draft", "commercial term drift is visible on printed proposals");
    await prisma.campaign.update({ where: { id: campaign.id }, data: { paymentTermDays: 30 } });
    await prisma.commercialQuote.update({ where: { id: quote.id }, data: { latestRevision: 2 } });
    assert.equal((await getCommercialQuotePrint(quote.id, revision.id, seller, now)).state, "historical");
    await prisma.commercialQuote.update({ where: { id: quote.id }, data: { latestRevision: 1, state: "rejected" } });
    assert.equal((await getCommercialQuotePrint(quote.id, revision.id, seller, now)).state, "rejected");
    await prisma.commercialQuote.update({ where: { id: quote.id }, data: { state: "draft" } });
    assert.equal((await getCommercialQuotePrint(quote.id, revision.id, seller, new Date(expiresAt.getTime() + 1))).state, "expired");
    await prisma.clientAccount.update({ where: { id: client.id }, data: { accountOwnerUserId: other.id } });
    await rejected(() => getCommercialQuotePrint(quote.id, revision.id, seller, now), "QUOTE_PRINT_NOT_FOUND");
    assert.equal((await getCommercialQuotePrint(quote.id, revision.id, manager, now)).state, "draft", "management can inspect history after a portfolio transfer without claiming current approval");
    await prisma.clientAccount.update({ where: { id: client.id }, data: { accountOwnerUserId: seller.id } });
    await prisma.quoteRevision.update({ where: { id: revision.id }, data: { totalGross: 999 } });
    await rejected(() => getCommercialQuotePrint(quote.id, revision.id, seller, now), "QUOTE_PRINT_INTEGRITY");
    await prisma.quoteRevision.update({ where: { id: revision.id }, data: { totalGross: 96.8, payloadHash: commercialHash("corrupt") } });
    await rejected(() => getCommercialQuotePrint(quote.id, revision.id, seller, now), "QUOTE_PRINT_INTEGRITY");
    console.log(JSON.stringify({ ok: true, groups: 11, scope: "authenticated immutable quote printing, private portfolios, exact approval proof, custom calendar, policy and term drift, historical labels and financial integrity" }));
  } finally {
    if (ids.quote) {
      const revisions = await prisma.quoteRevision.findMany({ where: { quoteId: ids.quote }, select: { id: true } });
      await prisma.commercialApproval.deleteMany({ where: { revisionId: { in: revisions.map((row) => row.id) } } });
      await prisma.quoteRevision.deleteMany({ where: { quoteId: ids.quote } });
      await prisma.commercialQuote.deleteMany({ where: { id: ids.quote } });
    }
    if (ids.campaign) await prisma.campaign.deleteMany({ where: { id: ids.campaign } });
    if (ids.client) await prisma.clientAccount.deleteMany({ where: { id: ids.client } });
    if (policyCreated) await prisma.commercialPolicy.deleteMany({ where: { id: "default" } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
