import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
import { prisma } from "../src/lib/prisma";
import { getCampaignOverview, getCampaignsPage } from "../src/lib/client-campaign-workspaces";
import { syncCampaignCommercialSummary } from "../src/lib/campaigns/campaign-commercial-summary";

async function main() {
  loadEnvFile(); assertSyntheticEnvironment();
  const endpoint = new URL(process.env.DATABASE_URL || "invalid:");
  assert.ok(["127.0.0.1", "localhost"].includes(endpoint.hostname));
  assert.notEqual(process.env.NODE_ENV, "production");
  const tag = `sim-workspace-${randomUUID()}`;
  const ids = { seller: `${tag}-seller`, other: `${tag}-other`, client: `${tag}-client`, agency: `${tag}-agency`, end: `${tag}-end`, foreign: `${tag}-foreign`, category: `${tag}-category`, location: `${tag}-location`, campaign: `${tag}-campaign`, draft: `${tag}-draft`, rental: `${tag}-rental` };
  const actor = { id: ids.seller, name: "SIM Seller", email: `${tag}@example.invalid`, role: "SALES_AGENT" } as any;
  const results: { name: string; passed: boolean; error?: string }[] = [];
  async function check(name: string, run: () => Promise<void>) {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) }); }
  }
  try {
    await prisma.user.createMany({ data: [ids.seller, ids.other].map((id) => ({ id, email: `${id}@example.invalid`, name: id, passwordHash: "synthetic-unusable", role: "SALES_AGENT", active: true })) });
    await prisma.clientAccount.createMany({ data: [ids.client, ids.agency, ids.end, ids.foreign].map((id) => ({ id, companyName: id, accountOwnerUserId: id === ids.foreign ? ids.other : ids.seller, clientType: id === ids.agency ? "agency" : "direct_client" })) });
    await prisma.category.create({ data: { id: ids.category, name: tag, slug: tag } });
    await prisma.location.create({ data: { id: ids.location, categoryId: ids.category, code: tag, city: "SIM Bucuresti", type: "Billboard", showInPublic: false } });
    await prisma.campaign.createMany({ data: [ids.campaign, ids.draft].map((id) => ({ id, clientId: ids.client, campaignName: id, status: "draft", currency: "EUR", companyEntity: "Focus Media", sellerUserId: ids.seller, accountOwnerUserId: ids.seller, campaignType: "agency", agencyClientId: ids.agency, endClientId: ids.end })) });
    await prisma.reservation.create({ data: { id: ids.rental, locationId: ids.location, clientId: ids.client, campaignId: ids.campaign, clientName: "SIM Client", status: "BOOKED", periodStart: new Date("2092-01-01Z"), periodEnd: new Date("2092-02-29Z"), amount: 150, monthlyRentShare: 150, currency: "EUR", ownerId: ids.seller, sellerUserId: ids.seller } });
    await prisma.rentalPriceSegment.createMany({ data: [
      { rentalId: ids.rental, effectiveFrom: new Date("2092-01-01Z"), effectiveTo: new Date("2092-01-31Z"), monthlyRent: 100, currency: "EUR" },
      { rentalId: ids.rental, effectiveFrom: new Date("2092-02-01Z"), effectiveTo: new Date("2092-02-29Z"), monthlyRent: 150, currency: "EUR" },
    ] });
    await prisma.$transaction((tx) => syncCampaignCommercialSummary(tx, ids.campaign));
    await check("detail/list/persisted summary agree after an effective-dated price amendment", async () => {
      const [overview, page, stored] = await Promise.all([getCampaignOverview(actor, ids.campaign), getCampaignsPage(actor, { query: ids.campaign }), prisma.campaign.findUniqueOrThrow({ where: { id: ids.campaign } })]);
      assert.equal(Number(stored.totalContractValue), 250);
      assert.equal(page.items.find((row) => row.id === ids.campaign)?.totalContractValue, 250);
      assert.equal(overview?.totalContractValue, 250);
      assert.deepEqual(overview?.commercialDataQualityReasons, []);
    });
    await check("an explicitly chosen proposal currency survives a draft without BOOKED rentals", async () => {
      assert.equal((await getCampaignOverview(actor, ids.draft))?.currency, "EUR");
    });
    await check("campaign detail identifies agency and advertiser without exposing their contact data", async () => {
      const overview = await getCampaignOverview(actor, ids.campaign) as any;
      assert.equal(overview.agencyClientId, ids.agency); assert.equal(overview.agencyClientName, ids.agency);
      assert.equal(overview.endClientId, ids.end); assert.equal(overview.endClientName, ids.end);
      assert.deepEqual(overview.relationshipDataQualityReasons, []);
      assert.equal("agencyClientEmail" in overview, false);
    });
    await check("foreign legacy party links are redacted and flagged rather than exposing identities", async () => {
      await prisma.campaign.update({ where: { id: ids.campaign }, data: { endClientId: ids.foreign } });
      const overview = await getCampaignOverview(actor, ids.campaign) as any;
      assert.equal(overview.endClientId, null); assert.equal(overview.endClientName, null);
      assert.ok(overview.relationshipDataQualityReasons.includes("CAMPAIGN_END_CLIENT_LINK_INACCESSIBLE"));
      const manager = await getCampaignOverview({ ...actor, role: "COO" }, ids.campaign) as any;
      assert.equal(manager.endClientId, ids.foreign);
    });
    console.log(JSON.stringify({ ok: results.every((row) => row.passed), results }, null, 2));
    if (results.some((row) => !row.passed)) process.exitCode = 1;
  } finally {
    await prisma.rentalPriceSegment.deleteMany({ where: { rentalId: ids.rental } });
    await prisma.reservation.deleteMany({ where: { id: ids.rental } });
    await prisma.campaign.deleteMany({ where: { id: { in: [ids.campaign, ids.draft] } } });
    await prisma.location.deleteMany({ where: { id: ids.location } });
    await prisma.category.deleteMany({ where: { id: ids.category } });
    await prisma.clientAccount.deleteMany({ where: { id: { in: [ids.client, ids.agency, ids.end, ids.foreign] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.seller, ids.other] } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
