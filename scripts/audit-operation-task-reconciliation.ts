import { loadEnvFile } from "./release/env-utils";

loadEnvFile(process.env.ENV_FILE || ".env");

async function main() {
  const [{ auditOperationTaskReconciliation }, { prisma }] = await Promise.all([
    import("../src/lib/dashboard/executive/operation-task-reconciliation"),
    import("../src/lib/prisma")
  ]);
  try {
    const report = await auditOperationTaskReconciliation({
      snapshotDate: process.env.RECONCILIATION_SNAPSHOT
    });
    console.log(JSON.stringify({
      generatedAt: report.meta.asOf,
      readOnly: report.meta.readOnly,
      writesExecuted: report.meta.writesExecuted,
      contractVersion: report.meta.contractVersion,
      summary: report.summary,
      batches: report.batches,
      samples: report.items.slice(0, 20).map((item) => ({
        id: item.id,
        category: item.category,
        batch: item.batch,
        reasonCode: item.reasonCode,
        taskId: item.taskId,
        reservationId: item.reservationId,
        confidence: item.confidence
      }))
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
