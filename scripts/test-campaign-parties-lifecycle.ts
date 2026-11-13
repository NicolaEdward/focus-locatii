import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import type { AuthSession } from "../src/lib/auth";
import { createCampaign, updateCampaign } from "../src/lib/campaigns";
import { createReservation, extendReservationHold, releaseReservationHold, updateReservation, updateReservationGroupStatus } from "../src/lib/reservations";
import { assertSyntheticEnvironment } from "./release/env-utils";

assertSyntheticEnvironment();
const db = new URL(process.env.DATABASE_URL || "invalid:");
assert.ok(["127.0.0.1", "localhost"].includes(db.hostname) && db.pathname.startsWith("/focus_preview_"), "Local synthetic database only");
assert.notEqual(process.env.NODE_ENV, "production");
const baseline = process.argv.includes("--baseline-observation");
const tag = "SIM-OOH-parties-" + randomUUID();
const users: string[] = [], clients: string[] = [], campaigns: string[] = [], locations: string[] = [];
let categoryId = "";
const results: Array<{ id: string; action: string; expected: string; observed: string; passed: boolean; error?: string }> = [];
async function actor(role: AuthSession["role"], suffix: string): Promise<AuthSession> {
  const row = await prisma.user.create({ data: { role, email: tag + suffix + "@example.invalid", name: tag + suffix, passwordHash: "synthetic-unused", active: true } });
  users.push(row.id); return { ...row, iat: 1, exp: 9999999999 };
}
async function client(owner: AuthSession, suffix: string, status = "active") {
  const row = await prisma.clientAccount.create({ data: { companyName: tag + suffix, normalizedName: tag + suffix, accountOwnerUserId: owner.id, status } });
  clients.push(row.id); return row;
}
async function campaign(owner: AuthSession, clientId: string, suffix: string, extra: Record<string, unknown> = {}) {
  const row = await createCampaign({ clientId, campaignName: tag + suffix, sellerUserId: owner.id, accountOwnerUserId: owner.id, companyEntity: "Focus Media", currency: "EUR", paymentTermType: "15_days", billingRule: "monthly_after_service", billingFrequency: "monthly", ...extra }, owner);
  campaigns.push(row.id); return row;
}
async function check(id: string, action: string, allowed: boolean, run: () => Promise<unknown>) {
  let error: unknown;
  try { await run(); } catch (cause) { error = cause; }
  const result = { id, action, expected: allowed ? "allowed" : "rejected", observed: error instanceof assert.AssertionError ? "persisted_result_mismatch" : error ? "rejected" : "allowed", passed: !(error instanceof assert.AssertionError) && Boolean(error) !== allowed, ...(error instanceof Error ? { error: error.message } : {}) };
  results.push(result);
  if (!baseline) assert.ok(result.passed, `${id}: ${action}; expected ${result.expected}, observed ${result.observed}${result.error ? ": " + result.error : ""}`);
}
async function main() {
  const manager = await actor("COO", "manager"), seller = await actor("SALES_AGENT", "seller"), other = await actor("SALES_AGENT", "other");
  const payer = await client(seller, "contractor"), agency = await client(seller, "agency"), beneficiary = await client(seller, "beneficiary"), foreign = await client(other, "foreign"), archived = await client(seller, "archived", "archived");
  const cat = await prisma.category.create({ data: { name: tag, slug: tag } }); categoryId = cat.id;
  for (let i = 0; i < 7; i++) { const row = await prisma.location.create({ data: { code: tag + i, categoryId, lifecycleStatus: "ACTIVE", city: "SIM-OOH Bucuresti", type: "Billboard", showInPublic: false, rateCardValue: 100 } }); locations.push(row.id); }
  await check("AGENCY-FOREIGN", "Seller cannot attach another portfolio as beneficiary", false, () => campaign(seller, payer.id, "foreign-ref", { campaignType: "agency", agencyClientId: agency.id, endClientId: foreign.id }));
  await check("AGENCY-MISSING", "Nonexistent related client is refused atomically", false, () => campaign(seller, payer.id, "missing-ref", { campaignType: "agency", agencyClientId: "not-a-real-client", endClientId: beneficiary.id }));
  await check("AGENCY-ARCHIVED", "Archived related client cannot be newly associated", false, () => campaign(seller, payer.id, "archived-ref", { campaignType: "agency", agencyClientId: agency.id, endClientId: archived.id }));
  await check("AGENCY-SAME", "Agency cannot also be final beneficiary", false, () => campaign(seller, payer.id, "same-ref", { campaignType: "agency", agencyClientId: agency.id, endClientId: agency.id }));
  await check("DIRECT-INCONSISTENT", "Direct campaign cannot carry a separate agency relationship", false, () => campaign(seller, payer.id, "direct-ref", { campaignType: "direct_client", agencyClientId: agency.id, endClientId: beneficiary.id }));
  const valid = await campaign(seller, payer.id, "valid-agency", { campaignType: "agency", agencyClientId: agency.id, endClientId: beneficiary.id, status: "active" });
  await check("AGENCY-VALID", "Valid agency and beneficiary survive unrelated note edit", true, async () => {
    await updateCampaign(valid.id, { notes: "SIM-OOH reviewed relationship" }, seller);
    const after = await prisma.campaign.findUniqueOrThrow({ where: { id: valid.id } }); assert.equal(after.agencyClientId, agency.id); assert.equal(after.endClientId, beneficiary.id);
  });
  await check("AGENCY-UPDATE-FOREIGN", "Updating beneficiary cannot bypass portfolio authorization", false, () => updateCampaign(valid.id, { endClientId: foreign.id }, seller));
  if (!baseline) assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: valid.id } })).endClientId, beneficiary.id);
  const legacy = await campaign(seller, payer.id, "legacy-relation", { campaignType: "agency", agencyClientId: agency.id, endClientId: beneficiary.id });
  await prisma.campaign.update({ where: { id: legacy.id }, data: { endClientId: foreign.id } });
  await check("AGENCY-LEGACY-PRESERVE", "Unrelated edits preserve a legacy relationship instead of silently clearing redacted data", true, async () => {
    await updateCampaign(legacy.id, { clientId: payer.id, notes: "SIM-OOH pending manager review" }, seller);
    assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: legacy.id } })).endClientId, foreign.id);
  });
  await check("AGENCY-MANAGER", "Manager may associate legitimate cross-seller relationship", true, async () => {
    const row = await createCampaign({ clientId: payer.id, campaignName: tag + "managed", sellerUserId: seller.id, accountOwnerUserId: seller.id, campaignType: "agency", agencyClientId: agency.id, endClientId: foreign.id, companyEntity: "Focus Media" }, manager); campaigns.push(row.id);
  });
  const incomplete = await campaign(seller, payer.id, "incomplete-agency", { campaignType: "agency", agencyClientId: agency.id });
  const book = (campaignId: string, locationId: string, start = "2091-01-01", end = "2091-01-31") => createReservation({ clientId: payer.id, campaignId, locationId, status: "BOOKED", periodStart: start, periodEnd: end, amount: 100, monthlyRentTotal: 100, currency: "EUR", sellerUserId: seller.id }, manager);
  await check("AGENCY-INCOMPLETE-BOOKING", "Incomplete agency draft cannot create confirmed rental", false, () => book(incomplete.id, locations[0]));
  const live = await campaign(seller, payer.id, "live", { status: "active" });
  await book(live.id, locations[1]);
  await check("CAMPAIGN-CANCEL-BLOCKED", "Cannot cancel campaign while current or future rental blocks inventory", false, () => updateCampaign(live.id, { status: "cancelled" }, manager));
  // Restore baseline's unsafe state to make each observation independent.
  await prisma.campaign.update({ where: { id: live.id }, data: { status: "active" } });
  await check("CAMPAIGN-COMPLETE-BLOCKED", "Cannot complete campaign with future confirmed rental", false, () => updateCampaign(live.id, { status: "completed" }, manager));
  for (const [index, terminal] of ["cancelled", "completed"].entries()) {
    const row = await campaign(seller, payer.id, "terminal-" + terminal);
    await prisma.campaign.update({ where: { id: row.id }, data: { status: terminal } });
    await check("CAMPAIGN-BOOK-" + terminal.toUpperCase(), "Cannot confirm a new rental into " + terminal + " campaign", false, () => book(row.id, locations[index + 2]));
  }
  const expired = await campaign(seller, payer.id, "expired-hold", { status: "active" });
  await prisma.reservation.create({ data: { campaignId: expired.id, clientId: payer.id, locationId: locations[4], clientName: tag, status: "HOLD", ownerId: seller.id, sellerUserId: seller.id, periodStart: new Date("2091-02-01"), periodEnd: new Date("2091-02-28"), holdExpiresAt: new Date("2020-01-01") } });
  await check("CAMPAIGN-EXPIRED-HOLD", "Expired hold does not prevent cancellation", true, () => updateCampaign(expired.id, { status: "cancelled" }, manager));
  const history = await campaign(seller, payer.id, "ended", { status: "active" });
  const historical = (await book(history.id, locations[5], "2020-01-01", "2020-01-31"))[0];
  await check("CAMPAIGN-HISTORY-COMPLETE", "Historical ended rentals permit completion without deleting sales", true, () => updateCampaign(history.id, { status: "completed" }, manager));
  await check("CAMPAIGN-HISTORY-NOTE", "Historical metadata correction remains possible", true, () => updateReservation(historical.id, { notes: "SIM-OOH preserve historical evidence", expectedUpdatedAt: historical.updatedAt }, manager));
  const before = await prisma.reservation.findUniqueOrThrow({ where: { id: historical.id } });
  await check("CAMPAIGN-HISTORY-CORRECTION", "Documented non-expanding historical price correction remains possible", true, () => updateReservation(before.id, { amount: 125, monthlyRentTotal: 125, monthlyRentShare: 125, amendmentEffectiveDate: "2020-01-01", amendmentReference: "SIM-OOH signed correction 01", amendmentMode: "correction", expectedUpdatedAt: before.updatedAt.toISOString() }, manager));
  const beforeExtension = await prisma.reservation.findUniqueOrThrow({ where: { id: historical.id } });
  await check("CAMPAIGN-HISTORY-EXTENSION", "Terminal campaign cannot gain a larger rental interval", false, () => updateReservation(beforeExtension.id, { periodEnd: "2020-02-29", amendmentEffectiveDate: "2020-02-01", amendmentReference: "SIM-OOH extension", amendmentMode: "amendment", expectedUpdatedAt: beforeExtension.updatedAt.toISOString() }, manager));
  const latest = await prisma.reservation.findUniqueOrThrow({ where: { id: historical.id } });
  await check("CAMPAIGN-HISTORY-CANCEL", "Explicit rental cancellation remains possible for legacy repair", true, () => updateReservation(latest.id, { status: "CANCELLED", cancellationReason: "SIM-OOH verified correction", expectedUpdatedAt: latest.updatedAt.toISOString() }, manager));
  const linkedDraft = await campaign(seller, payer.id, "hold-draft");
  const hold = (extra: Record<string, unknown> = {}) => createReservation({ locationId: locations[6], status: "HOLD", periodStart: "2094-01-01", periodEnd: "2094-01-31", sellerUserId: seller.id, ...extra }, seller);
  await check("HOLD-LINKED-PRESERVED", "Explicit paired client/campaign links survive hold creation without repeated manual client name", true, async () => {
    const rows = await hold({ clientId: payer.id, campaignId: linkedDraft.id });
    const saved = await prisma.reservation.findUniqueOrThrow({ where: { id: rows[0].id } });
    assert.equal(saved.clientId, payer.id); assert.equal(saved.campaignId, linkedDraft.id); assert.equal(saved.clientName, payer.companyName); assert.equal(saved.status, "HOLD"); assert.equal(saved.neutralizationDate, null);
  });
  await check("HOLD-ANONYMOUS", "Manual unlinked holds remain available", true, async () => {
    const rows = await hold({ clientName: "SIM-OOH manual prospect", periodStart: "2094-02-01", periodEnd: "2094-02-28" });
    const saved = await prisma.reservation.findUniqueOrThrow({ where: { id: rows[0].id } }); assert.equal(saved.clientId, null); assert.equal(saved.campaignId, null);
  });
  await check("HOLD-PARTIAL-LINK", "Partial hold link is rejected rather than silently dropped", false, () => hold({ clientId: payer.id, clientName: "SIM-OOH partial link", periodStart: "2094-03-01", periodEnd: "2094-03-31" }));
  const foreignCampaign = await campaign(other, foreign.id, "foreign-hold");
  await check("HOLD-FOREIGN-LINK", "Seller cannot attach a hold to foreign client/campaign", false, () => hold({ clientId: foreign.id, campaignId: foreignCampaign.id, clientName: "SIM-OOH foreign", periodStart: "2094-04-01", periodEnd: "2094-04-30" }));
  await check("HOLD-AGENCY-DRAFT", "Incomplete agency draft may hold before confirmed sale", true, async () => {
    const rows = await hold({ clientId: payer.id, campaignId: incomplete.id, clientName: "SIM-OOH incomplete", periodStart: "2094-05-01", periodEnd: "2094-05-31" });
    assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: rows[0].id } })).campaignId, incomplete.id);
  });
  const holdCampaign = await campaign(seller, payer.id, "expired-linked-hold", { status: "active" });
  const expiredLinked = await prisma.reservation.create({ data: { campaignId: holdCampaign.id, clientId: payer.id, locationId: locations[6], clientName: payer.companyName, status: "HOLD", ownerId: seller.id, sellerUserId: seller.id, periodStart: new Date("2094-06-01"), periodEnd: new Date("2094-06-30"), holdExpiresAt: new Date("2020-01-01") } });
  await updateCampaign(holdCampaign.id, { status: "cancelled" }, manager);
  await check("HOLD-TERMINAL-METADATA", "Cancelled campaign does not block metadata correction of expired linked hold", true, () => updateReservation(expiredLinked.id, { notes: "SIM-OOH expiry reviewed", expectedUpdatedAt: expiredLinked.updatedAt.toISOString() }, seller));
  let expiredVersion = await prisma.reservation.findUniqueOrThrow({ where: { id: expiredLinked.id } });
  await check("HOLD-TERMINAL-REFRESH", "Single hold refresh cannot reactivate capacity in a cancelled campaign", false, () => updateReservation(expiredLinked.id, { status: "HOLD", expectedUpdatedAt: expiredVersion.updatedAt.toISOString() }, seller));
  expiredVersion = await prisma.reservation.findUniqueOrThrow({ where: { id: expiredLinked.id } });
  await check("HOLD-TERMINAL-GROUP-REFRESH", "Group hold status command also checks linked campaign", false, () => updateReservationGroupStatus(expiredLinked.id, "HOLD", seller, { expectedVersions: { [expiredLinked.id]: expiredVersion.updatedAt.toISOString() } }));
  expiredVersion = await prisma.reservation.findUniqueOrThrow({ where: { id: expiredLinked.id } });
  await check("HOLD-TERMINAL-EXTEND", "Linked hold extension requires a sellable campaign", false, () => updateReservation(expiredLinked.id, { periodEnd: "2094-07-31", expectedUpdatedAt: expiredVersion.updatedAt.toISOString() }, seller));
  expiredVersion = await prisma.reservation.findUniqueOrThrow({ where: { id: expiredLinked.id } });
  await check("HOLD-TERMINAL-REDUCE", "Reducing an expired legacy hold keeps its history without reactivation", true, () => updateReservation(expiredLinked.id, { periodEnd: "2094-06-15", expectedUpdatedAt: expiredVersion.updatedAt.toISOString() }, seller));
  await check("HOLD-TERMINAL-CREATE", "New linked hold cannot allocate cancelled campaign", false, () => hold({ clientId: payer.id, campaignId: holdCampaign.id, clientName: "SIM-OOH cancelled hold", periodStart: "2094-08-01", periodEnd: "2094-08-31" }));
  const ttlCampaign = await campaign(seller, payer.id, "hold-ttl", { status: "active" });
  const ttlHold = (month: string, campaignId: string | null = ttlCampaign.id) => hold({ ...(campaignId ? { clientId: payer.id, campaignId } : { clientName: "SIM-OOH manual TTL prospect" }), periodStart: `2095-${month}-01`, periodEnd: `2095-${month}-28` });
  for (const [index, terminal] of ["cancelled", "completed"].entries()) {
    const ttlRental = (await ttlHold(String(index + 1).padStart(2, "0")))[0];
    // A legacy inconsistency can exist after an earlier import or old release.
    await prisma.campaign.update({ where: { id: ttlCampaign.id }, data: { status: terminal } });
    const original = await prisma.reservation.findUniqueOrThrow({ where: { id: ttlRental.id } });
    const committedBefore = await prisma.auditLog.count({ where: { userId: seller.id, action: "reservation.hold_extend.committed" } });
    await check("HOLD-TTL-" + terminal.toUpperCase(), "Dedicated TTL extension refuses a linked future hold in a " + terminal + " campaign", false, async () => {
      try { await extendReservationHold(ttlRental.id, 5, seller); }
      finally {
        if (!baseline) {
          const saved = await prisma.reservation.findUniqueOrThrow({ where: { id: ttlRental.id } });
          assert.equal(saved.status, original.status); assert.equal(saved.holdExpiresAt?.toISOString(), original.holdExpiresAt?.toISOString()); assert.equal(saved.updatedAt.toISOString(), original.updatedAt.toISOString());
          assert.equal(await prisma.auditLog.count({ where: { userId: seller.id, action: "reservation.hold_extend.committed" } }), committedBefore);
        }
      }
    });
    await prisma.campaign.update({ where: { id: ttlCampaign.id }, data: { status: "active" } });
    await check("HOLD-TTL-RECOVERY-" + terminal.toUpperCase(), "Explicitly reopened campaign permits the same dedicated hold renewal", true, async () => {
      const renewed = await extendReservationHold(ttlRental.id, 5, seller);
      assert.equal(renewed[0].status, "RESERVED"); assert.ok(new Date(renewed[0].holdExpiresAt!).getTime() > Date.now());
      assert.equal(renewed[0].clientId, payer.id); assert.equal(renewed[0].campaignId, ttlCampaign.id);
    });
  }
  const manualTtl = (await ttlHold("03", null))[0];
  await check("HOLD-TTL-MANUAL", "Unlinked manual hold retains dedicated TTL extension", true, async () => {
    const renewed = await extendReservationHold(manualTtl.id, 5, seller); assert.equal(renewed[0].status, "RESERVED"); assert.equal(renewed[0].campaignId, null);
  });
  const expiredTtl = (await ttlHold("04"))[0];
  await prisma.reservation.update({ where: { id: expiredTtl.id }, data: { holdExpiresAt: new Date("2020-01-01") } });
  await check("HOLD-TTL-EXPIRED", "Dedicated extension cannot revive an expired hold", false, () => extendReservationHold(expiredTtl.id, 5, seller));
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: expiredTtl.id } })).status, "EXPIRED");
  const bookedTtl = (await book(ttlCampaign.id, locations[6], "2095-05-01", "2095-05-28"))[0];
  await check("HOLD-TTL-BOOKED", "Dedicated TTL extension cannot alter confirmed rentals", false, () => extendReservationHold(bookedTtl.id, 5, seller));
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: bookedTtl.id } })).status, "BOOKED");
  const releasedTtl = (await ttlHold("06"))[0];
  await prisma.campaign.update({ where: { id: ttlCampaign.id }, data: { status: "cancelled" } });
  await check("HOLD-TTL-RELEASE-TERMINAL", "Explicit release remains available for a legacy hold in a terminal campaign", true, async () => {
    const released = await releaseReservationHold(releasedTtl.id, seller); assert.equal(released[0].status, "CANCELLED"); assert.equal(released[0].campaignId, ttlCampaign.id);
  });
  await check("HOLD-TTL-CANCELLED-RENTAL", "Dedicated TTL extension cannot reactivate an explicitly released hold", false, () => extendReservationHold(releasedTtl.id, 5, seller));
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: releasedTtl.id } })).status, "CANCELLED");
  const report = { schema_version: "1.0", baseline, datasetTag: tag, syntheticOnly: true, productionWrites: 0, cases: results.length, passed: results.filter((row) => row.passed).length, observedFailures: results.filter((row) => !row.passed).length, results };
  const out = process.env.CAMPAIGN_PARTIES_RESULT;
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n"); }
  console.log(JSON.stringify(report, null, 2));
}
async function cleanup() {
  await prisma.billingItem.deleteMany({ where: { reservation: { locationId: { in: locations } } } });
  await prisma.reservation.deleteMany({ where: { locationId: { in: locations } } });
  await prisma.campaign.deleteMany({ where: { id: { in: campaigns } } });
  await prisma.clientAccount.deleteMany({ where: { id: { in: clients } } });
  await prisma.location.deleteMany({ where: { id: { in: locations } } });
  if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { try { await cleanup(); } finally { await prisma.$disconnect(); } });
