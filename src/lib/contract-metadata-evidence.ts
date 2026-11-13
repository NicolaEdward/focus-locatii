import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { companyCodeForEntity } from "@/lib/company-entities";
import { recordTransactionalAudit } from "@/lib/transactional-audit";

const hash = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(191);
const timestamp = z.string().datetime({ offset: true });
const anchor = z.string().max(240).regex(/^word\/document\.xml#(?:body\[\d+\]\/)?tbl\[\d+\]\/tr\[\d+\]\/tc\[\d+\]$/);
const sourceSnapshotDate = "2026-10-27" as const;
const snapshotEnd = new Date(`${sourceSnapshotDate}T23:59:59.999Z`);
const emptyContractNumber = z.string().max(191).nullable().refine(v => v == null || v.trim() === "");

/** Only the reviewed missing-reference correction; no general reservation patch. */
export const contractMetadataOperationSchema = z.object({
  action_id: z.string().regex(/^CONTRACT-FILL-\d{3}$/),
  kind: z.literal("reservation.fill-missing-contract-number"),
  reservationId: id,
  expectedUpdatedAt: timestamp,
  expected: z.object({
    contractNumber: emptyContractNumber, locationId: id, clientId: id, campaignId: id,
    contractCompany: z.string().min(1).max(191), contractGroupId: id.nullable(), status: z.literal("BOOKED"),
    periodStart: timestamp, periodEnd: timestamp
  }).strict(),
  proposed: z.object({ contractNumber: z.string().trim().min(1).max(191) }).strict(),
  source_fact_id: z.string().regex(/^contract-summary-t\d+-r\d+$/),
  source_anchor: anchor,
  source_sha256: sha256,
  source_snapshot_date: z.literal(sourceSnapshotDate),
  source_company_code: z.enum(["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"]),
  source_location_code: z.string().min(1).max(100),
  proof: z.string().max(1000),
  scope: z.string().max(1000),
  apply_status: z.literal("proposed_not_executed")
}).strict();
export type ContractMetadataOperation = z.infer<typeof contractMetadataOperationSchema>;

export type VerifiedContractMetadataSource = Readonly<{ sourceHash: string }>;
const verifiedSources = new WeakSet<VerifiedContractMetadataSource>();
export function verifyContractMetadataSource(input: { bytes: Buffer; expectedHash: string }): VerifiedContractMetadataSource {
  sha256.parse(input.expectedHash);
  if (input.bytes.length < 4 || input.bytes.length > 32 * 1024 * 1024 || !input.bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) || hash(input.bytes) !== input.expectedHash) {
    throw new Error("CONTRACT_SOURCE_HASH_OR_CONTAINER_INVALID");
  }
  // This proves the original reviewed DOCX bytes, not that a linked contract is
  // signed. Cell text/number extraction is approved by the external manifest.
  const source = Object.freeze({ sourceHash: input.expectedHash });
  verifiedSources.add(source);
  return source;
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
export function hashContractMetadataOperation(input: unknown) { return hash(canonical(contractMetadataOperationSchema.parse(input))); }
const contextSchema = z.object({
  mode: z.enum(["check", "apply"]), manifestHash: sha256, approvedOperationHash: sha256,
  runId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
  source: z.custom<VerifiedContractMetadataSource>(v => typeof v === "object" && v !== null && verifiedSources.has(v as VerifiedContractMetadataSource))
}).strict();
export type ContractMetadataContext = z.infer<typeof contextSchema>;
export const contractMetadataTransactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 30_000
} as const;
export type ContractMetadataResult = { updated: number; wouldUpdate: number; applied: boolean; replay: boolean; reservationId: string };
function requireGuard(condition: unknown, code: string): asserts condition { if (!condition) throw new Error(code); }
const locationCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Caller supplies the transaction and validates the reviewed manifest/DB target.
 * Only contractNumber and Prisma's updatedAt are changed on the reservation. */
export async function applyContractMetadataOperation(
  tx: Prisma.TransactionClient,
  input: ContractMetadataOperation,
  execution: ContractMetadataContext
): Promise<ContractMetadataResult> {
  requireGuard(typeof (tx as unknown as { $transaction?: unknown }).$transaction !== "function", "CONTRACT_TRANSACTION_REQUIRED");
  const op = contractMetadataOperationSchema.parse(input), context = contextSchema.parse(execution);
  const operationHash = hashContractMetadataOperation(op);
  requireGuard(operationHash === context.approvedOperationHash && context.source.sourceHash === op.source_sha256, "CONTRACT_APPROVAL_OR_SOURCE_MISMATCH");
  const operationKey = `contract-metadata:${hash(`${op.source_sha256}|${op.reservationId}`)}`;
  await tx.$queryRaw(Prisma.sql`SELECT id FROM portfolio_reservations WHERE id = ${op.reservationId} FOR UPDATE`);
  const current = await tx.reservation.findUnique({ where: { id: op.reservationId }, include: { location: true, campaign: true, client: true } });
  requireGuard(current, "CONTRACT_RESERVATION_NOT_FOUND");
  const receipt = await tx.auditLog.findFirst({ where: {
    action: "reservation.contract_metadata_evidence.committed", entityType: "contract_metadata_operation", entityId: operationKey
  } });
  if (receipt) {
    const metadata = receipt.metadata as Record<string, unknown> | null;
    requireGuard(metadata?.operationHash === operationHash, "CONTRACT_OPERATION_INTENT_CONFLICT");
    requireGuard(current.contractNumber === op.proposed.contractNumber, "CONTRACT_COMMITTED_REFERENCE_CHANGED");
    return { updated: 0, wouldUpdate: 0, applied: false, replay: true, reservationId: current.id };
  }
  requireGuard(current.updatedAt.toISOString() === new Date(op.expectedUpdatedAt).toISOString(), "CONTRACT_RESERVATION_VERSION_DRIFT");
  requireGuard(current.createdAt <= snapshotEnd && current.updatedAt <= snapshotEnd, "CONTRACT_NEWER_APPLICATION_EVIDENCE");
  for (const key of ["locationId", "clientId", "campaignId", "contractCompany", "contractGroupId", "status"] as const) {
    requireGuard(current[key] === op.expected[key], `CONTRACT_IDENTITY_DRIFT_${key}`);
  }
  requireGuard(current.periodStart.toISOString() === new Date(op.expected.periodStart).toISOString() && current.periodEnd.toISOString() === new Date(op.expected.periodEnd).toISOString(), "CONTRACT_PERIOD_DRIFT");
  requireGuard(current.contractNumber === op.expected.contractNumber && (!current.contractNumber || current.contractNumber.trim() === ""), "CONTRACT_REFERENCE_NOT_EMPTY");
  requireGuard(current.client && current.campaign?.clientId === current.clientId && !["merged", "archived"].includes(current.client.status), "CONTRACT_CLIENT_OR_CAMPAIGN_INVALID");
  requireGuard(companyCodeForEntity(current.contractCompany) === op.source_company_code && companyCodeForEntity(current.campaign.companyEntity) === op.source_company_code && locationCode(current.location.code) === locationCode(op.source_location_code), "CONTRACT_SOURCE_IDENTITY_DRIFT");
  const [newerSegments, newerLogs] = await Promise.all([
    tx.rentalPriceSegment.count({ where: { rentalId: current.id, createdAt: { gt: snapshotEnd } } }),
    tx.rentalChangeLog.count({ where: { rentalId: current.id, createdAt: { gt: snapshotEnd } } })
  ]);
  requireGuard(newerSegments === 0 && newerLogs === 0, "CONTRACT_NEWER_RENTAL_HISTORY");
  if (context.mode === "check") return { updated: 0, wouldUpdate: 1, applied: false, replay: false, reservationId: current.id };

  const updated = await tx.reservation.updateMany({ where: { id: current.id, updatedAt: current.updatedAt }, data: { contractNumber: op.proposed.contractNumber } });
  requireGuard(updated.count === 1, "CONTRACT_CONCURRENT_VERSION_DRIFT");
  const provenance = {
    actorKind: "SYSTEM", systemName: "contract-metadata-reconciliation", sourceKind: "owner_supplied_summary_not_signed_contract_attestation",
    sourceDocxSha256: op.source_sha256, sourceSnapshotDate: op.source_snapshot_date, sourceFactId: op.source_fact_id, sourceCellAnchor: op.source_anchor,
    manifestHash: context.manifestHash, operationHash, runId: context.runId
  };
  await tx.rentalChangeLog.create({ data: {
    rentalId: current.id, action: "contract_metadata_correction", previousJson: { contractNumber: current.contractNumber },
    nextJson: { contractNumber: op.proposed.contractNumber, ...provenance },
    note: "Completare referinta contractuala lipsa din rezumatul furnizat de proprietar; documentul semnat nu a fost verificat.", createdByUserId: null
  } });
  await recordTransactionalAudit(tx, {
    actor: null, action: "reservation.contract_metadata_evidence.committed", entityType: "contract_metadata_operation", entityId: operationKey,
    correlationId: context.runId, metadata: { ...provenance, actionId: op.action_id, reservationId: current.id, fields: ["contractNumber"] }
  });
  return { updated: 1, wouldUpdate: 1, applied: true, replay: false, reservationId: current.id };
}
