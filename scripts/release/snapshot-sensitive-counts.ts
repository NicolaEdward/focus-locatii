import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { databaseIdentity, loadEnvFile } from "./env-utils";

loadEnvFile();
const prisma = new PrismaClient();

async function main() {
  const [reservationTotal, hold, reserved, booked, receivables, payments, notifications, proofTotal, proofActive, operationTasks] = await Promise.all([
    prisma.reservation.count(),
    prisma.reservation.count({ where: { status: "HOLD" } }),
    prisma.reservation.count({ where: { status: "RESERVED" } }),
    prisma.reservation.count({ where: { status: "BOOKED" } }),
    prisma.financialReceivable.count(),
    prisma.financialReceivablePayment.count(),
    prisma.appNotification.count(),
    prisma.clientDocument.count({ where: { documentType: "operational_proof_photo" } }),
    prisma.clientDocument.count({ where: { documentType: "operational_proof_photo", status: "active" } }),
    prisma.operationTask.count()
  ]);
  const identity = databaseIdentity();
  const snapshot = {
    version: 1,
    label: process.env.SNAPSHOT_LABEL || "snapshot",
    capturedAt: new Date().toISOString(),
    appEnv: process.env.APP_ENV || process.env.VERCEL_ENV || "local",
    databaseFingerprint: identity.fingerprint,
    counts: { reservationTotal, hold, reserved, booked, receivables, payments, notifications, proofTotal, proofActive, operationTasks }
  };
  const output = process.env.SNAPSHOT_OUT;
  if (output) {
    const filePath = path.resolve(process.cwd(), output);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(snapshot, null, 2));
}

main().finally(() => prisma.$disconnect()).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
