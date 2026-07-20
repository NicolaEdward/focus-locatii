import { PrismaClient } from "@prisma/client";
import { loadEnvFile } from "./release/env-utils";

loadEnvFile();

async function main() {
  const { getOwnershipIntegrityReport, ownershipBatchId } = await import("../src/lib/ownership-integrity");
  const report = await getOwnershipIntegrityReport();
  const safeItems = report.items.filter((item) => item.classification === "SAFE_AUTOFILL");
  const output = {
    ...report,
    proposedSafeBatchId: ownershipBatchId(safeItems),
    safeItemIds: safeItems.map((item) => item.id)
  };
  if (process.argv.includes("--summary")) {
    const examples = Object.fromEntries(Object.keys(report.causes).map((cause) => [
      cause,
      report.items.filter((item) => item.reasonCode === cause).slice(0, 3).map((item) => ({
        id: item.id,
        classification: item.classification,
        evidence: item.evidence.map((entry) => `${entry.source}:${entry.candidateId}`)
      }))
    ]));
    console.log(JSON.stringify({
      generatedAt: report.generatedAt,
      counts: report.counts,
      breakdown: report.breakdown,
      classifications: report.classifications,
      causes: report.causes,
      financeLegacy: report.financeLegacy,
      operationalAssignment: report.operationalAssignment,
      proposedSafeBatchId: output.proposedSafeBatchId,
      examples
    }, null, 2));
    return;
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  // The shared Prisma singleton may still be connected after the dynamic import.
  await new PrismaClient().$disconnect().catch(() => undefined);
});
