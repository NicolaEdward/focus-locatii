import { prisma } from "../src/lib/prisma";
import { OPERATIONAL_PROOF_DOCUMENT_TYPE } from "../src/lib/operational-proof";

async function main() {
  const rows = await prisma.clientDocument.findMany({
    where: { documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE },
    select: {
      id: true,
      fileSize: true,
      status: true,
      expiryDate: true,
      storageUrl: true,
      storageProvider: true,
      storageKey: true,
      storageChecksum: true,
      storageVerifiedAt: true
    },
    orderBy: { uploadedAt: "asc" }
  });
  const now = Date.now();
  const summary = {
    total: rows.length,
    active: 0,
    expiredActive: 0,
    legacyBase64: 0,
    privateObjects: 0,
    unknownStorage: 0,
    declaredBytes: 0,
    legacyLongTextBytes: 0,
    verifiedObjects: 0
  };
  const items = rows.map((row) => {
    const active = row.status === "active";
    const expired = Boolean(row.expiryDate && row.expiryDate.getTime() < now);
    const legacyBase64 = Boolean(row.storageUrl?.startsWith("data:"));
    const privateObject = Boolean(row.storageProvider === "vercel_blob_private" && row.storageKey);
    if (active) summary.active += 1;
    if (active && expired) summary.expiredActive += 1;
    if (legacyBase64) summary.legacyBase64 += 1;
    if (privateObject) summary.privateObjects += 1;
    if (!legacyBase64 && !privateObject && row.status !== "deleted") summary.unknownStorage += 1;
    summary.declaredBytes += row.fileSize || 0;
    summary.legacyLongTextBytes += row.storageUrl ? Buffer.byteLength(row.storageUrl, "utf8") : 0;
    if (row.storageVerifiedAt && row.storageChecksum) summary.verifiedObjects += 1;
    return {
      id: row.id,
      status: row.status,
      expired,
      bytes: row.fileSize || 0,
      storage: privateObject ? "private_object" : legacyBase64 ? "legacy_base64" : row.status === "deleted" ? "deleted" : "unknown",
      verified: Boolean(row.storageVerifiedAt && row.storageChecksum)
    };
  });
  console.log(JSON.stringify({ ok: true, mode: "read_only", summary, items }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
