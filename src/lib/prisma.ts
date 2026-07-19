import { PrismaClient } from "@prisma/client";
import { emitStructuredLog, prismaSlowQueryThresholdMs, recordPrismaQuery } from "@/lib/observability";

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { emit: "event", level: "error" },
      { emit: "event", level: "warn" }
    ]
  });
  client.$on("error", () => {
    emitStructuredLog("error", "prisma_error", { errorCode: "PRISMA_QUERY_ERROR" });
  });
  client.$on("warn", () => {
    emitStructuredLog("warn", "prisma_warning", { errorCode: "PRISMA_WARNING" });
  });
  const observableClient = client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const startedAt = Date.now();
          try {
            return await query(args);
          } finally {
            const durationMs = Date.now() - startedAt;
            const thresholdMs = prismaSlowQueryThresholdMs();
            recordPrismaQuery(durationMs);
            if (durationMs >= thresholdMs) {
              emitStructuredLog("warn", "prisma_slow_query", {
                operation: `prisma.${operation}`,
                durationMs,
                entityType: model,
                errorCode: "PRISMA_SLOW_QUERY",
                metrics: { thresholdMs }
              });
            }
          }
        }
      }
    }
  });
  return observableClient as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
