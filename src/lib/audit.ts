import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentCorrelationId, emitStructuredLog, safeErrorCode } from "@/lib/observability";
import { safeAuditMetadata } from "@/lib/transactional-audit";
import type { Prisma } from "@prisma/client";

export type AuditActor = {
  id: string;
  email: string;
  auditRequestId?: string;
};

export class AuditPersistenceError extends Error {
  readonly code = "AUDIT_PERSISTENCE_FAILED";
  readonly outcome = "verify_before_retry";
  constructor() {
    super("Jurnalul operatiunii nu a putut fi completat. Verifica rezultatul si identificatorul cererii inainte de a reincerca.");
    this.name = "AuditPersistenceError";
  }
}

export async function recordAudit(input: {
  actor?: AuditActor | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  request?: NextRequest;
}) {
  try {
    const correlationId = input.actor?.auditRequestId || currentCorrelationId();
    await prisma.auditLog.create({
      data: {
        userId: input.actor?.id || null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId || null,
        metadata: input.metadata || correlationId
          ? safeAuditMetadata({ ...(input.metadata || {}), ...(correlationId ? { correlationId } : {}) }) as Prisma.InputJsonValue
          : undefined,
        ipAddress: requestIp(input.request),
        userAgent: input.request?.headers.get("user-agent")?.slice(0, 1000) || null
      }
    });
  } catch (error) {
    reportAuditWriteFailure(input, error);
    // Critical commands also audit inside their business transaction. For any
    // legacy caller, make an incomplete post-write outcome explicit rather than
    // claiming success and silently dropping the event. Stable command keys must
    // be consulted before replaying a write with an unknown outcome.
    throw new AuditPersistenceError();
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
