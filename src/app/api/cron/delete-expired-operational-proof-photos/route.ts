import { NextRequest, NextResponse } from "next/server";
import { OPERATIONAL_PROOF_DOCUMENT_TYPE } from "@/lib/operational-proof";
import { prisma } from "@/lib/prisma";
import { emitStructuredLog, observeRoute, safeErrorCode } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  return observeRoute(request, {
    route: "/api/cron/delete-expired-operational-proof-photos",
    operation: "cron.proof_cleanup"
  }, async () => {
    const startedAt = performance.now();
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      emitStructuredLog("error", "cron_failed", { status: 503, errorCode: "CRON_SECRET_MISSING" });
      return NextResponse.json({ error: "Configuratia jobului nu este disponibila." }, { status: 503 });
    }
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      emitStructuredLog("warn", "cron_auth_failed", { status: 401, errorCode: "CRON_UNAUTHORIZED" });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const expired = await prisma.clientDocument.findMany({
    where: {
      documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE,
      status: "active",
      expiryDate: { lt: now }
    },
    select: { id: true, notes: true },
    take: 100
  });

    let deleted = 0;
    let failed = 0;

    for (const document of expired) {
      try {
        await prisma.clientDocument.update({
        where: { id: document.id },
        data: {
          status: "deleted",
          storageUrl: `deleted:${document.id}`,
          notes: appendSystemDeletionNote(document.notes)
        }
      });
        deleted += 1;
      } catch (error) {
        failed += 1;
        emitStructuredLog("error", "proof_storage_delete_failed", {
          entityType: "client_document",
          entityId: document.id,
          errorCode: safeErrorCode(error, "PROOF_DELETE_FAILED")
        });
      }
    }

    emitStructuredLog(failed ? "warn" : "info", "cron_completed", {
      durationMs: Math.round(performance.now() - startedAt),
      status: failed ? "partial" : "success",
      errorCode: failed ? "PROOF_CLEANUP_PARTIAL_FAILURE" : undefined,
      metrics: { scannedCount: expired.length, deletedCount: deleted, failedCount: failed }
    });
    return NextResponse.json({ scanned: expired.length, deleted, failed });
  });
}

function appendSystemDeletionNote(value: string | null) {
  const suffix = JSON.stringify({ deletedAt: new Date().toISOString(), deletedBySystem: true });
  return value ? `${value}\n${suffix}` : suffix;
}
