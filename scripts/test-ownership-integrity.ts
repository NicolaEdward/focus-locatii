import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadEnvFile, assertSyntheticEnvironment } from "./release/env-utils";

const suffix = `ownership-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const created = { users: [] as string[], clients: [] as string[], campaigns: [] as string[], reservations: [] as string[], locations: [] as string[], categories: [] as string[], batches: [] as string[] };
let prisma: any;
let applyOwnershipRemediationBatch: any;
let applySellerReassignment: any;
let assertClientCanBeArchived: any;
let buildOwnershipRemediationDryRun: any;
let canCompensateOwnershipChange: any;
let classifyOwnershipEvidence: any;
let getOwnershipIntegrityReport: any;
let getSellerReassignmentDryRun: any;
let ownershipBatchId: any;
let rollbackOwnershipRemediationBatch: any;
let resolveRequiredSalesOwner: any;
let createCampaign: any;
let createReservation: any;
let updateUser: any;

async function main() {
  loadEnvFile();
  assertSyntheticEnvironment();
  ({ prisma } = await import("../src/lib/prisma"));
  ({
    applyOwnershipRemediationBatch,
    applySellerReassignment,
    assertClientCanBeArchived,
    buildOwnershipRemediationDryRun,
    canCompensateOwnershipChange,
    classifyOwnershipEvidence,
    getOwnershipIntegrityReport,
    getSellerReassignmentDryRun,
    ownershipBatchId,
    rollbackOwnershipRemediationBatch
  } = await import("../src/lib/ownership-integrity"));
  ({ resolveRequiredSalesOwner } = await import("../src/lib/seller-users"));
  ({ createCampaign } = await import("../src/lib/campaigns"));
  ({ createReservation } = await import("../src/lib/reservations"));
  ({ updateUser } = await import("../src/lib/users"));

  try {
  purePolicyTests();
  const category = await prisma.category.create({ data: { name: `Ownership QA ${suffix}`, slug: `ownership-qa-${suffix}` } });
  created.categories.push(category.id);
  const [source, target, coo] = await Promise.all([
    createUser("source", "SALES_AGENT"),
    createUser("target", "SALES_AGENT"),
    createUser("coo", "COO")
  ]);
  const agentSession = session(source);
  const cooSession = session(coo);
  const location = await prisma.location.create({ data: { code: `OWN-${suffix}`, categoryId: category.id, city: "Bucuresti", address: "Synthetic", status: "AVAILABLE", showInPublic: false } });
  created.locations.push(location.id);

  await assert.rejects(() => resolveRequiredSalesOwner(cooSession, null), /Alege un agent/, "COO cannot become implicit seller");
  assert.equal((await resolveRequiredSalesOwner(agentSession, null)).id, source.id, "sales agent owns own new sales record");
  await assert.rejects(
    () => createReservation({ locationId: location.id, status: "RESERVED", clientName: "Synthetic", periodStart: "2035-01-01", periodEnd: "2035-01-10" }, cooSession),
    /Alege un agent/,
    "COO reservation creation requires an explicit seller"
  );
  await assert.rejects(
    () => createReservation({ locationId: location.id, status: "BOOKED", periodStart: "2035-01-01", periodEnd: "2035-01-10" }, agentSession),
    /client existent/,
    "new BOOKED requires canonical client and campaign"
  );

  const client = await prisma.clientAccount.create({ data: { companyName: `Synthetic ${suffix}`, normalizedName: `synthetic ${suffix}`, accountOwnerUserId: source.id, createdByUserId: source.id, status: "active" } });
  created.clients.push(client.id);
  await assert.rejects(
    () => createCampaign({ clientId: client.id, campaignName: `Missing owner ${suffix}` }, cooSession),
    /Alege un agent/,
    "COO campaign creation requires an explicit sales owner"
  );
  const campaign = await prisma.campaign.create({ data: { clientId: client.id, campaignName: `Synthetic campaign ${suffix}`, status: "active", sellerUserId: source.id, accountOwnerUserId: source.id, createdByUserId: source.id } });
  created.campaigns.push(campaign.id);
  await assert.rejects(() => assertClientCanBeArchived(client.id), /dependente active/, "client archive is blocked by active campaign");

  const booked = await prisma.reservation.create({
    data: {
      locationId: location.id, clientId: client.id, campaignId: campaign.id, status: "BOOKED",
      clientName: client.companyName, campaignName: campaign.campaignName, periodStart: new Date("2035-02-01T00:00:00.000Z"), periodEnd: new Date("2035-02-10T00:00:00.000Z"),
      sellerUserId: source.id, ownerId: source.id, salesperson: source.name
    }
  });
  created.reservations.push(booked.id);
  await assert.rejects(() => updateUser(source.id, { active: false }, coo.id, "SUPER_ADMIN"), /dependente active/, "seller deactivation is blocked while active ownership remains");

  const legacy = await prisma.reservation.create({
    data: {
      locationId: location.id, status: "CANCELLED", clientName: "Legacy synthetic", periodStart: new Date("2020-01-01T00:00:00.000Z"), periodEnd: new Date("2020-01-10T00:00:00.000Z"), ownerId: source.id
    }
  });
  created.reservations.push(legacy.id);
  const report = await getOwnershipIntegrityReport();
  const legacyItem = report.items.find((item: any) => item.entityId === legacy.id && item.reasonCode === "MISSING_RESERVATION_SELLER");
  assert(legacyItem, "legacy missing-seller item is reported");
  assert.equal(legacyItem.classification, "SAFE_AUTOFILL", "single direct owner is deterministic");
  const dryRun = buildOwnershipRemediationDryRun(report, [legacyItem.id]);
  assert.equal(dryRun.applicableCount, 1, "safe item enters dry-run");
  created.batches.push(dryRun.batchId);
  const applied = await applyOwnershipRemediationBatch({ selectedIds: [legacyItem.id], expectedBatchId: dryRun.batchId, actorId: coo.id, reason: "Synthetic ownership integrity test" });
  assert.equal(applied.updated, 1, "safe batch applies one row");
  const repeated = await applyOwnershipRemediationBatch({ selectedIds: [legacyItem.id], expectedBatchId: dryRun.batchId, actorId: coo.id, reason: "Synthetic ownership integrity test" });
  assert.equal(repeated.idempotent, true, "same safe batch is idempotent");
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: legacy.id } })).sellerUserId, source.id, "safe patch used deterministic seller");
  const compensated = await rollbackOwnershipRemediationBatch({ batchId: dryRun.batchId, actorId: coo.id, reason: "Synthetic compensating ownership test" });
  assert.equal(compensated.restored, 1, "compensating action restores one row");
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: legacy.id } })).sellerUserId, null, "compensation restores prior owner state");

  const reassignDryRun = await getSellerReassignmentDryRun(source.id, target.id);
  assert(reassignDryRun.dependencies.clients > 0 && reassignDryRun.dependencies.campaigns > 0 && reassignDryRun.dependencies.reservations > 0, "reassign dry-run covers active dependencies");
  created.batches.push(reassignDryRun.batchId);
  const reassigned = await applySellerReassignment({ sourceUserId: source.id, targetUserId: target.id, expectedBatchId: reassignDryRun.batchId, actorId: coo.id, reason: "Synthetic seller departure reassignment" });
  assert.equal(reassigned.idempotent, false, "first reassign applies");
  const reassignedAgain = await applySellerReassignment({ sourceUserId: source.id, targetUserId: target.id, expectedBatchId: reassignDryRun.batchId, actorId: coo.id, reason: "Synthetic seller departure reassignment" });
  assert.equal(reassignedAgain.idempotent, true, "reassign batch is idempotent");
  assert.equal((await prisma.clientAccount.findUniqueOrThrow({ where: { id: client.id } })).accountOwnerUserId, target.id, "client ownership moved");
  assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).sellerUserId, target.id, "campaign seller moved");
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: booked.id } })).sellerUserId, target.id, "active reservation seller moved");
  assert.equal((await updateUser(source.id, { active: false }, coo.id, "SUPER_ADMIN")).active, false, "seller can be deactivated after dependencies move");

  staticSafetyTests();
  console.log(JSON.stringify({ ok: true, checked: [
    "required sales owner policy", "BOOKED link policy", "client archive guard", "user deactivation guard",
    "deterministic dry-run", "safe batch audit/idempotency", "compensating rollback", "seller reassign audit/idempotency",
    "conservative dashboard scoping", "production write gate", "read-only audit script"
  ] }, null, 2));
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

function purePolicyTests() {
  const one = [{ source: "DIRECT_OWNER", candidateId: "seller-1", candidateType: "USER", label: "direct" }] as const;
  const same = [...one, { source: "CLIENT_OWNER", candidateId: "seller-1", candidateType: "USER", label: "client" }] as const;
  const conflict = [...one, { source: "CLIENT_OWNER", candidateId: "seller-2", candidateType: "USER", label: "client" }] as const;
  assert.equal(classifyOwnershipEvidence([...one]).classification, "SAFE_AUTOFILL");
  assert.equal(classifyOwnershipEvidence([...same]).classification, "SAFE_AUTOFILL");
  assert.equal(classifyOwnershipEvidence([...conflict]).classification, "NEEDS_REVIEW");
  assert.equal(classifyOwnershipEvidence([]).classification, "UNRESOLVED");
  assert.equal(classifyOwnershipEvidence([...one], { forceReview: true }).classification, "NEEDS_REVIEW");
  const item = { id: "reservation:r:missing", before: { sellerUserId: null }, suggestedPatch: { sellerUserId: "seller-1" } } as any;
  assert.equal(ownershipBatchId([item]), ownershipBatchId([item]), "batch id is deterministic");
  assert.equal(canCompensateOwnershipChange({ sellerUserId: "seller-1" }, { sellerUserId: "seller-1" }), true);
  assert.equal(canCompensateOwnershipChange({ sellerUserId: "seller-2" }, { sellerUserId: "seller-1" }), false);
}

function staticSafetyTests() {
  const dashboard = read("src", "lib", "dashboard.ts");
  const route = read("src", "app", "api", "admin", "data-integrity", "ownership", "route.ts");
  const auditScript = read("scripts", "audit-ownership-integrity.ts");
  assert(!dashboard.includes("{ ownerId: null, salesperson:"), "Sales dashboard no longer claims unassigned legacy rows");
  assert(!dashboard.includes("? { OR: [{ ownerId: session.id }, { ownerId: null }]"), "Sales offer requests exclude unassigned rows");
  assert(route.includes('["COO", "SUPER_ADMIN"]'), "integrity API is limited to COO/SUPER_ADMIN");
  assert(route.includes("APLICA BATCH-UL DE OWNERSHIP"), "apply requires explicit confirmation phrase");
  assert(!/\.(create|update|delete|upsert)\(/.test(auditScript), "audit CLI remains read-only");
}

async function createUser(label: string, role: "SALES_AGENT" | "COO") {
  const row = await prisma.user.create({ data: { email: `${label}-${suffix}@example.invalid`, name: `Synthetic ${label} ${suffix}`, passwordHash: "not-used", role, active: true } });
  created.users.push(row.id);
  return row;
}

function session(user: { id: string; email: string; name: string; role: any; tokenVersion: number }) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, tokenVersion: user.tokenVersion, iat: 1, exp: 9999999999 };
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: created.batches } }, { entityId: { in: [...created.users, ...created.clients, ...created.campaigns, ...created.reservations] } }] } }).catch(() => undefined);
  await prisma.rentalPriceSegment.deleteMany({ where: { rentalId: { in: created.reservations } } }).catch(() => undefined);
  await prisma.rentalChangeLog.deleteMany({ where: { rentalId: { in: created.reservations } } }).catch(() => undefined);
  await prisma.reservation.deleteMany({ where: { id: { in: created.reservations } } }).catch(() => undefined);
  await prisma.campaign.deleteMany({ where: { id: { in: created.campaigns } } }).catch(() => undefined);
  await prisma.clientAccount.deleteMany({ where: { id: { in: created.clients } } }).catch(() => undefined);
  await prisma.location.deleteMany({ where: { id: { in: created.locations } } }).catch(() => undefined);
  await prisma.category.deleteMany({ where: { id: { in: created.categories } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: created.users } } }).catch(() => undefined);
}

function read(...parts: string[]) {
  return fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
}
