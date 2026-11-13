const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

const database = new URL(process.env.DATABASE_URL || "invalid:");
if (!["127.0.0.1", "localhost"].includes(database.hostname) ||
    !database.pathname.startsWith("/focus_preview_") || process.env.VERCEL_ENV === "production" ||
    !["ci", "test", "preview"].includes(process.env.APP_ENV)) {
  throw new Error("Reservation regression fixtures require an isolated local synthetic database.");
}
const load = (name) => loadTsModule(path.join(process.cwd(), "src/lib", name));
const { prisma } = load("prisma.ts");
const rawService = load("reservations.ts");
const service = { ...rawService, ...require("./reservation-test-commands.cjs").versionedReservationCommands(rawService, prisma) };
const offers = load("offer-requests.ts");
const { archiveCampaign } = load("campaigns.ts");
const { allocateMoneyAcrossRows } = load("money-allocation.ts");
const { operationalRequirementForBooked } = load("dashboard/executive/operational-contract.ts");
const { mediaClassificationForLocationType } = load("dashboard/executive/operation-task-cutover-review.ts");
const tag = "reservation-fix-" + Date.now();
const made = { users: [], locations: [], campaigns: [], clients: [], categories: [], offers: [] };
const day = (s) => new Date(s + "T00:00:00.000Z");
const actor = (u) => ({ ...u, tokenVersion: 0, iat: 1, exp: 9999999999 });
let locCounter = 0;

async function makeLocation(category) {
  const row = await prisma.location.create({ data: { categoryId: category.id, code: tag + "-" + (++locCounter), city: "Synthetic", showInPublic: false } });
  made.locations.push(row.id); return row;
}
async function makeUser(role, suffix) {
  const row = await prisma.user.create({ data: { role, name: tag + suffix, email: tag + suffix + "@example.invalid", passwordHash: "unused-synthetic-hash", active: true } });
  made.users.push(row.id); return actor(row);
}
const hold = (location, start, end, user, extra = {}) => service.createReservation({ locationId: location.id, status: "RESERVED", clientName: tag, periodStart: start, periodEnd: end, ...extra }, user);

async function main() {
  const category = await prisma.category.create({ data: { name: tag, slug: tag } }); made.categories.push(category.id);
  const a = await makeUser("SALES_AGENT", "-a"), b = await makeUser("SALES_AGENT", "-b"), coo = await makeUser("COO", "-coo");
  const client = await prisma.clientAccount.create({ data: { companyName: tag, normalizedName: tag, status: "active", accountOwnerUserId: a.id } }); made.clients.push(client.id);
  const campaign = await prisma.campaign.create({ data: { clientId: client.id, campaignName: tag, status: "active", companyEntity: "Focus Media", currency: "RON", paymentTermType: "7_days", paymentTermDays: 7, billingRule: "manual_per_contract", billingFrequency: "monthly", sellerUserId: a.id, accountOwnerUserId: a.id } }); made.campaigns.push(campaign.id);
  const foreignClient = await prisma.clientAccount.create({ data: { companyName: tag + "-foreign", normalizedName: tag + "-foreign", status: "active", accountOwnerUserId: b.id } }); made.clients.push(foreignClient.id);
  const foreignCampaign = await prisma.campaign.create({ data: { clientId: foreignClient.id, campaignName: tag + "-foreign", status: "active", sellerUserId: b.id, accountOwnerUserId: b.id } }); made.campaigns.push(foreignCampaign.id);
  const locations = await Promise.all(Array.from({ length: 14 }, () => makeLocation(category)));
  const booking = { locationId: locations[0].id, status: "BOOKED", clientId: client.id, campaignId: campaign.id, periodStart: "2090-01-01", periodEnd: "2090-01-10", amount: 100, sellerUserId: a.id };
  await assert.rejects(() => service.createReservation(booking, a), (e) => e.status === 403, "a seller cannot confirm at creation");
  await assert.rejects(() => service.createReservation({ ...booking, amount: null }, coo), /chirie lunara/, "BOOKED needs a positive rent");
  const [booked] = await service.createReservation(booking, coo);
  assert.equal(booked.currency, "RON"); assert.equal(booked.paymentTermDays, 7, "omitted terms inherit campaign values");
  await assert.rejects(() => service.updateReservation(booked.id, { clientId: foreignClient.id, campaignId: foreignCampaign.id }, a), (e) => e.status === 403, "owned BOOKED cannot be linked to foreign portfolio");
  await assert.rejects(() => service.updateReservationGroup(booked.id, { clientId: foreignClient.id, campaignId: foreignCampaign.id }, a), (e) => e.status === 403, "the same guard covers every group row");
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: booked.id } })).clientId, client.id);
  await assert.rejects(() => service.updateReservation(booked.id, { amount: null, monthlyRentShare: null, monthlyRentTotal: null }, coo), /chirie lunara/, "explicit null cannot remove all usable BOOKED prices");
  await assert.rejects(() => service.createReservation({ ...booking, periodStart: "2090-01-10", periodEnd: "2090-01-15" }, coo), /rezervare/, "the final day is occupied");
  await service.createReservation({ ...booking, periodStart: "2090-01-11", periodEnd: "2090-01-15" }, coo);

  const own = (await hold(locations[1], "2090-02-01", "2090-02-10", a))[0];
  const foreign = await service.createReservation({ locationIds: [locations[2].id, locations[3].id], status: "HOLD", clientName: tag, periodStart: "2090-02-01", periodEnd: "2090-02-10" }, b);
  await assert.rejects(() => hold(locations[4], "2090-02-01", "2090-02-10", a, { contractGroupId: foreign[0].contractGroupId }), (e) => e.status === 403);
  await assert.rejects(() => service.updateReservation(own.id, { contractGroupId: foreign[0].contractGroupId }, a), (e) => e.status === 403);
  // Existing mixed groups fail closed too; fixture simulates legacy data only.
  await prisma.reservation.update({ where: { id: own.id }, data: { contractGroupId: foreign[0].contractGroupId } });
  await assert.rejects(() => service.updateReservationGroupStatus(own.id, "CANCELLED", a), (e) => e.status === 403);
  await assert.rejects(() => service.appendReservationGroupProductionNote(own.id, "foreign note denied", a), (e) => e.status === 403);
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: foreign[0].id } })).status, "HOLD");
  await prisma.reservation.update({ where: { id: own.id }, data: { contractGroupId: null } });

  const group = await service.createReservation({ locationIds: [locations[5].id, locations[6].id], status: "HOLD", clientName: tag, periodStart: "2090-03-01", periodEnd: "2090-03-10" }, a);
  await assert.rejects(() => service.updateReservationGroup(group[0].id, { locationId: locations[7].id }, a), /suprapuse/);
  assert.equal(await prisma.reservation.count({ where: { locationId: locations[7].id } }), 0, "invalid group move is entirely rolled back");
  await service.updateReservationGroup(group[0].id, { periodStart: "2090-03-02", periodEnd: "2090-03-12" }, a);
  await prisma.reservation.update({ where: { id: group[0].id }, data: { productionNotes: "first row" } });
  await prisma.reservation.update({ where: { id: group[1].id }, data: { productionNotes: "second row" } });
  const notesBefore = await prisma.reservation.findMany({ where: { id: { in: group.map((row) => row.id) } }, orderBy: { id: "asc" } });
  await service.appendReservationGroupProductionNote(group[0].id, "approved operational note", a);
  const notesAfter = await prisma.reservation.findMany({ where: { id: { in: group.map((row) => row.id) } }, orderBy: { id: "asc" } });
  for (const [index, row] of notesAfter.entries()) {
    const before = notesBefore[index];
    assert.ok(row.productionNotes.startsWith(before.productionNotes), "each row retains its own note history");
    assert.ok(row.productionNotes.includes("approved operational note"));
    for (const field of ["locationId", "periodStart", "periodEnd", "status", "ownerId", "sellerUserId", "clientId", "campaignId", "amount", "monthlyRentShare", "contractGroupId"]) {
      assert.deepEqual(row[field], before[field], "notes command cannot change " + field);
    }
  }
  assert.equal(await prisma.auditLog.count({ where: { userId: a.id, action: "reservation.group_production_note.committed" } }), 1);

  const six = locations.slice(0, 6).map((r) => r.id);
  const prices = await service.createReservation({ ...booking, locationId: null, locationIds: six, amount: undefined, monthlyRentTotal: 1000, periodStart: "2090-04-01", periodEnd: "2090-04-30" }, coo);
  assert.equal(Math.round(prices.reduce((n, row) => n + row.amount, 0) * 100), 100000, "six-code contract conserves cents");
  const repriced = await service.updateReservationGroup(prices[0].id, { monthlyRentTotal: 1000.01 }, coo);
  assert.equal(Math.round(repriced.reduce((n, row) => n + row.amount, 0) * 100), 100001);
  assert.equal(allocateMoneyAcrossRows(1000, 6).reduce((n, x) => n + Math.round(x * 100), 0), 100000);

  const h1 = (await hold(locations[8], "2091-01-01", "2091-01-05", a))[0];
  const h2 = (await hold(locations[8], "2091-01-20", "2091-01-25", a))[0];
  const ids = new Set([h1.id, h2.id]); const initialReads = new Set(); let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const original = prisma.$transaction.bind(prisma);
  prisma.$transaction = (callback, options) => original(async (tx) => callback(new Proxy(tx, { get(target, key) {
    if (key === "reservation") return new Proxy(target.reservation, { get(delegate, method) {
      if (method === "findUniqueOrThrow") return async (args) => {
        const row = await delegate.findUniqueOrThrow(args);
        if (ids.has(args.where?.id) && !initialReads.has(args.where.id)) {
          initialReads.add(args.where.id); if (initialReads.size === 2) release(); await barrier;
        }
        return row;
      };
      const v = delegate[method]; return typeof v === "function" ? v.bind(delegate) : v;
    } });
    const v = target[key]; return typeof v === "function" ? v.bind(target) : v;
  } })), options);
  let outcomes;
  try { outcomes = await Promise.allSettled([h1, h2].map((r) => service.updateReservation(r.id, { periodStart: "2091-01-10", periodEnd: "2091-01-15" }, a))); }
  finally { prisma.$transaction = original; }
  assert.equal(initialReads.size, 2, "barrier exercised the originally failing interleaving");
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1, "one concurrent update wins");
  assert.equal(await prisma.reservation.count({ where: { id: { in: [...ids] }, periodStart: day("2091-01-10") } }), 1);

  const inquiry = await prisma.offerRequest.create({ data: { clientName: tag, selectedLocationIds: [], source: "audit" } }); made.offers.push(inquiry.id);
  const claims = await Promise.allSettled([offers.updateOfferRequest(inquiry.id, { notes: "A" }, a), offers.updateOfferRequest(inquiry.id, { notes: "B" }, b)]);
  assert.equal(claims.filter((r) => r.status === "fulfilled").length, 1, "one claimant owns the inquiry");
  const winner = (await prisma.offerRequest.findUniqueOrThrow({ where: { id: inquiry.id } })).ownerId === a.id ? a : b;
  await offers.updateOfferRequest(inquiry.id, { notes: "long note", estimatedValue: 100, nextFollowUpAt: "2091-05-01" }, winner);
  const unchanged = await offers.updateOfferRequest(inquiry.id, { status: "CONTACTED" }, winner);
  assert.equal(unchanged.estimatedValue, 100); assert.equal(unchanged.internalNotes, "long note");
  const cleared = await offers.updateOfferRequest(inquiry.id, { notes: null, estimatedValue: null, nextFollowUpAt: null }, winner);
  assert.equal(cleared.internalNotes, null); assert.equal(cleared.estimatedValue, null); assert.equal(cleared.nextFollowUpAt, null);

  const historical = await prisma.campaign.create({ data: { clientId: client.id, campaignName: tag + "-history", status: "completed", sellerUserId: a.id, accountOwnerUserId: a.id } }); made.campaigns.push(historical.id);
  await prisma.reservation.create({ data: { locationId: locations[10].id, campaignId: historical.id, clientId: client.id, clientName: tag, status: "BOOKED", periodStart: day("2020-01-01"), periodEnd: day("2020-01-31"), amount: 100, ownerId: a.id, sellerUserId: a.id } });
  assert.equal((await archiveCampaign(historical.id, coo)).status, "archived");
  assert.equal(await prisma.reservation.count({ where: { campaignId: historical.id, status: "BOOKED" } }), 1, "archiving preserves historical sales");

  const beforeFailure = await prisma.reservation.count({ where: { locationId: locations[11].id } });
  let failingAuditAction = "reservation.create.committed";
  prisma.$transaction = (callback, options) => original(async (tx) => callback(new Proxy(tx, { get(target, key) {
    if (key === "auditLog") return { create: async ({ data }) => { if (data.action === failingAuditAction) throw Error("synthetic audit failure"); return target.auditLog.create({ data }); } };
    const v = target[key]; return typeof v === "function" ? v.bind(target) : v;
  } })), options);
  try {
    await assert.rejects(() => hold(locations[11], "2092-01-01", "2092-01-10", a), /synthetic audit failure/);
    failingAuditAction = "reservation.group_production_note.committed";
    await assert.rejects(() => service.appendReservationGroupProductionNote(group[0].id, "must rollback both notes", a), /synthetic audit failure/);
    const rolledBackNotes = await prisma.reservation.findMany({ where: { id: { in: group.map((row) => row.id) } }, orderBy: { id: "asc" } });
    assert.deepEqual(rolledBackNotes.map((row) => row.productionNotes), notesAfter.map((row) => row.productionNotes), "all group note writes roll back when their durable audit fails");
  }
  finally { prisma.$transaction = original; }
  assert.equal(await prisma.reservation.count({ where: { locationId: locations[11].id } }), beforeFailure, "business mutation rolls back with its failed audit");
  for (const type of ["DOOH", "display", "LED", "Digital Screen"]) {
    assert.equal(operationalRequirementForBooked({ reservationStatus: "BOOKED", locationType: type }).medium, "DIGITAL");
    assert.equal(mediaClassificationForLocationType(type), "DIGITAL");
  }

  const holdInput = { locationIds: [locations[12].id], periodStart: day("2092-05-01"), periodEnd: day("2092-05-10"), clientId: client.id, campaignId: campaign.id, ownerUserId: a.id, requestKey: tag, holdExpiresAt: new Date(Date.now() + 3600000) };
  const firstAgentHold = await prisma.$transaction((tx) => service.createApprovedAgentHold(tx, holdInput, coo), service.reservationWriteTransactionOptions);
  const repeatedAgentHold = await prisma.$transaction((tx) => service.createApprovedAgentHold(tx, holdInput, coo), service.reservationWriteTransactionOptions);
  assert.equal(firstAgentHold[0].id, repeatedAgentHold[0].id); assert.equal(firstAgentHold[0].status, "HOLD");
  assert.equal(await prisma.auditLog.count({ where: { userId: coo.id, action: "agent.hold.create.committed" } }), 1);
  await service.updateReservation(firstAgentHold[0].id, { amount: 100 }, coo);
  const confirmed = await service.updateReservationGroupStatus(firstAgentHold[0].id, "BOOKED", coo);
  assert.equal(confirmed[0].currency, "RON"); assert.equal(confirmed[0].paymentTermDays, 7, "HOLD confirmation inherits the campaign terms");
  const customized = await service.updateReservation(confirmed[0].id, { currency: "EUR", paymentTermType: "custom", paymentTermDays: 42 }, coo);
  const noteOnly = await service.updateReservation(customized.id, { notes: "synthetic follow-up" }, coo);
  assert.equal(noteOnly.currency, "EUR"); assert.equal(noteOnly.paymentTermDays, 42, "note-only updates retain explicit existing BOOKED terms");
  console.log(JSON.stringify({ ok: true, cases: ["group ownership", "group internal collisions", "group notes immutable fields and audit rollback", "concurrent updates", "inclusive dates", "booking role/price", "campaign terms", "cents allocation", "inquiry claim and null clears", "historical archive", "audit rollback", "DOOH classification", "approved agent HOLD idempotency"] }, null, 2));
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { userId: { in: made.users } } });
  await prisma.offerRequest.deleteMany({ where: { id: { in: made.offers } } });
  await prisma.reservation.deleteMany({ where: { locationId: { in: made.locations } } });
  await prisma.campaign.deleteMany({ where: { id: { in: made.campaigns } } });
  await prisma.clientAccount.deleteMany({ where: { id: { in: made.clients } } });
  await prisma.location.deleteMany({ where: { id: { in: made.locations } } });
  await prisma.category.deleteMany({ where: { id: { in: made.categories } } });
  await prisma.user.deleteMany({ where: { id: { in: made.users } } });
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { try { await cleanup(); } finally { await prisma.$disconnect(); } });
