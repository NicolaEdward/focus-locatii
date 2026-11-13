import { prisma } from "../../src/lib/prisma";
import { getInventoryAvailabilitySummary } from "../../src/lib/inventory-availability-summary";
import { databaseIdentity, loadEnvFile } from "./env-utils";

loadEnvFile();
async function main() {
  const identity = databaseIdentity();
  const local = ["127.0.0.1", "localhost"].includes(new URL(process.env.DATABASE_URL!).hostname);
  if (!local && (process.env.ALLOW_PRODUCTION_AGGREGATE_INVENTORY !== "true" || process.env.INVENTORY_DATABASE_FINGERPRINT !== identity.fingerprint)) throw new Error("AGGREGATE_TARGET_NOT_APPROVED");
  const inventory = await getInventoryAvailabilitySummary();
  console.log(JSON.stringify({ event: "inventory_availability_snapshot", readOnly: true, databaseFingerprint: identity.fingerprint, ...inventory }));
}
main().finally(() => prisma.$disconnect()).catch(() => { console.error(JSON.stringify({ event: "inventory_availability_snapshot", ok: false, code: "INVENTORY_SNAPSHOT_UNAVAILABLE" })); process.exitCode = 1; });
