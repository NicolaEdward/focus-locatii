import { loadEnvFile } from "./release/env-utils";
import { writeFileSync } from "node:fs";

loadEnvFile(process.env.ENV_FILE || ".env");

async function main() {
  const [{ auditOperationTaskReconciliation, reconciliationFilters }, { prisma }] = await Promise.all([
    import("../src/lib/dashboard/executive/operation-task-reconciliation"),
    import("../src/lib/prisma")
  ]);
  try {
    const report = await auditOperationTaskReconciliation({
      snapshotDate: process.env.RECONCILIATION_SNAPSHOT,
      filters: {
        ...reconciliationFilters({}),
        limit: 10_000
      }
    });
    const output = {
      generatedAt: report.meta.asOf,
      readOnly: report.meta.readOnly,
      writesExecuted: report.meta.writesExecuted,
      contractVersion: report.meta.contractVersion,
      summary: report.summary,
      batches: report.batches,
      cutoverReview: report.review,
      samples: report.items.slice(0, 20).map((item) => ({
        id: item.id,
        category: item.category,
        batch: item.batch,
        reasonCode: item.reasonCode,
        taskId: item.taskId,
        reservationId: item.reservationId,
        confidence: item.confidence
      }))
    };
    if (process.env.OUTPUT_PATH) {
      writeFileSync(process.env.OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
    }
    console.log(JSON.stringify({
      generatedAt: output.generatedAt,
      readOnly: output.readOnly,
      writesExecuted: output.writesExecuted,
      summary: output.summary,
      cutoverSummary: output.cutoverReview.summary,
      assignmentCompleteness: output.cutoverReview.assignmentCompleteness,
      mediaMatrixRows: output.cutoverReview.mediaMatrix.length,
      outputPath: process.env.OUTPUT_PATH || null
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
