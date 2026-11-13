import type { Prisma } from "@prisma/client";
import { currentCorrelationId } from "@/lib/observability";

export type TransactionalAuditActor = { id: string; email?: string; role?: string; auditRequestId?: string };
export type TransactionalAuditInput = {
  actor?: TransactionalAuditActor | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  correlationId?: string | null;
};

const secretKey = /password|passwd|secret|authorization|cookie|recovery.?code|access.?token|refresh.?token|api.?key|totp|mfa.?key/i;

/** Audit metadata is bounded and cannot contain authentication material. */
export function safeAuditMetadata(value: unknown, depth = 0): Prisma.InputJsonValue | null {
  if (depth > 6) return "[depth-limit]";
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, 4000);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => safeAuditMetadata(v, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, v]) => [
      key, secretKey.test(key) ? "[redacted]" : safeAuditMetadata(v, depth + 1)
    ]));
  }
  return String(value).slice(0, 4000);
}

/**
 * Must be awaited inside the same Prisma transaction as the business write.
 * A failure is intentionally propagated: neither the write nor its audit event
 * may commit alone. Never pass the global Prisma client for a business mutation.
 */
export async function recordTransactionalAudit(
  tx: Pick<Prisma.TransactionClient, "auditLog">,
  input: TransactionalAuditInput
) {
  const correlationId = input.correlationId || input.actor?.auditRequestId || currentCorrelationId();
  const metadata = safeAuditMetadata({
    ...(input.metadata || {}),
    ...(input.actor?.role ? { actorRole: input.actor.role } : {}),
    ...(correlationId ? { correlationId } : {}),
    durability: "business-transaction"
  });
  return tx.auditLog.create({
    data: {
      userId: input.actor?.id || null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId || null,
      metadata: metadata as Prisma.InputJsonValue
    }
  });
}
