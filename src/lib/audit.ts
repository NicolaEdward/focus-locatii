import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

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
    await prisma.auditLog.create({
      data: {
        userId: input.actor?.id || null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId || null,
        metadata: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : undefined,
        ipAddress: requestIp(input.request),
        userAgent: input.request?.headers.get("user-agent")?.slice(0, 1000) || null
      }
    });
  } catch {
    // Audit must not break the business transaction; production monitoring should alert on DB failures.
  }
}

function requestIp(request?: NextRequest) {
  if (!request) return null;
  return (
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}
