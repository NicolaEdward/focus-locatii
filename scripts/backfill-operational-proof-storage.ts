import crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";
import {
  OPERATIONAL_PROOF_DOCUMENT_TYPE,
  validateOperationalProofBuffer
} from "../src/lib/operational-proof";
import {
  deleteOperationalProofObject,
  operationalProofChecksum,
  uploadOperationalProofObject,
  verifyOperationalProofObject
} from "../src/lib/operational-proof-storage";

const apply = process.argv.includes("--apply");
const limit = Math.min(100, Math.max(1, Number(argumentValue("--limit") || 25)));
const environment = String(process.env.VERCEL_ENV || process.env.APP_ENV || "development").toLowerCase();
const batchId = `proof-backfill-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomBytes(4).toString("hex")}`;

async function main() {
  if (apply && process.env.OPERATIONAL_PROOF_BACKFILL_ENABLED !== "true") {
    throw new Error("OPERATIONAL_PROOF_BACKFILL_ENABLED=true is required for --apply.");
  }
  if (apply && environment === "production" && process.env.OPERATIONAL_PROOF_BACKFILL_PRODUCTION_APPROVED !== "I_APPROVE_PROOF_BACKFILL") {
    throw new Error("Production backfill requires explicit OPERATIONAL_PROOF_BACKFILL_PRODUCTION_APPROVED approval.");
  }

  const rows = await prisma.clientDocument.findMany({
    where: {
      documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE,
      status: "active",
      storageKey: null,
      storageUrl: { startsWith: "data:" },
      OR: [{ expiryDate: null }, { expiryDate: { gte: new Date() } }]
    },
    select: {
      id: true,
      reservationId: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      storageUrl: true
    },
    orderBy: { uploadedAt: "asc" },
    take: limit
  });

  const results: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    try {
      if (!row.reservationId || !row.fileType || !row.storageUrl) throw new Error("missing_required_metadata");
      const bytes = decodeDataUrl(row.storageUrl, row.fileType);
      validateOperationalProofBuffer(bytes, row.fileType);
      const checksum = operationalProofChecksum(bytes);
      if (row.fileSize != null && row.fileSize !== bytes.byteLength) throw new Error("file_size_mismatch");
      if (!apply) {
        results.push({ id: row.id, action: "would_migrate", bytes: bytes.byteLength, checksum: checksum.slice(0, 12) });
        continue;
      }

      const stored = await uploadOperationalProofObject({
        reservationId: row.reservationId,
        fileName: row.fileName,
        contentType: row.fileType,
        bytes
      });
      const verified = await verifyOperationalProofObject({ key: stored.key, expectedBytes: bytes.byteLength, expectedChecksum: checksum });
      if (!verified) {
        await deleteOperationalProofObject(stored.key, stored.etag);
        throw new Error("object_verification_failed");
      }
      const now = new Date();
      const updated = await prisma.clientDocument.updateMany({
        where: { id: row.id, status: "active", storageKey: null },
        data: {
          storageProvider: stored.provider,
          storageKey: stored.key,
          storageChecksum: checksum,
          storageEtag: stored.etag,
          storageMigratedAt: now,
          storageVerifiedAt: now
        }
      });
      if (updated.count !== 1) {
        await deleteOperationalProofObject(stored.key, stored.etag);
        throw new Error("document_changed_during_backfill");
      }
      results.push({ id: row.id, action: "migrated_and_verified", bytes: bytes.byteLength, checksum: checksum.slice(0, 12) });
    } catch (error) {
      results.push({ id: row.id, action: "failed", reason: safeReason(error) });
    }
  }

  const failed = results.filter((item) => item.action === "failed").length;
  console.log(JSON.stringify({
    ok: failed === 0,
    mode: apply ? "apply" : "dry_run",
    environment,
    batchId,
    limit,
    scanned: rows.length,
    migrated: results.filter((item) => item.action === "migrated_and_verified").length,
    failed,
    legacyPayloadsRetained: true,
    results
  }, null, 2));
  if (failed) process.exitCode = 1;
}

function decodeDataUrl(value: string, declaredMime: string) {
  const match = value.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[1] !== declaredMime) throw new Error("invalid_data_url");
  return Buffer.from(match[2], "base64");
}

function argumentValue(name: string) {
  const exact = process.argv.find((value) => value.startsWith(`${name}=`));
  return exact?.slice(name.length + 1) || null;
}

function safeReason(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 80) || "unknown_error";
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
