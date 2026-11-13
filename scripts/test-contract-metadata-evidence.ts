import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { applyContractMetadataOperation, contractMetadataTransactionOptions, hashContractMetadataOperation, verifyContractMetadataSource, type ContractMetadataOperation } from "../src/lib/contract-metadata-evidence";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";

const hash = (v: Buffer | string) => crypto.createHash("sha256").update(v).digest("hex");
// Synthetic ZIP with one WordprocessingML table cell containing SYN-42.
const sourceBytes = Buffer.from("UEsDBBQAAAAIAFuYbV2mviYyhQAAAMEAAAARAAAAd29yZC9kb2N1bWVudC54bWxFjsEOwiAQRH/F9K7bNMYDQT7Bi6ceKWDbhAWyYNC/t0s1Xt7sZHcnI6uw0TzRhXJ4oQ9Z1Gu3lJIEQDaLQ51PMbmw7R6RUJfN0gw1kk0Ujct5DTN6GPr+AqjX0ClZxRTtm7VMvgk1GmZi7F7dx9vxPEjgmUmNqZGvYX+FbxD8guFfWn0AUEsBAhQDFAAAAAgAW5htXaa+JjKFAAAAwQAAABEAAAAAAAAAAAAAAIABAAAAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAABAAEAPwAAALQAAAAAAA==", "base64");

async function main() {
  loadEnvFile(); assertSyntheticEnvironment();
  const url = new URL(process.env.DATABASE_URL || "");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.equal(url.pathname, "/focus_preview_bank_evidence");
  const client = new PrismaClient({ log: [] }), prefix = `contract-metadata-${crypto.randomUUID()}`;
  const ids: string[] = [], old = new Date("2026-09-01T00:00:00.000Z");
  const checks: string[] = [];
  const category = await client.category.create({ data: { name: prefix, slug: prefix } });
  const location = await client.location.create({ data: { categoryId: category.id, code: `SYN-${prefix}` } });
  const customer = await client.clientAccount.create({ data: { companyName: "Synthetic contract customer", status: "active" } });
  const campaign = await client.campaign.create({ data: { clientId: customer.id, campaignName: "Synthetic contract campaign", companyEntity: "Focus Media", currency: "RON" } });
  const verifiedSource = verifyContractMetadataSource({ bytes: sourceBytes, expectedHash: hash(sourceBytes) });
  async function fixture(options: { updatedAt?: Date; contractNumber?: string | null } = {}) {
    const row = await client.reservation.create({ data: {
      locationId: location.id, clientId: customer.id, campaignId: campaign.id, contractCompany: "Focus Media", status: "BOOKED",
      clientName: customer.companyName, contractNumber: options.contractNumber ?? null, amount: 100, monthlyRentShare: 100, monthlyRentTotal: 100,
      currency: "RON", periodStart: old, periodEnd: new Date("2027-09-01T00:00:00.000Z"), createdAt: old, updatedAt: options.updatedAt || old,
      notes: "Synthetic note must be preserved", productionNotes: "Synthetic production note must be preserved"
    } });
    ids.push(row.id);
    const op: ContractMetadataOperation = {
      action_id: `CONTRACT-FILL-${String(ids.length).padStart(3, "0")}`, kind: "reservation.fill-missing-contract-number", reservationId: row.id,
      expectedUpdatedAt: row.updatedAt.toISOString(), expected: {
        contractNumber: row.contractNumber, locationId: row.locationId, clientId: customer.id, campaignId: campaign.id,
        contractCompany: "Focus Media", contractGroupId: null, status: "BOOKED", periodStart: row.periodStart.toISOString(), periodEnd: row.periodEnd.toISOString()
      }, proposed: { contractNumber: "SYN-42" }, source_fact_id: "contract-summary-t1-r1", source_anchor: "word/document.xml#tbl[1]/tr[1]/tc[1]",
      source_sha256: hash(sourceBytes), source_snapshot_date: "2026-10-27", source_company_code: "FOCUS_MEDIA", source_location_code: location.code,
      proof: "Synthetic reviewed exact identity and period", scope: "Missing contract number only", apply_status: "proposed_not_executed"
    };
    return { row, op };
  }
  const context = (op: ContractMetadataOperation) => ({ mode: "apply" as const, manifestHash: hash("synthetic-contract-manifest"), approvedOperationHash: hashContractMetadataOperation(op), runId: "synthetic-contract-metadata", source: verifiedSource });
  const apply = (op: ContractMetadataOperation) => client.$transaction(tx => applyContractMetadataOperation(tx, op, context(op)), contractMetadataTransactionOptions);
  const effects = async () => Promise.all([
    client.rentalChangeLog.count({ where: { rentalId: { in: ids } } }), client.auditLog.count({ where: { action: "reservation.contract_metadata_evidence.committed" } }),
    client.rentalPriceSegment.count({ where: { rentalId: { in: ids } } }), client.financialReceivablePayment.count(), client.financialPayablePayment.count()
  ]);
  try {
    const { row, op } = await fixture(), ctx = context(op), before = await effects();
    assert.throws(() => verifyContractMetadataSource({ bytes: Buffer.from("wrong"), expectedHash: op.source_sha256 }), /CONTRACT_SOURCE_HASH_OR_CONTAINER_INVALID/);
    await assert.rejects(client.$transaction(tx => applyContractMetadataOperation(tx, op, { ...ctx, source: { sourceHash: op.source_sha256 } }), contractMetadataTransactionOptions));
    await assert.rejects(client.$transaction(tx => applyContractMetadataOperation(tx, { ...op, proposed: { contractNumber: "SYN-43" } }, ctx), contractMetadataTransactionOptions), /CONTRACT_APPROVAL_OR_SOURCE_MISMATCH/);
    await assert.rejects(apply({ ...op, proposed: { ...op.proposed, amount: 1 } } as any));
    await assert.rejects(applyContractMetadataOperation(client as any, op, ctx), /CONTRACT_TRANSACTION_REQUIRED/);
    assert.deepEqual(await effects(), before);
    const checked = await client.$transaction(tx => applyContractMetadataOperation(tx, op, { ...ctx, mode: "check" }), contractMetadataTransactionOptions);
    assert.equal(checked.wouldUpdate, 1); assert.equal(checked.applied, false);
    assert.deepEqual(await client.reservation.findUnique({ where: { id: row.id } }), row); assert.deepEqual(await effects(), before);
    checks.push("original source/hash/approval/strict field allowlist and check mode perform zero writes");

    await assert.rejects(client.$transaction(async tx => { await applyContractMetadataOperation(tx, op, ctx); throw new Error("synthetic-contract-rollback"); }, contractMetadataTransactionOptions), /synthetic-contract-rollback/);
    assert.deepEqual(await client.reservation.findUnique({ where: { id: row.id } }), row); assert.deepEqual(await effects(), before);
    checks.push("contract metadata, RentalChangeLog and audit roll back atomically");

    const concurrent = await Promise.all([apply(op), apply(op)]);
    assert.equal(concurrent.reduce((n, r) => n + r.updated, 0), 1); assert.equal(concurrent.filter(r => r.replay).length, 1);
    const after = await client.reservation.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.contractNumber, "SYN-42");
    assert.deepEqual({ ...after, contractNumber: row.contractNumber, updatedAt: row.updatedAt }, row);
    assert.deepEqual(await effects(), [1, 1, 0, 0, 0]);
    const audit = await client.auditLog.findFirstOrThrow({ where: { action: "reservation.contract_metadata_evidence.committed" } });
    assert.equal(audit.userId, null); assert.equal((audit.metadata as any).actorKind, "SYSTEM");
    const change = await client.rentalChangeLog.findFirstOrThrow({ where: { rentalId: row.id } });
    assert.equal(change.createdByUserId, null); assert.equal((change.nextJson as any).sourceDocxSha256, op.source_sha256);
    assert.equal((change.nextJson as any).sourceCellAnchor, op.source_anchor);
    await assert.rejects(apply({ ...op, proposed: { contractNumber: "SYN-43" } }), /CONTRACT_OPERATION_INTENT_CONFLICT/);
    checks.push("concurrent apply/replay changes only missing contractNumber, preserves all commercial data and records truthful system provenance");

    const newer = await fixture({ updatedAt: new Date("2026-11-01T00:00:00Z") });
    await assert.rejects(apply(newer.op), /CONTRACT_NEWER_APPLICATION_EVIDENCE/);
    const segment = await fixture();
    await client.rentalPriceSegment.create({ data: { rentalId: segment.row.id, effectiveFrom: old, monthlyRent: 100, currency: "RON", createdAt: new Date("2026-11-01T00:00:00Z") } });
    await assert.rejects(apply(segment.op), /CONTRACT_NEWER_RENTAL_HISTORY/);
    const log = await fixture();
    await client.rentalChangeLog.create({ data: { rentalId: log.row.id, action: "synthetic_later_correction", createdAt: new Date("2026-11-01T00:00:00Z") } });
    await assert.rejects(apply(log.op), /CONTRACT_NEWER_RENTAL_HISTORY/);
    checks.push("post-snapshot reservation, price segment and change-log evidence each prevent correction");

    const guards = await fixture();
    await assert.rejects(apply({ ...guards.op, expected: { ...guards.op.expected, locationId: "synthetic-wrong-location" } }), /CONTRACT_IDENTITY_DRIFT_locationId/);
    await assert.rejects(apply({ ...guards.op, expected: { ...guards.op.expected, periodEnd: "2027-08-01T00:00:00.000Z" } }), /CONTRACT_PERIOD_DRIFT/);
    await assert.rejects(apply({ ...guards.op, source_company_code: "EXCELLENCE_MEDIA" }), /CONTRACT_SOURCE_IDENTITY_DRIFT/);
    await client.campaign.update({ where: { id: campaign.id }, data: { companyEntity: "Excellence Media" } });
    await assert.rejects(apply(guards.op), /CONTRACT_SOURCE_IDENTITY_DRIFT/);
    await client.campaign.update({ where: { id: campaign.id }, data: { companyEntity: "Focus Media" } });
    await assert.rejects(apply({ ...guards.op, expectedUpdatedAt: "2026-09-02T00:00:00.000Z" }), /CONTRACT_RESERVATION_VERSION_DRIFT/);
    const filled = await fixture({ contractNumber: "SYN-EXISTING" });
    await assert.rejects(apply({ ...filled.op, expected: { ...filled.op.expected, contractNumber: null } }), /CONTRACT_REFERENCE_NOT_EMPTY/);
    assert.equal((await client.reservation.findUniqueOrThrow({ where: { id: filled.row.id } })).contractNumber, "SYN-EXISTING");
    checks.push("identity, period, legal entity, version and existing contract-reference guards refuse overwrites");
    console.log(JSON.stringify({ ok: true, syntheticOnly: true, checks }, null, 2));
  } finally {
    await client.rentalChangeLog.deleteMany({ where: { rentalId: { in: ids } } });
    await client.rentalPriceSegment.deleteMany({ where: { rentalId: { in: ids } } });
    await client.auditLog.deleteMany({ where: { action: "reservation.contract_metadata_evidence.committed" } });
    await client.reservation.deleteMany({ where: { id: { in: ids } } });
    await client.campaign.delete({ where: { id: campaign.id } }); await client.clientAccount.delete({ where: { id: customer.id } });
    await client.location.delete({ where: { id: location.id } }); await client.category.delete({ where: { id: category.id } });
    await client.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
