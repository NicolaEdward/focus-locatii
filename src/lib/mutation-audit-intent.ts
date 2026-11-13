import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordTransactionalAudit } from "@/lib/transactional-audit";

const requestIds = new WeakMap<object, string>();

/** Durable request evidence is stored before an authorized mutation may run. */
export async function ensureMutationAuditIntent<T extends { id: string; email: string; role: string }>(
  request: NextRequest,
  session: T
): Promise<T & { auditRequestId?: string }> {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return session;
  const prior = requestIds.get(request);
  if (prior) return { ...session, auditRequestId: prior };
  const id = randomUUID();
  await prisma.$transaction(async (tx) => {
    await recordTransactionalAudit(tx, {
      actor: session,
      action: "mutation.request.accepted",
      entityType: "mutation_intent",
      entityId: id,
      correlationId: id,
      metadata: { method: request.method.toUpperCase(), route: request.nextUrl.pathname.slice(0, 240), state: "accepted" }
    });
  });
  requestIds.set(request, id);
  return { ...session, auditRequestId: id };
}
