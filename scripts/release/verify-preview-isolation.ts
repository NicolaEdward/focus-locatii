import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { assertSyntheticEnvironment, databaseIdentity, loadEnvFile } from "./env-utils";

const previewEnvFile = process.env.PREVIEW_ENV_FILE || process.env.ENV_FILE;
loadEnvFile(previewEnvFile);
const previewUrl = process.env.DATABASE_URL;
const productionUrl = process.env.PRODUCTION_DATABASE_URL || readEnvValue(process.env.PRODUCTION_ENV_FILE || ".env", "DATABASE_URL");
if (!previewUrl || !productionUrl) throw new Error("Preview and Production database URLs are required for the isolation proof.");
const previewIdentity = assertSyntheticEnvironment();
const productionIdentity = databaseIdentity(productionUrl);
if (previewIdentity.fingerprint === productionIdentity.fingerprint || previewIdentity.database === productionIdentity.database) {
  throw new Error("Preview and Production point to the same database.");
}
const forbiddenPreviewKeys = [
  "RESEND_API_KEY",
  "NOTIFICATION_FROM_EMAIL",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  "BOOTSTRAP_ADMIN_EMAIL",
  "BOOTSTRAP_ADMIN_PASSWORD",
];
if (previewEnvFile) {
  for (const key of forbiddenPreviewKeys) {
    if (readEnvValue(previewEnvFile, key)) throw new Error(`Preview environment file must not define ${key}.`);
    delete process.env[key];
  }
} else if (forbiddenPreviewKeys.some((key) => Boolean(process.env[key]))) {
  throw new Error("Vercel Preview must not contain a real email provider or Production bootstrap credentials.");
}
for (const flag of ["OPERATION_TASKS_ENABLED", "OPERATION_TASK_READS_ENABLED", "ENABLE_LEGACY_RESERVATION_SYNC"]) {
  if (String(process.env[flag] || "").toLowerCase() === "true") throw new Error(`${flag} cannot be enabled in this milestone.`);
}

const preview = new PrismaClient({ datasources: { db: { url: previewUrl } } });
const production = new PrismaClient({ datasources: { db: { url: productionUrl } } });
const probeId = `release-isolation-${crypto.randomUUID()}`;

async function sensitiveCounts(prisma: PrismaClient) {
  const [reservationTotal, hold, reserved, booked, receivables, payments, notifications, proofTotal, operationTasks] = await Promise.all([
    prisma.reservation.count(),
    prisma.reservation.count({ where: { status: "HOLD" } }),
    prisma.reservation.count({ where: { status: "RESERVED" } }),
    prisma.reservation.count({ where: { status: "BOOKED" } }),
    prisma.financialReceivable.count(),
    prisma.financialReceivablePayment.count(),
    prisma.appNotification.count(),
    prisma.clientDocument.count({ where: { documentType: "operational_proof_photo" } }),
    prisma.operationTask.count(),
  ]);
  return { reservationTotal, hold, reserved, booked, receivables, payments, notifications, proofTotal, operationTasks };
}

async function main() {
  const productionBefore = await sensitiveCounts(production);
  const previewBefore = await sensitiveCounts(preview);
  const coo = await preview.user.findUnique({ where: { email: "coo.preview@focusmedia.test" }, select: { id: true } });
  if (!coo) throw new Error("The synthetic COO account is missing from Preview.");

  await preview.appNotification.create({
    data: {
      id: probeId,
      userId: coo.id,
      type: "release_isolation_probe",
      title: "Isolation probe",
      message: "Synthetic transient record",
      severity: "low",
      status: "open",
      metadata: { synthetic: true, transient: true },
    },
  });
  const previewDuring = await sensitiveCounts(preview);
  const productionDuring = await sensitiveCounts(production);
  await preview.appNotification.delete({ where: { id: probeId } });
  const previewAfter = await sensitiveCounts(preview);
  const productionAfter = await sensitiveCounts(production);

  if (previewDuring.notifications !== previewBefore.notifications + 1) throw new Error("The isolation probe was not observed in Preview.");
  if (JSON.stringify(previewBefore) !== JSON.stringify(previewAfter)) throw new Error("Preview counts did not return to their initial values after cleanup.");
  if (JSON.stringify(productionBefore) !== JSON.stringify(productionDuring) || JSON.stringify(productionBefore) !== JSON.stringify(productionAfter)) {
    throw new Error("Production database changed during Preview isolation test.");
  }
  console.log(JSON.stringify({
    ok: true,
    previewDatabaseFingerprint: previewIdentity.fingerprint,
    productionDatabaseFingerprint: productionIdentity.fingerprint,
    previewBefore,
    previewDuring,
    previewAfter,
    productionBefore,
    productionAfter,
  }, null, 2));
}

function readEnvValue(fileName: string, key: string) {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return undefined;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1 || line.slice(0, separator).trim() !== key) continue;
    return line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return undefined;
}

main().finally(async () => {
  await preview.appNotification.deleteMany({ where: { id: probeId } }).catch(() => null);
  await Promise.all([preview.$disconnect(), production.$disconnect()]);
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
