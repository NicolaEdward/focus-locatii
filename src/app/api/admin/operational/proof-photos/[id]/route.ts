import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import {
  OPERATIONAL_PROOF_DOCUMENT_TYPE,
  canViewOperationalProofPhoto,
  isOperationalProofActive,
  parseOperationalProofNotes
} from "@/lib/operational-proof";
import { fieldCanAccessOperationalProof } from "@/lib/operational-assignment";
import { prisma } from "@/lib/prisma";
import { emitStructuredLog, requestCorrelationId, safeErrorCode } from "@/lib/observability";

type Context = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, [
    "dashboard.operations.view",
    "campaigns.operate",
    "campaigns.view",
    "campaigns.view.own",
    "reservations.view",
    "reservations.view.own"
  ]);
  if (response || !session) return response;

  const { id } = await context.params;
  const document = await prisma.clientDocument.findUnique({
    where: { id },
    include: {
      reservation: {
        select: {
          id: true,
          status: true,
          ownerId: true,
          sellerUserId: true,
          salesperson: true,
          client: { select: { accountOwnerUserId: true } }
        }
      }
    }
  });

  if (!document || document.documentType !== OPERATIONAL_PROOF_DOCUMENT_TYPE || !document.reservation || !isOperationalProofActive(document)) {
    return NextResponse.json({ error: "Poza dovada nu exista." }, { status: 404, headers: noStoreHeaders });
  }
  const proofNotes = parseOperationalProofNotes(document.notes);
  const canView = session.role === "FIELD_OPERATOR"
    ? Boolean(proofNotes && await fieldCanAccessOperationalProof({
        session,
        reservationId: document.reservation.id,
        kind: proofNotes.kind,
        legacyTaskId: proofNotes.taskId
      }))
    : canViewOperationalProofPhoto(session, document.reservation);
  if (!canView) {
    return NextResponse.json({ error: "Nu ai acces la aceasta poza dovada." }, { status: 403, headers: noStoreHeaders });
  }

  if (document.storageUrl.startsWith("data:")) {
    const match = document.storageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return NextResponse.json({ error: "Fisier invalid." }, { status: 400, headers: noStoreHeaders });
    const body = Buffer.from(match[2], "base64");
    const disposition = request.nextUrl.searchParams.get("preview") === "1" ? "inline" : "attachment";
    return new NextResponse(body, {
      headers: {
        ...noStoreHeaders,
        "content-type": document.fileType || match[1],
        "content-disposition": `${disposition}; filename="${sanitizeFileName(document.fileName)}"`
      }
    });
  }

  return NextResponse.redirect(document.storageUrl);
}

export async function DELETE(request: NextRequest, context: Context) {
  const startedAt = performance.now();
  const correlationId = requestCorrelationId(request);
  const { session, response } = await requireAnyPermission(request, ["dashboard.operations.view", "campaigns.operate"]);
  if (response || !session) return response;
  if (!["SUPER_ADMIN", "COO"].includes(session.role)) {
    return NextResponse.json({ error: "Doar COO sau administratorul pot sterge manual poze dovada." }, { status: 403, headers: noStoreHeaders });
  }

  const { id } = await context.params;
  const existing = await prisma.clientDocument.findUnique({ where: { id } });
  if (!existing || existing.documentType !== OPERATIONAL_PROOF_DOCUMENT_TYPE || existing.status !== "active") {
    return NextResponse.json({ error: "Poza dovada nu exista." }, { status: 404, headers: noStoreHeaders });
  }

  try {
    await prisma.clientDocument.update({
      where: { id },
      data: {
        status: "deleted",
        storageUrl: `deleted:${id}`,
        notes: appendDeletionNote(existing.notes, "manual")
      }
    });
  } catch (error) {
    emitStructuredLog("error", "proof_storage_delete_failed", {
      correlationId,
      operation: "operational.proof_delete",
      entityType: "client_document",
      entityId: id,
      role: session.role,
      durationMs: Math.round(performance.now() - startedAt),
      errorCode: safeErrorCode(error, "PROOF_DELETE_FAILED")
    });
    throw error;
  }
  await recordAudit({
    actor: session,
    action: "operation.proof_photo.delete",
    entityType: "client_document",
    entityId: id,
    metadata: { reservationId: existing.reservationId },
    request
  });

  emitStructuredLog("info", "proof_storage_delete_completed", {
    correlationId,
    operation: "operational.proof_delete",
    entityType: "client_document",
    entityId: id,
    role: session.role,
    durationMs: Math.round(performance.now() - startedAt),
    status: 200,
    metrics: { deletedCount: 1 }
  });

  return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
}

function sanitizeFileName(value: string) {
  return value.replace(/[^\w.\- ]+/g, "_");
}

function appendDeletionNote(value: string | null, mode: "manual" | "system") {
  const suffix = JSON.stringify({ deletedAt: new Date().toISOString(), deletedBySystem: mode === "system" });
  return value ? `${value}\n${suffix}` : suffix;
}
