import { performance } from "node:perf_hooks";
import { loadEnvFile } from "./release/env-utils";

loadEnvFile(process.env.ENV_FILE || ".env");

async function main() {
  const [{ auditOperationTaskReconciliation }, { prisma }] = await Promise.all([
    import("../src/lib/dashboard/executive/operation-task-reconciliation"),
    import("../src/lib/prisma")
  ]);
  const runs = Math.max(3, Math.min(10, Number(process.env.PERFORMANCE_RUNS || 5)));
  const durations: number[] = [];
  let payloadBytes = 0;
  try {
    for (let index = 0; index < runs; index += 1) {
      const started = performance.now();
      const report = await auditOperationTaskReconciliation({
        snapshotDate: process.env.RECONCILIATION_SNAPSHOT || "2026-07-24"
      });
      durations.push(performance.now() - started);
      payloadBytes = Buffer.byteLength(JSON.stringify(report));
      if (!report.meta.readOnly || report.meta.writesExecuted !== 0) {
        throw new Error("Benchmarkul a detectat un contract care nu este read-only.");
      }
    }
  } finally {
    await prisma.$disconnect();
  }
  const sorted = [...durations].sort((left, right) => left - right);
  console.log(JSON.stringify({
    ok: true,
    runs,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    minMs: Math.round(sorted[0]),
    maxMs: Math.round(sorted.at(-1) || 0),
    payloadBytes,
    queryBudget: 5,
    readOnly: true
  }, null, 2));
}

function percentile(values: number[], ratio: number) {
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1));
  return Math.round(values[index]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
