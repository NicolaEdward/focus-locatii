import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AuthSession } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
import { compareContractEvidence, contractControlQuerySchema, contractCsvCell, contractRecordScope, factIdentifiesReservation, type ContractEvidence, type ContractReservation } from "../src/lib/contract-control-domain";
import { ContractControlError, getContractControlReport } from "../src/lib/contract-control";

loadEnvFile();
assertSyntheticEnvironment();
const db = new URL(process.env.DATABASE_URL!);
assert.ok(["localhost", "127.0.0.1"].includes(db.hostname), "Only local synthetic databases are allowed");
assert.notEqual(process.env.NODE_ENV, "production");
const tag = `contract-control-${randomUUID()}`;
const today = "2090-01-15", now = new Date(today + "T12:00:00Z");
const core: ContractReservation = { id: "r-one", locationCode: "TEST-1", periodStart: "2090-01-01", periodEnd: "2090-01-31", contractNumber: "C 100", contractCompany: "Focus Media", clientTaxId: "RO12345678", currency: "EUR", monthlyRent: "100.00" };
const evidence = (override: Partial<ContractEvidence["fact"]> = {}): ContractEvidence => ({ documentId: "d1", documentVersionId: "dv1", displayName: "synthetic.pdf", sha256: "a".repeat(64), reviewVersion: 1, reviewedAt: now.toISOString(), fresh: true,
  fact: { kind: "reservation", reservationId: core.id, locationCode: core.locationCode, periodStart: core.periodStart, periodEnd: core.periodEnd, contractNumber: core.contractNumber!, companyEntity: "Focus Media", clientTaxId: "12345678", monthlyRent: "100.00", currency: "EUR", evidence: { page: 1, quote: "Synthetic signed original expressly states these commercial terms." }, ...override } });

assert.equal(contractRecordScope("2090-01-01", today, today), "current", "The last contractual day is included");
assert.equal(contractRecordScope(today, "2090-02-01", today), "current", "The first contractual day is included");
assert.equal(contractRecordScope("2090-01-16", "2090-02-01", today), "upcoming");
assert.equal(contractRecordScope("2090-01-01", "2090-01-14", today), "history");
assert.equal(compareContractEvidence(core, []).state, "unverified");
assert.equal(compareContractEvidence(core, [evidence()]).state, "matched");
assert.equal(compareContractEvidence(core, [evidence({ companyEntity: undefined })]).state, "partial", "Missing entity proof cannot certify all terms");
assert.equal(compareContractEvidence(core, [{ ...evidence(), fresh: false }]).state, "stale");
assert.equal(compareContractEvidence(core, [evidence({ monthlyRent: "125.00" })]).state, "difference");
assert.equal(compareContractEvidence(core, [evidence(), evidence({ currency: "RON" })]).state, "conflicting");
assert.ok(!compareContractEvidence({ ...core, priceDate: "2090-01-20" }, [evidence({ periodEnd: "2090-01-14", monthlyRent: "125.00" })]).differences.some((value) => value.field === "monthlyRent"), "A past contractual price must not be compared against today's segment");
assert.equal(factIdentifiesReservation(core, evidence({ reservationId: undefined, clientTaxId: undefined }).fact), false, "Location/period alone is insufficient identity");
assert.equal(factIdentifiesReservation(core, evidence({ reservationId: undefined }).fact), true);
assert.equal(factIdentifiesReservation(core, evidence({ reservationId: "foreign-id" }).fact), false, "Explicit foreign identity cannot fall back to same code");
assert.equal(contractCsvCell(" =HYPERLINK(\"x\")"), '"\' =HYPERLINK(""x"")"');
assert.equal(contractCsvCell("a;b\"c"), '"a;b""c"');
assert.equal(contractControlQuerySchema.safeParse({ pageSize: 100000 }).success, false);

const ids = { users: [] as string[], locations: [] as string[], clients: [] as string[], campaigns: [] as string[], reservations: [] as string[], sources: [] as string[], categories: [] as string[] };
async function actor(role: AuthSession["role"]): Promise<AuthSession> {
  const user = await prisma.user.create({ data: { name: `${tag}-${role}`, email: `${tag}-${role}-${randomUUID()}@example.invalid`, passwordHash: "synthetic-no-login", role, active: true } });
  ids.users.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role, tokenVersion: user.tokenVersion, iat: 1, exp: 4_000_000_000 };
}
async function rental(owner: AuthSession, suffix: string, from = "2090-01-01", to = "2090-01-31", price: number | null = 100) {
  const location = await prisma.location.create({ data: { code: `${tag}-${suffix}`, address: "Synthetic address", city: "Synthetic", type: "Billboard", status: "AVAILABLE", lifecycleStatus: "ACTIVE", categoryId: ids.categories[0] } }); ids.locations.push(location.id);
  const client = await prisma.clientAccount.create({ data: { companyName: `${tag}-${suffix}`, taxId: "12345678", accountOwnerUserId: owner.id, status: "active" } }); ids.clients.push(client.id);
  const campaign = await prisma.campaign.create({ data: { clientId: client.id, campaignName: `${tag}-${suffix}`, sellerUserId: owner.id, companyEntity: "Focus Media", currency: "EUR" } }); ids.campaigns.push(campaign.id);
  const reservation = await prisma.reservation.create({ data: { locationId: location.id, clientId: client.id, campaignId: campaign.id, clientName: client.companyName, status: "BOOKED", ownerId: owner.id, sellerUserId: owner.id, periodStart: new Date(from + "T00:00:00Z"), periodEnd: new Date(to + "T00:00:00Z"), monthlyRentShare: price, currency: "EUR", contractNumber: "C-TEST", contractCompany: "Focus Media" } }); ids.reservations.push(reservation.id);
  return { location, client, campaign, reservation };
}
async function attachReviewedContract(manager: AuthSession, bundle: Awaited<ReturnType<typeof rental>>, sourceId: string) {
  const document = await prisma.sourceDocument.create({ data: { sourceId, pathHash: randomUUID(), relativePath: `contracts/${randomUUID()}.pdf`, displayName: "Synthetic contract", documentType: "contract", state: "present", lastScanId: tag, lastSeenAt: now } });
  const version = await prisma.sourceDocumentVersion.create({ data: { documentId: document.id, sha256: "a".repeat(64), extractionHash: randomUUID(), sizeBytes: 123, modifiedAt: now, observedAt: now, extractionStatus: "metadata_only", textPages: [], sourceConfigVersion: 0, reviewVersion: 1 } });
  await prisma.sourceDocument.update({ where: { id: document.id }, data: { currentVersionId: version.id } });
  const fact = evidence({ reservationId: bundle.reservation.id, locationCode: bundle.location.code, periodStart: bundle.reservation.periodStart.toISOString().slice(0, 10), periodEnd: bundle.reservation.periodEnd.toISOString().slice(0, 10), contractNumber: bundle.reservation.contractNumber! }).fact;
  await prisma.documentFactReview.create({ data: { documentVersionId: version.id, version: 1, state: "verified", facts: [fact], note: "Synthetic explicitly reviewed original evidence only.", reviewedByUserId: manager.id } });
  return { document, version };
}

async function main() {
try {
  const category = await prisma.category.create({ data: { name: tag, slug: tag } }); ids.categories.push(category.id);
  const manager = await actor("COO"), seller = await actor("SALES_AGENT"), other = await actor("SALES_AGENT"), field = await actor("FIELD_OPERATOR");
  const own = await rental(seller, "own"), foreign = await rental(other, "foreign"), historical = await rental(seller, "history", "2089-01-01", "2089-01-31"), upcoming = await rental(seller, "future", "2090-02-01", "2090-02-28"), unpriced = await rental(seller, "unpriced", "2090-01-01", "2090-01-31", null);
  await prisma.reservation.update({ where: { id: unpriced.reservation.id }, data: { contractCompany: "Excellence Media", contractNumber: null } });
  const source = await prisma.documentAuditSource.create({ data: { label: tag, baseReference: "smb://synthetic.invalid/contracts", allowedPathPrefixes: ["contracts"], ownerUserId: manager.id, ownerTokenVersion: manager.tokenVersion, lastCompletedScanAt: now, lastCompletedScanId: tag } }); ids.sources.push(source.id);
  const proof = await attachReviewedContract(manager, own, source.id);
  const before = await prisma.reservation.findMany({ where: { id: { in: ids.reservations } }, orderBy: { id: "asc" } });
  const report = await getContractControlReport({ q: tag, scope: "current" }, seller, now);
  assert.deepEqual(new Set(report.rows.map((row) => row.id)), new Set([own.reservation.id, unpriced.reservation.id]), "Seller sees own current rows only");
  assert.equal(report.rows.find((row) => row.id === own.reservation.id)?.evidence.state, "matched");
  assert.equal(report.rows.find((row) => row.id === unpriced.reservation.id)?.issues.includes("missing_price"), true);
  assert.equal(report.rows.find((row) => row.id === unpriced.reservation.id)?.issues.includes("entity_mismatch"), true);
  assert.equal(report.rows.find((row) => row.id === unpriced.reservation.id)?.issues.includes("missing_contract"), true);
  assert.equal(report.summary.unassignedClients, null, "Company ownership totals remain private");
  assert.ok(!JSON.stringify(report).includes(foreign.reservation.id));
  assert.ok(!JSON.stringify(report).includes(proof.document.id), "Sellers do not receive NAS references, quotes or hashes");
  const future = await getContractControlReport({ q: tag, scope: "upcoming" }, seller, now);
  assert.deepEqual(future.rows.map((row) => row.id), [upcoming.reservation.id]);
  const history = await getContractControlReport({ q: tag, scope: "history" }, seller, now);
  assert.deepEqual(history.rows.map((row) => row.id), [historical.reservation.id]);
  const all = await getContractControlReport({ q: tag, scope: "all" }, manager, now);
  assert.equal(all.rows.length, 5);
  assert.equal(all.rows.find((row) => row.id === own.reservation.id)?.evidence.documents[0]?.documentId, proof.document.id);
  await prisma.rentalPriceSegment.createMany({ data: [
    { rentalId: own.reservation.id, effectiveFrom: new Date("2090-01-01"), effectiveTo: new Date("2090-01-14"), monthlyRent: 100, currency: "EUR" },
    { rentalId: own.reservation.id, effectiveFrom: new Date("2090-01-16"), effectiveTo: new Date("2090-01-31"), monthlyRent: 100, currency: "EUR" },
  ] });
  const gapReport = await getContractControlReport({ q: tag }, seller, now);
  const gap = gapReport.rows.find((row) => row.id === own.reservation.id)!;
  assert.equal(gap.monthlyRent, null, "A price-history gap cannot fall back to a positive header");
  assert.equal(gap.evidence.state, "partial", "Complete document facts do not certify an invalid price history");
  assert.equal(gap.issues.includes("price_history_invalid"), true);
  assert.deepEqual(gap.priceSchedule.reasons, ["PRICE_SEGMENT_GAP"]);
  await prisma.rentalPriceSegment.deleteMany({ where: { rentalId: own.reservation.id } });
  await prisma.rentalPriceSegment.createMany({ data: [
    { rentalId: own.reservation.id, effectiveFrom: new Date("2090-01-01"), effectiveTo: new Date("2090-01-20"), monthlyRent: 100, currency: "EUR" },
    { rentalId: own.reservation.id, effectiveFrom: new Date("2090-01-20"), effectiveTo: new Date("2090-01-31"), monthlyRent: 100, currency: "EUR" },
  ] });
  const overlapReport = await getContractControlReport({ q: tag }, seller, now);
  const overlap = overlapReport.rows.find((row) => row.id === own.reservation.id)!;
  assert.equal(overlap.monthlyRent, null, "A future overlap also invalidates the complete contractual history");
  assert.equal(overlap.evidence.state, "partial");
  assert.equal(overlap.issues.includes("price_history_conflict"), true);
  assert.deepEqual(overlap.priceSchedule.reasons, ["PRICE_SEGMENT_OVERLAP"]);
  await prisma.documentAuditSource.update({ where: { id: source.id }, data: { activeScanId: "new-unfinished-scan" } });
  const partialScan = await getContractControlReport({ q: tag }, seller, now);
  assert.equal(partialScan.rows.find((row) => row.id === own.reservation.id)?.evidence.state, "stale", "An unfinished scan cannot certify current evidence");
  await assert.rejects(() => getContractControlReport({}, field, now), (error: unknown) => error instanceof ContractControlError && error.status === 403);
  await assert.rejects(() => getContractControlReport({}, { ...seller, tokenVersion: seller.tokenVersion + 1 }, now), (error: unknown) => error instanceof ContractControlError && error.status === 401);
  assert.deepEqual(await prisma.reservation.findMany({ where: { id: { in: ids.reservations } }, orderBy: { id: "asc" } }), before, "Reports never mutate rentals");
  console.log(JSON.stringify({ passed: true, assertions: 45, coverage: ["inclusive current/upcoming/history", "effective-date price comparison", "gap and future overlap fail closed", "exact evidence identity", "verified/partial/stale/conflict/difference", "cross-portfolio privacy", "entity/pricing/reference defects", "read-only business records", "live role/tokenVersion", "CSV formula isolation"] }));
} finally {
  await prisma.documentFactReview.deleteMany({ where: { reviewedByUserId: { in: ids.users } } });
  await prisma.sourceDocumentVersion.deleteMany({ where: { document: { sourceId: { in: ids.sources } } } });
  await prisma.sourceDocument.deleteMany({ where: { sourceId: { in: ids.sources } } });
  await prisma.documentAuditSource.deleteMany({ where: { id: { in: ids.sources } } });
  await prisma.reservation.deleteMany({ where: { id: { in: ids.reservations } } });
  await prisma.campaign.deleteMany({ where: { id: { in: ids.campaigns } } });
  await prisma.clientAccount.deleteMany({ where: { id: { in: ids.clients } } });
  await prisma.location.deleteMany({ where: { id: { in: ids.locations } } });
  await prisma.category.deleteMany({ where: { id: { in: ids.categories } } });
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  await prisma.$disconnect();
}

}
main().catch((error) => { console.error(error); process.exitCode = 1; });
