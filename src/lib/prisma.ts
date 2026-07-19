import { PrismaClient } from "@prisma/client";
import { emitStructuredLog, prismaSlowQueryThresholdMs, recordPrismaQuery } from "@/lib/observability";

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { emit: "event", level: "query" },
      { emit: "event", level: "error" },
      { emit: "event", level: "warn" }
    ]
  });
  client.$on("query", (event) => {
    const thresholdMs = prismaSlowQueryThresholdMs();
    if (event.duration < thresholdMs) return;
    emitStructuredLog("warn", "prisma_slow_query", {
      operation: prismaOperation(event.query),
      durationMs: event.duration,
      errorCode: "PRISMA_SLOW_QUERY",
      metrics: { thresholdMs }
    });
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
        async $allOperations({ args, query }) {
          const startedAt = Date.now();
          try {
            return await query(args);
          } finally {
            recordPrismaQuery(Date.now() - startedAt);
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

function prismaOperation(query: string) {
  const operation = query.trim().split(/\s+/, 1)[0]?.toUpperCase() || "OTHER";
  return ["SELECT", "INSERT", "UPDATE", "DELETE", "BEGIN", "COMMIT", "ROLLBACK"].includes(operation)
    ? `prisma.${operation.toLowerCase()}`
    : "prisma.other";
}
