import { setTimeout } from "node:timers/promises";
import { emitStructuredLog } from "@/lib/observability";

export function isClosedDatabaseConnection(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P1017");
}

// Only pass reads outside interactive transactions. Never replay a mutation:
// a lost connection can leave its commit outcome unknown.
export async function retryClosedConnectionRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isClosedDatabaseConnection(error)) throw error;
    emitStructuredLog("warn", "database_read_retry", {
      errorCode: "P1017",
      metrics: { attemptCount: 2 }
    });
    await setTimeout(100);
    return read();
  }
}
