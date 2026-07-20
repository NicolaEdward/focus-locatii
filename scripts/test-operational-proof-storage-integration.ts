import { NextRequest } from "next/server";
import { GET as cleanupExpiredProofs } from "../src/app/api/cron/delete-expired-operational-proof-photos/route";
import { prisma } from "../src/lib/prisma";
import { OPERATIONAL_PROOF_DOCUMENT_TYPE } from "../src/lib/operational-proof";
import {
  OPERATIONAL_PROOF_STORAGE_PROVIDER,
  deleteOperationalProofObject,
  uploadOperationalProofObject
} from "../src/lib/operational-proof-storage";
import { assertSyntheticEnvironment } from "./release/env-utils";

assertSyntheticEnvironment();

const reservationId = "preview-reservation-booked";
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const initialToken = process.env.BLOB_READ_WRITE_TOKEN;
const initialCountPromise = prisma.clientDocument.count({ where: { documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE } });
const createdIds: string[] = [];
const createdKeys: string[] = [];

async function main() {
  if (!initialToken) throw new Error("Preview Blob token is required for integration testing.");
  const initialCount = await initialCountPromise;
  const stored = await uploadOperationalProofObject({
    reservationId,
    fileName: "cleanup-test.png",
    contentType: "image/png",
    bytes: image
  });
  createdKeys.push(stored.key);
  const cleanupId = `preview-proof-cleanup-${Date.now()}`;
  createdIds.push(cleanupId);
  await prisma.clientDocument.create({ data: proofData(cleanupId, stored.key, stored.checksum, stored.etag) });

  const first = await runCleanup();
  assertStatus(first, 200);
  const cleaned = await prisma.clientDocument.findUniqueOrThrow({ where: { id: cleanupId }, select: { status: true, storageUrl: true } });
  if (cleaned.status !== "deleted" || cleaned.storageUrl !== `deleted:${cleanupId}`) throw new Error("Cleanup did not remove the private proof payload.");
  createdKeys.splice(createdKeys.indexOf(stored.key), 1);

  const retryId = `preview-proof-retry-${Date.now()}`;
  createdIds.push(retryId);
  await prisma.clientDocument.create({ data: proofData(retryId, `operational-proof/preview/${reservationId}/missing-${Date.now()}.png`, "0".repeat(64), null) });
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_invalid_test_token";
  const failed = await runCleanup();
  assertStatus(failed, 200);
  const afterFailure = await prisma.clientDocument.findUniqueOrThrow({ where: { id: retryId }, select: { status: true } });
  if (afterFailure.status !== "active") throw new Error("A failed object delete must restore active status for retry.");

  process.env.BLOB_READ_WRITE_TOKEN = initialToken;
  const retried = await runCleanup();
  assertStatus(retried, 200);
  const afterRetry = await prisma.clientDocument.findUniqueOrThrow({ where: { id: retryId }, select: { status: true } });
  if (afterRetry.status !== "deleted") throw new Error("Cleanup retry did not finish the expired proof.");

  const idempotent = await runCleanup();
  assertStatus(idempotent, 200);
  const payload = await idempotent.json() as { scanned?: number };
  if (payload.scanned !== 0) throw new Error("Cleanup is not idempotent for the test records.");

  await cleanupFixtures();
  const finalCount = await prisma.clientDocument.count({ where: { documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE } });
  if (finalCount !== initialCount) throw new Error(`Proof count changed after integration test: ${initialCount} -> ${finalCount}`);
  console.log(JSON.stringify({
    ok: true,
    environment: process.env.APP_ENV,
    checked: ["private object cleanup", "failed delete restores retryable state", "cleanup retry", "cron idempotency", "proof count restored"],
    proofCountBefore: initialCount,
    proofCountAfter: finalCount
  }, null, 2));
}

function proofData(id: string, storageKey: string, checksum: string, etag: string | null) {
  return {
    id,
    reservationId,
    fileName: "synthetic-cleanup.png",
    fileType: "image/png",
    fileSize: image.byteLength,
    documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE,
    uploadedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    notes: JSON.stringify({ synthetic: true, kind: "decoration", expiresInDays: 30 }),
    storageUrl: null,
    storageProvider: OPERATIONAL_PROOF_STORAGE_PROVIDER,
    storageKey,
    storageChecksum: checksum,
    storageEtag: etag,
    storageMigratedAt: new Date(),
    storageVerifiedAt: new Date(),
    status: "active"
  };
}

async function runCleanup() {
  const request = new NextRequest("http://preview.local/api/cron/delete-expired-operational-proof-photos", {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }
  });
  return cleanupExpiredProofs(request);
}

function assertStatus(response: Response, expected: number) {
  if (response.status !== expected) throw new Error(`Unexpected cleanup response: ${response.status}`);
}

async function cleanupFixtures() {
  process.env.BLOB_READ_WRITE_TOKEN = initialToken;
  for (const key of createdKeys) await deleteOperationalProofObject(key).catch(() => undefined);
  if (createdIds.length) await prisma.clientDocument.deleteMany({ where: { id: { in: createdIds } } });
}

main()
  .catch(async (error) => {
    await cleanupFixtures().catch(() => undefined);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    process.env.BLOB_READ_WRITE_TOKEN = initialToken;
    await prisma.$disconnect();
  });
