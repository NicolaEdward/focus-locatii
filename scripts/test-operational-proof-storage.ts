import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  OPERATIONAL_PROOF_MAX_FILE_SIZE,
  OPERATIONAL_PROOF_MAX_TOTAL_SIZE,
  validateOperationalProofBuffer,
  validateOperationalProofUploadTotal
} from "../src/lib/operational-proof";
import {
  operationalProofChecksum,
  operationalProofObjectKey,
  operationalProofStorageConfigured
} from "../src/lib/operational-proof-storage";

function main() {
  schemaIsBackwardCompatible();
  objectKeysAndChecksumsAreSafe();
  imageValidationRejectsSpoofedContent();
  uploadLimitsFitTheFunctionBoundary();
  routesUsePrivateDualReadAndDelete();
  backfillIsGuardedAndRetainsLegacyPayloads();
  publicApiDoesNotExposeStorageMetadata();
  console.log(JSON.stringify({
    ok: true,
    checked: [
      "additive nullable private-storage metadata",
      "non-guessable environment-scoped object keys",
      "SHA-256 checksums",
      "MIME, magic-byte and image dimension validation",
      "4 MiB total upload boundary",
      "authenticated private-object read with Base64 fallback",
      "object deletion before metadata deletion",
      "guarded idempotent backfill retaining legacy Base64",
      "no public storage metadata leak"
    ]
  }, null, 2));
}

function schemaIsBackwardCompatible() {
  const schema = read("prisma", "schema.prisma");
  for (const field of ["storageProvider", "storageKey", "storageChecksum", "storageEtag", "storageMigratedAt", "storageVerifiedAt"]) {
    assert(schema.includes(field), `ClientDocument must include ${field}`);
  }
  assert(schema.includes("storageUrl            String?"), "legacy storageUrl must remain nullable for dual-read");
  const migration = read("prisma", "migrations", "20260720000000_private_operational_proof_storage", "migration.sql");
  assert(!migration.includes("DROP COLUMN"), "storage migration must not drop legacy data");
  assert(migration.includes("MODIFY COLUMN `storageUrl` LONGTEXT NULL"), "migration must preserve legacy payloads while allowing object-only writes");
}

function objectKeysAndChecksumsAreSafe() {
  const first = operationalProofObjectKey({ reservationId: "reservation-sensitive", fileName: "client name.png", environment: "preview" });
  const second = operationalProofObjectKey({ reservationId: "reservation-sensitive", fileName: "client name.png", environment: "preview" });
  assert(first.startsWith("operational-proof/preview/reservation-sensitive/"));
  assert(first.endsWith(".png"));
  assert.notEqual(first, second, "every object key must contain fresh entropy");
  assert(!first.includes("client-name"), "object keys must not contain user filenames");
  assert.equal(operationalProofChecksum(Buffer.from("proof")), "c1cda26362828b69266512052b97cb3729e3b052e4ade47c0a1e3383defe73c7");
  const previousEnabled = process.env.OPERATIONAL_PROOF_STORAGE_ENABLED;
  const previousToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.OPERATIONAL_PROOF_STORAGE_ENABLED;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  assert.equal(operationalProofStorageConfigured(), false, "storage must fail closed when it is not configured");
  restoreEnv("OPERATIONAL_PROOF_STORAGE_ENABLED", previousEnabled);
  restoreEnv("BLOB_READ_WRITE_TOKEN", previousToken);
}

function imageValidationRejectsSpoofedContent() {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const decoded = validateOperationalProofBuffer(png, "image/png");
  assert.deepEqual(decoded, { mimeType: "image/png", width: 1, height: 1 });
  assert.throws(() => validateOperationalProofBuffer(png, "image/jpeg"), /nu corespunde/);
  assert.throws(() => validateOperationalProofBuffer(Buffer.from("not-an-image"), "image/png"), /nu corespunde/);
}

function uploadLimitsFitTheFunctionBoundary() {
  assert.equal(OPERATIONAL_PROOF_MAX_FILE_SIZE, 4 * 1024 * 1024);
  assert.equal(OPERATIONAL_PROOF_MAX_TOTAL_SIZE, 4 * 1024 * 1024);
  const files = [new File([Buffer.alloc(3 * 1024 * 1024)], "a.png", { type: "image/png" }), new File([Buffer.alloc(2 * 1024 * 1024)], "b.png", { type: "image/png" })];
  assert.throws(() => validateOperationalProofUploadTotal(files), /maximum 4 MB/);
}

function routesUsePrivateDualReadAndDelete() {
  const complete = read("src", "app", "api", "admin", "operational", "tasks", "complete", "route.ts");
  const proof = read("src", "app", "api", "admin", "operational", "proof-photos", "[id]", "route.ts");
  const cleanup = read("src", "app", "api", "cron", "delete-expired-operational-proof-photos", "route.ts");
  assert(complete.includes("uploadOperationalProofObject"));
  assert(complete.includes("storageUrl: null"));
  assert(complete.includes("cleanupUploadedProofs"), "failed DB writes must compensate uploaded objects");
  assert(proof.includes("readOperationalProofObject"));
  assert(proof.includes('document.storageUrl?.startsWith("data:")'), "legacy Base64 must remain a fallback");
  assert(!proof.includes("NextResponse.redirect(document.storageUrl)"), "operational proofs must never redirect to a permanent URL");
  assert(proof.includes('"cross-origin-resource-policy": "same-origin"'));
  assert(proof.indexOf("deleteOperationalProofObject") < proof.indexOf('status: "deleted"'), "manual deletion must remove object storage first");
  assert(cleanup.includes("deleteOperationalProofObject"));
  assert(cleanup.includes('status: { in: ["active", "deleting"] }'), "cleanup must be retryable after an interrupted delete");
}

function backfillIsGuardedAndRetainsLegacyPayloads() {
  const source = read("scripts", "backfill-operational-proof-storage.ts");
  assert(source.includes("OPERATIONAL_PROOF_BACKFILL_ENABLED"));
  assert(source.includes("OPERATIONAL_PROOF_BACKFILL_PRODUCTION_APPROVED"));
  assert(source.includes("verifyOperationalProofObject"));
  assert(source.includes("storageKey: null"), "backfill must be idempotent");
  assert(!source.includes("storageUrl: null"), "backfill must retain Base64 until explicit cutover approval");
  assert(source.includes("legacyPayloadsRetained: true"));
}

function publicApiDoesNotExposeStorageMetadata() {
  const publicRoute = read("src", "app", "api", "locations", "route.ts");
  const publicLocations = read("src", "lib", "locations.ts");
  for (const field of ["storageProvider", "storageKey", "storageChecksum", "operational_proof_photo"]) {
    assert(!publicRoute.includes(field), `public route must not expose ${field}`);
    assert(!publicLocations.includes(field), `public serializer must not expose ${field}`);
  }
}

function read(...segments: string[]) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

main();
