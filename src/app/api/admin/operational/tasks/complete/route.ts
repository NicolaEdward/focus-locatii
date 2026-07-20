import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import {
  operationExtraTasks,
  operationStatus,
  withOperationCompletion,
  withOperationTaskCompletion,
  type OperationKind
} from "@/lib/operation-status";
import {
  OPERATIONAL_PROOF_DOCUMENT_TYPE,
  OPERATIONAL_PROOF_MAX_FILES_PER_TASK,
  canCompleteOperationalReservation,
  operationalProofDownloadPath,
  operationalProofExpiryDate,
  operationalProofNotes,
  safeOperationalProofFileName,
  validateOperationalProofFile,
  validateOperationalProofUploadTotal
} from "@/lib/operational-proof";
import { readAndValidateOperationalProofFile } from "@/lib/operational-proof-image-server";
import {
  deleteOperationalProofObject,
  uploadOperationalProofObject,
  type StoredOperationalProof
} from "@/lib/operational-proof-storage";
import { prisma } from "@/lib/prisma";
import { updateReservationProductionNotesWithClient } from "@/lib/reservations";
import { createOperationalNotifications } from "@/lib/notifications";
import { emitStructuredLog, requestCorrelationId, safeErrorCode } from "@/lib/observability";
import {
  findOperationalTaskForWork,
  getOperationalTaskForAccess,
  operationalAssignmentEnabled
} from "@/lib/operational-assignment";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const allowedKinds = new Set(["decoration", "neutralization"]);

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  const correlationId = requestCorrelationId(request);
  const { session, response } = await requireAnyPermission(request, [
    "dashboard.operations.view",
    "campaigns.operate",
    "reservations.view.own"
  ]);
  if (response || !session) return response;

  try {
    const form = await request.formData();
    const reservationId = textValue(form.get("reservationId"));
    const kind = textValue(form.get("kind"));
    const taskId = textValue(form.get("taskId"));
    const operationTaskId = textValue(form.get("operationTaskId"));
    const completionNote = textValue(form.get("completionNote"));
    const files = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);

    if (!reservationId) {
      return NextResponse.json({ error: "Alege lucrarea operationala." }, { status: 400, headers: noStoreHeaders });
    }
    if (!kind || !allowedKinds.has(kind)) {
      return NextResponse.json({ error: "Tip operational invalid." }, { status: 400, headers: noStoreHeaders });
    }
    if (session.role === "FIELD_OPERATOR" && (!operationalAssignmentEnabled() || !operationTaskId)) {
      return NextResponse.json(
        { error: "Finalizarea de teren necesita un task atribuit in pilotul operational." },
        { status: 403, headers: noStoreHeaders }
      );
    }
    if (files.length > OPERATIONAL_PROOF_MAX_FILES_PER_TASK) {
      return NextResponse.json({ error: `Poti incarca maximum ${OPERATIONAL_PROOF_MAX_FILES_PER_TASK} poze.` }, { status: 400, headers: noStoreHeaders });
    }
    for (const file of files) validateOperationalProofFile(file);
    validateOperationalProofUploadTotal(files);

    const existing = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        status: true,
        productionNotes: true,
        ownerId: true,
        sellerUserId: true,
        salesperson: true,
        client: { select: { accountOwnerUserId: true, companyName: true } },
        campaign: { select: { campaignName: true } },
        location: { select: { code: true } }
      }
    });

    if (!existing) {
      return NextResponse.json({ error: "Lucrarea nu exista." }, { status: 404, headers: noStoreHeaders });
    }
    const relationalTask = operationTaskId
      ? await getOperationalTaskForAccess(operationTaskId, session)
      : await findOperationalTaskForWork({ reservationId, kind: kind as OperationKind, legacyTaskId: taskId });
    const fieldHasAssignment = session.role === "FIELD_OPERATOR"
      && existing.status === "BOOKED"
      && relationalTask?.assignedToUserId === session.id;
    if (session.role === "FIELD_OPERATOR" ? !fieldHasAssignment : !canCompleteOperationalReservation(session, existing)) {
      return NextResponse.json({ error: "Nu ai acces sa finalizezi aceasta lucrare." }, { status: 403, headers: noStoreHeaders });
    }
    const relationalKindMatches = !relationalTask || (kind === "neutralization"
      ? relationalTask.kind === "NEUTRALIZATION"
      : relationalTask.kind === "DECORATION" || relationalTask.kind === "REDECORATION");
    if (relationalTask && (relationalTask.reservationId !== reservationId || relationalTask.legacyTaskId !== taskId || !relationalKindMatches)) {
      return NextResponse.json({ error: "Taskul nu corespunde lucrarii selectate." }, { status: 403, headers: noStoreHeaders });
    }

    const activeProofCount = await prisma.clientDocument.count({
      where: {
        reservationId,
        documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE,
        status: "active",
        OR: [{ expiryDate: null }, { expiryDate: { gte: new Date() } }]
      }
    });
    if (activeProofCount + files.length > OPERATIONAL_PROOF_MAX_FILES_PER_TASK) {
      return NextResponse.json(
        { error: `Lucrarea poate avea maximum ${OPERATIONAL_PROOF_MAX_FILES_PER_TASK} poze dovada active.` },
        { status: 400, headers: noStoreHeaders }
      );
    }
    if (session.role === "FIELD_OPERATOR" && files.length < 1) {
      return NextResponse.json(
        { error: "Incarca cel putin o poza dovada pentru finalizare." },
        { status: 400, headers: noStoreHeaders }
      );
    }

    const currentStatus = relationalTask?.status || (taskId
      ? operationExtraTasks(existing.productionNotes, kind as OperationKind).find((task) => task.id === taskId)?.status || "NEW"
      : operationStatus(existing.productionNotes, kind as OperationKind));
    if (currentStatus === "DONE") {
      const reservation = await updateReservationProductionNotesWithClient(prisma, reservationId, existing.productionNotes || "", session);
      return NextResponse.json(
        {
          reservation,
          proofPhotoCount: activeProofCount,
          alreadyCompleted: true,
          proofPhotos: reservation.operationProofPhotos?.map((photo) => ({
            id: photo.id,
            fileName: photo.fileName,
            downloadUrl: operationalProofDownloadPath(photo.id)
          })) || []
        },
        { headers: noStoreHeaders }
      );
    }

    const nextProductionNotes = taskId
      ? withOperationTaskCompletion(existing.productionNotes, taskId, { completedByUserId: session.id, completionNote })
      : withOperationCompletion(existing.productionNotes, kind as OperationKind, { completedByUserId: session.id, completionNote });
    const uploadedAt = new Date();
    const expiresAt = operationalProofExpiryDate(uploadedAt);
    const preparedFiles = await Promise.all(files.map(async (file) => ({
      file,
      safeFileName: safeOperationalProofFileName(file.name),
      image: await readAndValidateOperationalProofFile(file)
    })));
    const storedFiles: Array<(typeof preparedFiles)[number] & { stored: StoredOperationalProof }> = [];
    try {
      for (const prepared of preparedFiles) {
        const stored = await uploadOperationalProofObject({
          reservationId,
          fileName: prepared.safeFileName,
          contentType: prepared.image.mimeType,
          bytes: prepared.image.bytes
        });
        storedFiles.push({ ...prepared, stored });
      }
    } catch (error) {
      await cleanupUploadedProofs(storedFiles.map((item) => item.stored));
      throw error;
    }

    let reservation;
    try {
      reservation = await prisma.$transaction(async (tx) => {
        for (const { safeFileName, image, stored } of storedFiles) {
          await tx.clientDocument.create({
            data: {
              reservationId,
              fileName: safeFileName,
              fileType: image.mimeType,
              fileSize: stored.bytes,
              documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE,
              uploadedByUserId: session.id,
              uploadedAt,
              expiryDate: expiresAt,
              notes: operationalProofNotes({
                kind: kind as OperationKind,
                taskId,
                completionNote,
                uploadedByUserId: session.id
              }),
              storageUrl: null,
              storageProvider: stored.provider,
              storageKey: stored.key,
              storageChecksum: stored.checksum,
              storageEtag: stored.etag,
              storageMigratedAt: uploadedAt,
              storageVerifiedAt: uploadedAt,
              status: "active"
            }
          });
        }

        if (relationalTask) {
          await tx.operationTask.update({
            where: { id: relationalTask.id },
            data: {
              status: "DONE",
              completedAt: uploadedAt,
              ...(completionNote ? { notes: completionNote } : {})
            }
          });
        }

        return updateReservationProductionNotesWithClient(tx, reservationId, nextProductionNotes, session);
      });
    } catch (error) {
      await cleanupUploadedProofs(storedFiles.map((item) => item.stored));
      throw error;
    }

    await recordAudit({
      actor: session,
      action: `operation.${kind}.complete_with_proof`,
      entityType: "reservation",
      entityId: reservationId,
      metadata: { taskId, operationTaskId: relationalTask?.id || null, proofPhotoCount: files.length, expiresAt: expiresAt.toISOString() },
      request
    });

    try {
      await createOperationalNotifications({
        recipientUserIds: [existing.ownerId, existing.sellerUserId, existing.client?.accountOwnerUserId, relationalTask?.assignedToUserId],
        actorUserId: session.id,
        type: `operation_${kind}_completed`,
        title: kind === "decoration" ? "Decorare finalizata" : "Neutralizare finalizata",
        message: `${existing.location?.code || "Locatia"} / ${existing.campaign?.campaignName || existing.client?.companyName || "campanie"} a fost marcata ca finalizata de ${session.name}.`,
        entityId: `${reservationId}:${kind}:${taskId || "base"}`,
        metadata: { reservationId, kind, taskId, proofPhotoCount: files.length }
      });
    } catch (error) {
      emitStructuredLog("error", "notification_sync_failed", {
        correlationId,
        operation: "operational.completion_notification",
        entityType: "reservation",
        entityId: reservationId,
        role: session.role,
        errorCode: safeErrorCode(error, "OPERATIONAL_NOTIFICATION_FAILED")
      });
    }

    emitStructuredLog("info", "proof_storage_upload_completed", {
      correlationId,
      operation: "operational.proof_upload",
      entityType: "reservation",
      entityId: reservationId,
      role: session.role,
      durationMs: Math.round(performance.now() - startedAt),
      status: 200,
      metrics: {
        fileCount: files.length,
        fileBytes: files.reduce((sum, file) => sum + file.size, 0)
      }
    });

    return NextResponse.json(
      {
        reservation,
        proofPhotoCount: files.length,
        expiresAt: expiresAt.toISOString(),
        proofPhotos: reservation.operationProofPhotos?.map((photo) => ({
          id: photo.id,
          fileName: photo.fileName,
          downloadUrl: operationalProofDownloadPath(photo.id)
        })) || []
      },
      { headers: noStoreHeaders }
    );
  } catch (error) {
    emitStructuredLog("error", "proof_storage_upload_failed", {
      correlationId,
      operation: "operational.proof_upload",
      durationMs: Math.round(performance.now() - startedAt),
      status: 400,
      errorCode: safeErrorCode(error, "PROOF_UPLOAD_FAILED")
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lucrarea nu a putut fi finalizata." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

function textValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

async function cleanupUploadedProofs(files: StoredOperationalProof[]) {
  if (!files.length) return;
  const results = await Promise.allSettled(files.map((file) => deleteOperationalProofObject(file.key, file.etag)));
  for (const result of results) {
    if (result.status === "rejected") {
      emitStructuredLog("error", "proof_storage_delete_failed", {
        operation: "operational.proof_upload_compensation",
        errorCode: safeErrorCode(result.reason, "PROOF_UPLOAD_COMPENSATION_FAILED")
      });
    }
  }
}
