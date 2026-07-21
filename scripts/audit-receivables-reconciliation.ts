import "dotenv/config";
import { listReceivableReconciliation } from "../src/lib/receivables-workspace-service";
import { prisma } from "../src/lib/prisma";

async function main() {
  const report = await listReceivableReconciliation({ take: 10 });
  console.log(JSON.stringify({
    generatedAt: report.generatedAt,
    tolerance: report.tolerance,
    readOnly: report.readOnly,
    counts: report.counts,
    sampledInternalIds: report.items.slice(0, 5).map((item) => ({ id: item.id, category: item.category }))
  }, null, 2));
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
