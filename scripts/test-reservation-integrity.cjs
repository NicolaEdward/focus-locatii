const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

loadLocalEnv();

const { prisma } = loadTsModule(path.join(process.cwd(), "src", "lib", "prisma.ts"));
const {
  assignReservationSeller,
  assignReservationsSeller,
  createReservation,
  extendReservationHold,
  markReservationHoldLost,
  releaseReservationHold,
  updateReservation,
  updateReservationGroup,
  updateReservationGroupStatus
} = loadTsModule(path.join(process.cwd(), "src", "lib", "reservations.ts"));
const { loadAvailabilityDecisions } = loadTsModule(path.join(process.cwd(), "src", "lib", "availability-service.ts"));
const { getLocationSelectionAvailability } = loadTsModule(path.join(process.cwd(), "src", "lib", "location-selection-availability.ts"));
const { publicAvailability } = loadTsModule(path.join(process.cwd(), "src", "lib", "availability.ts"));

const suffix = `reservation-integrity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const created = {
  reservations: [],
  campaigns: [],
  clients: [],
  locations: [],
  users: [],
  categories: []
};
let connected = false;

main()
  .catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

async function main() {
  await prisma.$connect();
  connected = true;
  const ctx = await setup();
  const agentSession = session(ctx.agent);
  const otherAgentSession = session(ctx.otherAgent);
  const cooSession = session(ctx.coo);
  const superAdminSession = session(ctx.superAdmin);

  const first = await createHold(ctx.locationA.id, "2026-01-01", "2026-01-10", agentSession);
  await rejects(
    () => createHold(ctx.locationA.id, "2026-01-05", "2026-01-12", agentSession),
    "overlapping create is rejected"
  );
  await rejects(
    () => createHold(ctx.locationA.id, "2026-01-10", "2026-01-15", agentSession),
    "same-day boundary is rejected under inclusive interval semantics"
  );

  const nonOverlap = await createHold(ctx.locationA.id, "2026-01-11", "2026-01-20", agentSession);
  assert.equal(nonOverlap.status, "RESERVED", "non-overlapping create succeeds");

  await prisma.reservation.update({ where: { id: first.id }, data: { status: "CANCELLED", holdExpiresAt: null } });
  const afterCancelled = await createHold(ctx.locationA.id, "2026-01-05", "2026-01-08", agentSession);
  assert.equal(afterCancelled.status, "RESERVED", "cancelled rows do not block");

  const updateBase = await createHold(ctx.locationB.id, "2026-02-01", "2026-02-10", agentSession);
  const updateTarget = await createHold(ctx.locationB.id, "2026-02-20", "2026-02-25", agentSession);
  await rejects(
    () => updateReservation(updateTarget.id, { periodStart: "2026-02-05", periodEnd: "2026-02-15" }, agentSession),
    "update to overlapping period is rejected"
  );
  const moved = await updateReservation(updateTarget.id, { periodStart: "2026-02-11", periodEnd: "2026-02-19" }, agentSession);
  assert.equal(moved.periodStart.slice(0, 10), "2026-02-11", "update to non-overlapping period succeeds");

  const linkedHold = await prisma.reservation.create({
    data: {
      locationId: ctx.locationC.id,
      clientId: ctx.client.id,
      campaignId: ctx.campaign.id,
      status: "RESERVED",
      clientName: ctx.client.companyName,
      clientCompany: ctx.client.companyName,
      campaignName: ctx.campaign.campaignName,
      periodStart: date("2026-03-01"),
      periodEnd: date("2026-03-10"),
      ownerId: ctx.agent.id,
      sellerUserId: ctx.agent.id,
      salesperson: ctx.agent.name
    }
  });
  created.reservations.push(linkedHold.id);
  const directConflict = await directReservation(ctx.locationC.id, "2026-03-05", "2026-03-12", "RESERVED", ctx.otherAgent);
  await rejects(
    () => updateReservationGroupStatus(linkedHold.id, "BOOKED", cooSession),
    "conversion to BOOKED rechecks conflicts"
  );
  await prisma.reservation.update({ where: { id: directConflict.id }, data: { status: "CANCELLED", holdExpiresAt: null } });

  const concurrentLocation = ctx.locationD.id;
  const concurrent = await Promise.allSettled([
    createHold(concurrentLocation, "2026-04-01", "2026-04-10", agentSession),
    createHold(concurrentLocation, "2026-04-01", "2026-04-10", agentSession)
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1, "only one concurrent overlapping create succeeds");
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1, "one concurrent overlapping create is rejected");

  await prisma.location.update({ where: { id: ctx.locationN.id }, data: { lifecycleStatus: "MAINTENANCE" } });
  await rejects(() => createHold(ctx.locationN.id, "2026-04-15", "2026-04-20", agentSession), "maintenance location is rejected by write guard");
  await prisma.location.update({ where: { id: ctx.locationO.id }, data: { lifecycleStatus: "INACTIVE" } });
  await rejects(() => createHold(ctx.locationO.id, "2026-04-15", "2026-04-20", agentSession), "inactive location is rejected by write guard");
  await prisma.location.update({ where: { id: ctx.locationP.id }, data: { lifecycleStatus: "ARCHIVED" } });
  await rejects(() => createHold(ctx.locationP.id, "2026-04-15", "2026-04-20", agentSession), "archived location is rejected by write guard");

  await prisma.locationAvailabilityOverride.create({
    data: {
      locationId: ctx.locationQ.id,
      type: "COMMERCIAL_BLOCK",
      reason: "QA canonical block",
      periodStart: date("2026-04-15"),
      periodEnd: date("2026-04-20")
    }
  });
  await rejects(() => createHold(ctx.locationQ.id, "2026-04-15", "2026-04-20", agentSession), "active override is rejected by write guard");
  const canonicalOverride = await loadAvailabilityDecisions({
    locationIds: [ctx.locationQ.id],
    periodStart: date("2026-04-15"),
    periodEnd: date("2026-04-20")
  });
  const selectorOverride = await getLocationSelectionAvailability({
    locationIds: [ctx.locationQ.id],
    periodStart: "2026-04-15",
    periodEnd: "2026-04-20",
    session: agentSession
  });
  const publicOverride = publicAvailability({
    lifecycleStatus: "ACTIVE",
    availabilityOverrides: [{
      id: "public-override",
      type: "COMMERCIAL_BLOCK",
      reason: "Private reason",
      periodStart: "2026-04-15",
      periodEnd: "2026-04-20"
    }]
  }, date("2026-04-15"));
  assert.equal(canonicalOverride.decisionsByLocationId[ctx.locationQ.id].status, "BLOCKED", "canonical decision blocks override");
  assert.equal(selectorOverride[ctx.locationQ.id].state, "CONFLICT", "selector adapter blocks override");
  assert.equal(publicOverride.publicStatus, "UNKNOWN", "public adapter does not propose override-blocked location");
  assert.equal(JSON.stringify(publicOverride).includes("Private reason"), false, "public adapter does not expose override reason");

  await prisma.location.update({
    where: { id: ctx.locationR.id },
    data: { blockedReason: "QA legacy block", blockedFrom: date("2026-04-15"), blockedUntil: date("2026-04-20") }
  });
  await rejects(() => createHold(ctx.locationR.id, "2026-04-15", "2026-04-20", agentSession), "legacy manual block remains write-compatible");

  await directReservation(ctx.locationS.id, "2026-04-15", "2026-04-20", "RESERVED", ctx.otherAgent, {
    holdExpiresAt: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2025-12-01T00:00:00.000Z")
  });
  const afterExpiredHold = await createHold(ctx.locationS.id, "2026-04-15", "2026-04-20", agentSession);
  assert.equal(afterExpiredHold.status, "RESERVED", "expired HOLD does not block write even before relying on stored status");

  const extendable = await createHold(ctx.locationE.id, "2026-05-01", "2026-05-10", agentSession);
  const extended = await extendReservationHold(extendable.id, 7, agentSession);
  assert.equal(extended[0].status, "RESERVED", "extend active hold succeeds");

  const conflictedHold = await createHold(ctx.locationF.id, "2026-06-01", "2026-06-10", agentSession);
  const directConflictForExtend = await directReservation(ctx.locationF.id, "2026-06-05", "2026-06-12", "RESERVED", ctx.otherAgent);
  await rejects(() => extendReservationHold(conflictedHold.id, 7, agentSession), "extend hold fails if period conflicts");
  await prisma.reservation.update({ where: { id: directConflictForExtend.id }, data: { status: "CANCELLED", holdExpiresAt: null } });

  const booked = await directReservation(ctx.locationG.id, "2026-07-01", "2026-07-10", "BOOKED", ctx.agent, {
    clientId: ctx.client.id,
    campaignId: ctx.campaign.id
  });
  await rejects(() => extendReservationHold(booked.id, 5, cooSession), "extend BOOKED fails");
  const expired = await directReservation(ctx.locationH.id, "2026-08-01", "2026-08-10", "EXPIRED", ctx.agent);
  await rejects(() => extendReservationHold(expired.id, 5, cooSession), "extend EXPIRED fails");

  const releasable = await createHold(ctx.locationI.id, "2026-09-01", "2026-09-10", agentSession);
  const released = await releaseReservationHold(releasable.id, agentSession);
  assert.equal(released[0].status, "CANCELLED", "release active hold succeeds");
  await rejects(() => releaseReservationHold(booked.id, cooSession), "release BOOKED fails");
  await rejects(() => markReservationHoldLost(booked.id, "Lost should fail", cooSession), "markLost invalid status fails");

  await rejects(() => assignReservationSeller(booked.id, ctx.otherAgent.id, agentSession), "assignSeller unauthorized role fails");
  const reassigned = await assignReservationSeller(booked.id, ctx.otherAgent.id, cooSession);
  assert.equal(reassigned[0].sellerUserId, ctx.otherAgent.id, "COO/SUPER_ADMIN reassignment succeeds");
  await rejects(() => assignReservationsSeller([booked.id], ctx.agent.id, agentSession), "seller reassignment route rejects unauthorized role");
  const bulkReassigned = await assignReservationsSeller([booked.id], ctx.agent.id, superAdminSession);
  assert.equal(bulkReassigned[0].sellerUserId, ctx.agent.id, "seller reassignment route allows COO/SUPER_ADMIN");
  assert.equal(bulkReassigned[0].locationId, booked.locationId, "reassignment preserves reservation location");
  assert.equal(bulkReassigned[0].periodStart.slice(0, 10), "2026-07-01", "reassignment preserves reservation period");
  assert.equal(bulkReassigned[0].status, "BOOKED", "reassignment preserves reservation status");

  const groupId = `group-${suffix}`;
  const groupOne = await directReservation(ctx.locationJ.id, "2026-10-01", "2026-10-10", "RESERVED", ctx.agent, { contractGroupId: groupId });
  const groupTwo = await directReservation(ctx.locationK.id, "2026-10-01", "2026-10-10", "RESERVED", ctx.agent, { contractGroupId: groupId });
  const groupUpdated = await updateReservationGroup(groupOne.id, { periodStart: "2026-10-11", periodEnd: "2026-10-20", clientName: "Updated group" }, agentSession);
  assert.equal(groupUpdated.length, 2, "group update all valid succeeds");
  assert(groupUpdated.every((row) => row.periodStart.slice(0, 10) === "2026-10-11"), "all group rows were updated");

  const failingGroupId = `failing-group-${suffix}`;
  const failOne = await directReservation(ctx.locationL.id, "2026-11-01", "2026-11-10", "RESERVED", ctx.agent, { contractGroupId: failingGroupId });
  const failTwo = await directReservation(ctx.locationM.id, "2026-11-01", "2026-11-10", "RESERVED", ctx.agent, { contractGroupId: failingGroupId });
  await directReservation(ctx.locationM.id, "2026-11-15", "2026-11-20", "RESERVED", ctx.otherAgent);
  await rejects(
    () => updateReservationGroup(failOne.id, { periodStart: "2026-11-15", periodEnd: "2026-11-20", clientName: "Should rollback" }, agentSession),
    "group update with one conflict fails fully"
  );
  const unchanged = await prisma.reservation.findMany({ where: { id: { in: [failOne.id, failTwo.id] } } });
  assert(unchanged.every((row) => row.periodStart.toISOString().slice(0, 10) === "2026-11-01"), "no partial rows are changed after failure");
  await rejects(
    () => updateReservationGroup(failOne.id, { clientName: "Foreign edit" }, otherAgentSession),
    "unauthorized group update rejected"
  );

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "overlapping create rejected",
      "non-overlapping create succeeds",
      "cancelled rows do not block",
      "update overlap rejected",
      "update non-overlap succeeds",
      "BOOKED conversion rechecks conflicts",
      "concurrency overlapping create only one succeeds",
      "lifecycle and manual blocks reject writes",
      "public selector and write share override decision",
      "expired HOLD does not block",
      "command-center hold lifecycle guards",
      "seller reassignment policy and integrity preservation",
      "atomic group update rollback"
    ]
  }, null, 2));
}

async function setup() {
  const category = await prisma.category.create({ data: { name: `Codex QA ${suffix}`, slug: `codex-qa-${suffix}` } });
  created.categories.push(category.id);
  const [agent, otherAgent, coo, superAdmin] = await Promise.all([
    user("agent", "SALES_AGENT"),
    user("other-agent", "SALES_AGENT"),
    user("coo", "COO"),
    user("super-admin", "SUPER_ADMIN")
  ]);
  const client = await prisma.clientAccount.create({
    data: {
      companyName: `Codex QA Client ${suffix}`,
      normalizedName: `codex qa client ${suffix}`,
      accountOwnerUserId: agent.id,
      status: "active"
    }
  });
  created.clients.push(client.id);
  const campaign = await prisma.campaign.create({
    data: {
      clientId: client.id,
      campaignName: `Codex QA Campaign ${suffix}`,
      status: "active",
      accountOwnerUserId: agent.id,
      sellerUserId: agent.id,
      currency: "EUR"
    }
  });
  created.campaigns.push(campaign.id);

  const locations = {};
  for (const letter of "ABCDEFGHIJKLMNOPQRS") {
    locations[`location${letter}`] = await location(category.id, letter);
  }
  return { category, agent, otherAgent, coo, superAdmin, client, campaign, ...locations };
}

async function user(label, role) {
  const row = await prisma.user.create({
    data: {
      email: `${label}-${suffix}@example.invalid`,
      name: `Codex QA ${label} ${suffix}`,
      passwordHash: "not-used",
      role,
      active: true
    }
  });
  created.users.push(row.id);
  return row;
}

async function location(categoryId, letter) {
  const row = await prisma.location.create({
    data: {
      code: `QA-${suffix}-${letter}`,
      categoryId,
      city: "Bucuresti",
      address: `QA ${letter}`,
      status: "AVAILABLE",
      showInPublic: false
    }
  });
  created.locations.push(row.id);
  return row;
}

async function createHold(locationId, start, end, actor) {
  const [row] = await createReservation({
    locationId,
    status: "RESERVED",
    clientName: `Hold ${suffix}`,
    periodStart: start,
    periodEnd: end
  }, actor);
  created.reservations.push(row.id);
  return row;
}

async function directReservation(locationId, start, end, status, seller, extra = {}) {
  const row = await prisma.reservation.create({
    data: {
      locationId,
      status,
      clientName: `Direct ${suffix}`,
      periodStart: date(start),
      periodEnd: date(end),
      ownerId: seller.id,
      sellerUserId: seller.id,
      salesperson: seller.name,
      ...extra
    }
  });
  created.reservations.push(row.id);
  return row;
}

async function rejects(fn, label) {
  let rejected = false;
  try {
    await fn();
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, label);
}

function session(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tokenVersion: user.tokenVersion,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
  };
}

function date(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

async function cleanup() {
  if (!connected) return;
  await prisma.rentalPriceSegment.deleteMany({ where: { rentalId: { in: created.reservations } } }).catch(() => null);
  await prisma.rentalChangeLog.deleteMany({ where: { rentalId: { in: created.reservations } } }).catch(() => null);
  await prisma.reservation.deleteMany({ where: { id: { in: created.reservations } } }).catch(() => null);
  await prisma.campaign.deleteMany({ where: { id: { in: created.campaigns } } }).catch(() => null);
  await prisma.clientAccount.deleteMany({ where: { id: { in: created.clients } } }).catch(() => null);
  await prisma.location.deleteMany({ where: { id: { in: created.locations } } }).catch(() => null);
  await prisma.category.deleteMany({ where: { id: { in: created.categories } } }).catch(() => null);
  await prisma.user.deleteMany({ where: { id: { in: created.users } } }).catch(() => null);
}

function loadLocalEnv() {
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(filePath)) continue;
    for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}
