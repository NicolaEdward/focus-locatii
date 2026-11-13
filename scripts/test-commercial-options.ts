import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { commercialOptions } from "../src/lib/commercial-options";
import { commercialWorkspace } from "../src/lib/commercial-workbench";
import type { AuthSession } from "../src/lib/auth";
import { assertSyntheticEnvironment } from "./release/env-utils";

assertSyntheticEnvironment();
assert.ok(["127.0.0.1", "localhost"].includes(new URL(process.env.DATABASE_URL || "invalid:").hostname));
assert.notEqual(process.env.NODE_ENV, "production");
const tag = `sim-options-${randomUUID()}`;
const owner = `${tag}-owner`, other = `${tag}-other`, company = `${tag}-crm`;
const clientIds = Array.from({ length: 520 }, (_, index) => `${tag}-client-${String(index).padStart(3, "0")}`);
const campaignIds = Array.from({ length: 520 }, (_, index) => `${tag}-campaign-${String(index).padStart(3, "0")}`);
const foreign = `${tag}-foreign`, archived = `${tag}-archived`;
let quoteId = "";
const actor = { id: owner, role: "SALES_AGENT", tokenVersion: 0, name: "SIM Options", email: `${tag}@example.invalid`, iat: 1, exp: 9999999999 } as AuthSession;
let groups = 0;
const passed = (label: string) => { groups++; console.log("✓ " + label); };
async function main() {
  try {
    await prisma.user.createMany({ data: [owner, other].map((id) => ({ id, email: id + "@example.invalid", name: id, role: "SALES_AGENT", active: true, passwordHash: "synthetic-unused" })) });
    await prisma.clientAccount.createMany({ data: [...clientIds.map((id, index) => ({ id, companyName: id, taxId: `SIM${index}TAX`, accountOwnerUserId: owner })),
      { id: foreign, companyName: foreign, accountOwnerUserId: other }, { id: archived, companyName: archived, status: "archived", accountOwnerUserId: owner }] });
    await prisma.campaign.createMany({ data: campaignIds.map((id) => ({ id, clientId: clientIds[501], campaignName: id, sellerUserId: owner, accountOwnerUserId: owner, currency: "EUR", companyEntity: "Focus Media" })) });
    await prisma.crmCompany.create({ data: { id: company, name: company, normalizedName: company, ownerId: owner } });
    await prisma.crmOpportunity.createMany({ data: Array.from({ length: 105 }, (_, index) => ({ id: `${tag}-opp-${index}`, companyId: company, ownerId: owner, name: `${tag}-opportunity-${index}`, initialSnapshot: {} })) });
    const first = await commercialOptions(actor, { kind: "clients", q: tag, pageSize: 50 });
    assert.equal(first.page.total, 520); assert.equal(first.rows.length, 50); assert.equal(first.page.totalPages, 11);
    const last = await commercialOptions(actor, { kind: "clients", q: tag, page: 11, pageSize: 50 });
    assert.equal(last.rows.length, 20); assert.ok(last.rows.some((row) => row.id === clientIds[519]));
    assert.ok(!first.rows.some((row) => last.rows.some((tail) => tail.id === row.id)));
    passed("520 authorized clients are counted and paginated without a silent first-500 boundary");
    const exact = await commercialOptions(actor, { kind: "clients", q: "SIM519TAX", ids: clientIds[501] });
    assert.equal(exact.rows[0]?.id, clientIds[519]); assert.equal(exact.selected[0]?.id, clientIds[501]);
    const denied = await commercialOptions(actor, { kind: "clients", ids: `${foreign},${archived},does-not-exist` });
    assert.equal(denied.selected.length, 0);
    passed("CUI search and off-page selected-ID hydration preserve client identity without exposing foreign or archived clients");
    const campaigns = await commercialOptions(actor, { kind: "campaigns", clientId: clientIds[501], q: tag, page: 11, ids: campaignIds[1] });
    assert.equal(campaigns.page.total, 520); assert.equal(campaigns.rows.length, 20); assert.equal(campaigns.selected[0]?.id, campaignIds[1]);
    const wrongClient = await commercialOptions(actor, { kind: "campaigns", clientId: foreign, ids: campaignIds[1] });
    assert.equal(wrongClient.page.total, 0); assert.equal(wrongClient.selected.length, 0);
    passed("campaign search is complete, client-scoped, and hydrates the selected campaign independently of its page");
    const quote = await prisma.commercialQuote.create({ data: { ownerUserId: owner, clientId: clientIds[501], campaignId: campaignIds[519] } }); quoteId = quote.id;
    const document = await prisma.clientDocument.create({ data: { clientId: clientIds[501], campaignId: campaignIds[519], fileName: "SIM-OOH off-page contract.pdf", documentType: "contract", storageUrl: "data:application/pdf;base64,JVBERi0xLjQ=", uploadedByUserId: owner } });
    const workspace = await commercialWorkspace(actor, { quoteId });
    assert.ok(workspace.clients.some((row) => row.id === clientIds[501]));
    assert.ok(workspace.campaigns.some((row) => row.id === campaignIds[519]));
    assert.ok(workspace.documents.some((row) => row.id === document.id));
    assert.ok(!workspace.clients.some((row) => row.id === foreign));
    passed("an off-page offer keeps its exact client, campaign and contractual evidence through the acceptance handoff");
    const opportunity = await commercialOptions(actor, { kind: "opportunities", q: tag, ids: `${tag}-opp-104` });
    assert.equal(opportunity.page.total, 105); assert.equal(opportunity.selected[0]?.id, `${tag}-opp-104`);
    passed("a CRM opportunity beyond the initial 100 remains attached to the commercial intention");
    await assert.rejects(() => commercialOptions({ ...actor, role: "FIELD_OPERATOR" }, { kind: "clients" }), (error: any) => error.code === "FORBIDDEN");
    await assert.rejects(() => commercialOptions(actor, { kind: "clients", ids: Array.from({ length: 51 }, (_, n) => `id${n}`).join(",") }));
    await assert.rejects(() => commercialOptions(actor, { kind: "clients", pageSize: 101 }));
    await assert.rejects(() => commercialOptions(actor, { kind: "clients", ids: "../private" }));
    passed("unauthorized roles and unbounded or malformed search payloads are refused");
    console.log(JSON.stringify({ suite: "commercial-options", groups, passed: groups, syntheticOnly: true }));
  } finally {
    if (quoteId) await prisma.commercialQuote.deleteMany({ where: { id: quoteId } });
    await prisma.crmOpportunity.deleteMany({ where: { companyId: company } });
    await prisma.crmCompany.deleteMany({ where: { id: company } });
    await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.clientAccount.deleteMany({ where: { id: { in: [...clientIds, foreign, archived] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, other] } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
