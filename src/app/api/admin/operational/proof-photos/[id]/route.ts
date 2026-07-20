import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import {
  OPERATIONAL_PROOF_DOCUMENT_TYPE,
  canViewOperationalProofPhoto,
  isOperationalProofMimeType,
  isOperationalProofActive,
  parseOperationalProofNotes,
} from "@/lib/operational-proof";
import { decodeAndValidateOperationalProofBuffer } from "@/lib/operational-proof-image-server";
import { fieldCanAccessOperationalProof } from "@/lib/operational-assignment";
import {
  OPERATIONAL_PROOF_STORAGE_PROVIDER,
  deleteOperationalProofObject,
  readOperationalProofObject
} from "@/lib/operational-proof-storage";
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

  const disposition = request.nextUrl.searchParams.get("preview") === "1" ? "inline" : "attachment";
  if (document.storageProvider === OPERATIONAL_PROOF_STORAGE_PROVIDER && document.storageKey) {
    try {
      const object = await readOperationalProofObject(document.storageKey);
      if (!object) return NextResponse.json({ error: "Poza dovada nu exista." }, { status: 404, headers: noStoreHeaders });
      if (!document.fileType || !isOperationalProofMimeType(document.fileType) || object.contentType !== document.fileType) {
        return NextResponse.json({ error: "Tipul pozei dovada nu este valid." }, { status: 409, headers: noStoreHeaders });
      }
      emitStructuredLog("info", "proof_storage_view_completed", {
        correlationId: requestCorrelationId(request),
        operation: "operational.proof_view",
        entityType: "client_document",
        entityId: document.id,
        role: session.role,
        status: 200,
        metrics: { fileBytes: object.bytes }
      });
      return new NextResponse(object.stream, {
        headers: proofResponseHeaders({
          contentType: document.fileType || object.contentType,
          fileName: document.fileName,
          disposition,
          contentLength: object.bytes
        })
      });
    } catch (error) {
      emitStructuredLog("error", "proof_storage_view_failed", {
        correlationId: requestCorrelationId(request),
        operation: "operational.proof_view",
        entityType: "client_document",
        entityId: document.id,
        role: session.role,
        status: 502,
        errorCode: safeErrorCode(error, "PROOF_STORAGE_READ_FAILED")
      });
      return NextResponse.json({ error: "Poza dovada nu poate fi citita momentan." }, { status: 502, headers: noStoreHeaders });
    }
  }

  if (document.storageUrl?.startsWith("data:")) {
    const match = document.storageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return NextResponse.json({ error: "Fisier invalid." }, { status: 400, headers: noStoreHeaders });
    const body = Buffer.from(match[2], "base64");
    try {
      await decodeAndValidateOperationalProofBuffer(body, document.fileType || match[1]);
    } catch {
      return NextResponse.json({ error: "Fisier invalid." }, { status: 400, headers: noStoreHeaders });
    }
    return new NextResponse(body, {
      headers: proofResponseHeaders({
        contentType: document.fileType || match[1],
        fileName: document.fileName,
        disposition,
        contentLength: body.byteLength
      })
    });
  }

  return NextResponse.json({ error: "Formatul de stocare al pozei nu este acceptat." }, { status: 409, headers: noStoreHeaders });
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
  if (!existing || existing.documentType !== OPERATIONAL_PROOF_DOCUMENT_TYPE || !["active", "deleting"].includes(existing.status)) {
    return NextResponse.json({ error: "Poza dovada nu exista." }, { status: 404, headers: noStoreHeaders });
  }

  try {
    if (existing.status === "active") {
      const locked = await prisma.clientDocument.updateMany({
        where: { id, status: "active" },
        data: { status: "deleting" }
      });
      if (locked.count !== 1) {
        return NextResponse.json({ error: "Poza este deja in curs de stergere." }, { status: 409, headers: noStoreHeaders });
      }
    }
    if (existing.storageProvider === OPERATIONAL_PROOF_STORAGE_PROVIDER && existing.storageKey) {
      try {
        await deleteOperationalProofObject(existing.storageKey, existing.storageEtag);
      } catch (error) {
        await prisma.clientDocument.updateMany({ where: { id, status: "deleting" }, data: { status: "active" } });
        throw error;
      }
    }
    await prisma.clientDocument.updateMany({
      where: { id, status: "deleting" },
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

function proofResponseHeaders(input: {
  contentType: string;
  fileName: string;
  disposition: "inline" | "attachment";
  contentLength: number;
}) {
  return {
    ...noStoreHeaders,
    "content-type": input.contentType,
    "content-length": String(input.contentLength),
    "content-disposition": `${input.disposition}; filename="${sanitizeFileName(input.fileName)}"`,
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
    "content-security-policy": "default-src 'none'; sandbox"
  };
}

function appendDeletionNote(value: string | null, mode: "manual" | "system") {
  const suffix = JSON.stringify({ deletedAt: new Date().toISOString(), deletedBySystem: mode === "system" });
  return value ? `${value}\n${suffix}` : suffix;
}
