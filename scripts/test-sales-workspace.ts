import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { getSalesDashboardData } from "../src/lib/dashboard/sales-dashboard";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";

loadEnvFile(); assertSyntheticEnvironment();
const url = new URL(process.env.DATABASE_URL!);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !/^\/focus_(preview|test)_/.test(url.pathname) || process.env.VERCEL_ENV === "production") throw Error("Local synthetic database required");
const tag = `sales-workspace-${randomUUID()}`;
const now = new Date("2090-01-14T22:30:00Z"); // 15 January in Bucharest.
const created: { users: string[]; clients: string[]; campaigns: string[]; locations: string[]; category?: string; company?: string } = { users: [], clients: [], campaigns: [], locations: [] };

async function main() {
  try {
    const seller = await prisma.user.create({ data: { name: tag, email: `${tag}@example.invalid`, role: "SALES_AGENT", passwordHash: "synthetic-unused" } }); created.users.push(seller.id);
    const colleague = await prisma.user.create({ data: { name: `${tag}-colleague`, email: `${tag}-colleague@example.invalid`, role: "SALES_AGENT", passwordHash: "synthetic-unused" } }); created.users.push(colleague.id);
    const category = await prisma.category.create({ data: { name: tag, slug: tag } }); created.category = category.id;
    const client = await prisma.clientAccount.create({ data: { companyName: tag, accountOwnerUserId: seller.id } }); created.clients.push(client.id);
    const campaign = await prisma.campaign.create({ data: { clientId: client.id, campaignName: `${tag}-renewal`, status: "active", sellerUserId: seller.id, accountOwnerUserId: seller.id, currency: "RON", startDate: new Date("2090-01-01"), endDate: new Date("2090-02-14") } }); created.campaigns.push(campaign.id);
    const location = async (suffix: string) => { const row = await prisma.location.create({ data: { code: `${tag}-${suffix}`, city: "Synthetic", address: "Synthetic", type: "Panou", categoryId: category.id, lifecycleStatus: "ACTIVE", showInPublic: false } }); created.locations.push(row.id); return row; };
    const bookedLocation = await location("booked"), heldLocation = await location("held"), foreignLocation = await location("foreign");
    await prisma.reservation.create({ data: { locationId: bookedLocation.id, clientId: client.id, campaignId: campaign.id, clientName: tag, ownerId: seller.id, sellerUserId: seller.id, status: "BOOKED", amount: 1000, monthlyRentShare: 1000, currency: "RON", periodStart: new Date("2090-01-01"), periodEnd: new Date("2090-02-14") } });
    const hold = await prisma.reservation.create({ data: { locationId: heldLocation.id, clientName: tag, ownerId: seller.id, sellerUserId: seller.id, status: "HOLD", periodStart: new Date("2090-01-20"), periodEnd: new Date("2090-01-30"), holdExpiresAt: new Date(now.getTime() + 3_600_000) } });
    await prisma.reservation.create({ data: { locationId: foreignLocation.id, clientName: `${tag}-PRIVATE-FOREIGN`, ownerId: colleague.id, sellerUserId: colleague.id, status: "BOOKED", amount: 1000, currency: "RON", periodStart: new Date("2090-01-01"), periodEnd: new Date("2090-02-14") } });
    const company = await prisma.crmCompany.create({ data: { name: tag, normalizedName: tag, ownerId: seller.id } }); created.company = company.id;
    const action = await prisma.crmNextAction.create({ data: { companyId: company.id, ownerId: seller.id, type: "call", description: tag, dueAt: new Date("2090-01-14T23:00:00Z") } });
    const data = await getSalesDashboardData({ id: seller.id, name: seller.name, email: seller.email, role: "SALES_AGENT", tokenVersion: 0, iat: 1, exp: 4_000_000_000 }, now);
    assert.equal(data.summary.followUpsDue, 1, "a UTC previous-day call belongs to the new Bucharest business day");
    assert.equal(data.summary.overdueFollowUps, 0, "a call later today must not be labelled overdue");
    assert.equal(data.agenda.find((item) => item.id === `follow-${action.id}`)?.urgency, "high");
    assert.equal(data.agenda.find((item) => item.id === `hold-${hold.id}`)?.urgency, "critical", "an expiring HOLD actually appears in the actionable agenda");
    assert.equal(data.agenda.some((item) => item.kind === "campaign_end" && item.context.includes("30 zile")), true, "renewals start sixty days ahead, not only in the final week");
    assert.equal(data.inventory?.dateKey, "2090-01-15");
    assert.ok(data.inventory && data.inventory.occupiedToday >= 2, "availability includes the colleague's bookings without publishing their customer");
    assert.equal(JSON.stringify(data).includes(`${tag}-PRIVATE-FOREIGN`), false, "sales agenda does not disclose another portfolio");
    console.log(JSON.stringify({ ok: true, groups: 6, database: "isolated local synthetic", scope: "service queries, Bucharest dates, expiry, renewals, canonical inventory and ownership" }));
  } finally {
    await prisma.crmNextAction.deleteMany({ where: { companyId: created.company || "never-created" } });
    await prisma.crmCompany.deleteMany({ where: { id: created.company || "never-created" } });
    await prisma.reservation.deleteMany({ where: { locationId: { in: created.locations } } });
    await prisma.campaign.deleteMany({ where: { id: { in: created.campaigns } } });
    await prisma.clientAccount.deleteMany({ where: { id: { in: created.clients } } });
    await prisma.location.deleteMany({ where: { id: { in: created.locations } } });
    await prisma.category.deleteMany({ where: { id: created.category || "never-created" } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
