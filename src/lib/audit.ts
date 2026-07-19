import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentCorrelationId, emitStructuredLog, safeErrorCode } from "@/lib/observability";

export type AuditActor = {
  id: string;
  email: string;
};

export async function recordAudit(input: {
  actor?: AuditActor | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  request?: NextRequest;
}) {
  try {
    const correlationId = currentCorrelationId();
    await prisma.auditLog.create({
      data: {
        userId: input.actor?.id || null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId || null,
        metadata: input.metadata || correlationId
          ? JSON.parse(JSON.stringify({ ...(input.metadata || {}), ...(correlationId ? { correlationId } : {}) }))
          : undefined,
        ipAddress: requestIp(input.request),
        userAgent: input.request?.headers.get("user-agent")?.slice(0, 1000) || null
      }
    });
  } catch (error) {
    reportAuditWriteFailure(input, error);
  }
}

export function reportAuditWriteFailure(
  input: Pick<Parameters<typeof recordAudit>[0], "action" | "entityType" | "entityId">,
  error: unknown
) {
  emitStructuredLog("error", "audit_write_failed", {
    operation: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    errorCode: safeErrorCode(error, "AUDIT_WRITE_FAILED")
  });
}

function requestIp(request?: NextRequest) {
  if (!request) return null;
  return (
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}
