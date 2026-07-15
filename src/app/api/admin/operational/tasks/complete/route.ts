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
  validateOperationalProofFile
} from "@/lib/operational-proof";
import { prisma } from "@/lib/prisma";
import { updateReservationProductionNotesWithClient } from "@/lib/reservations";
import { createOperationalNotifications } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const allowedKinds = new Set(["decoration", "neutralization"]);

export async function POST(request: NextRequest) {
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
    const completionNote = textValue(form.get("completionNote"));
    const files = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);

    if (!reservationId) {
      return NextResponse.json({ error: "Alege lucrarea operationala." }, { status: 400, headers: noStoreHeaders });
    }
    if (!kind || !allowedKinds.has(kind)) {
      return NextResponse.json({ error: "Tip operational invalid." }, { status: 400, headers: noStoreHeaders });
    }
    if (files.length > OPERATIONAL_PROOF_MAX_FILES_PER_TASK) {
      return NextResponse.json({ error: `Poti incarca maximum ${OPERATIONAL_PROOF_MAX_FILES_PER_TASK} poze.` }, { status: 400, headers: noStoreHeaders });
    }
    for (const file of files) validateOperationalProofFile(file);

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
    if (!canCompleteOperationalReservation(session, existing)) {
      return NextResponse.json({ error: "Nu ai acces sa finalizezi aceasta lucrare." }, { status: 403, headers: noStoreHeaders });
    }

    const activeProofCount = await prisma.clientDocument.count({
      where: {
        reservationId,
        documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE,
        status: "active"
      }
    });
    if (activeProofCount + files.length > OPERATIONAL_PROOF_MAX_FILES_PER_TASK) {
      return NextResponse.json(
        { error: `Lucrarea poate avea maximum ${OPERATIONAL_PROOF_MAX_FILES_PER_TASK} poze dovada active.` },
        { status: 400, headers: noStoreHeaders }
      );
    }
    if (session.role === "FIELD_OPERATOR" && activeProofCount + files.length < 1) {
      return NextResponse.json(
        { error: "Incarca cel putin o poza dovada pentru finalizare." },
        { status: 400, headers: noStoreHeaders }
      );
    }

    const currentStatus = taskId
      ? operationExtraTasks(existing.productionNotes, kind as OperationKind).find((task) => task.id === taskId)?.status || "NEW"
      : operationStatus(existing.productionNotes, kind as OperationKind);
    if (currentStatus === "DONE" && files.length === 0) {
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
      storageUrl: await fileToDataUrl(file)
    })));

    const reservation = await prisma.$transaction(async (tx) => {
      for (const { file, storageUrl } of preparedFiles) {
        await tx.clientDocument.create({
          data: {
            reservationId,
            fileName: safeOperationalProofFileName(file.name),
            fileType: file.type,
            fileSize: file.size,
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
            storageUrl,
            status: "active"
          }
        });
      }

      return updateReservationProductionNotesWithClient(tx, reservationId, nextProductionNotes, session);
    });

    await recordAudit({
      actor: session,
      action: `operation.${kind}.complete_with_proof`,
      entityType: "reservation",
      entityId: reservationId,
      metadata: { taskId, proofPhotoCount: files.length, expiresAt: expiresAt.toISOString() },
      request
    });

    try {
      await createOperationalNotifications({
        recipientUserIds: [existing.ownerId, existing.sellerUserId, existing.client?.accountOwnerUserId],
        actorUserId: session.id,
        type: `operation_${kind}_completed`,
        title: kind === "decoration" ? "Decorare finalizata" : "Neutralizare finalizata",
        message: `${existing.location?.code || "Locatia"} / ${existing.campaign?.campaignName || existing.client?.companyName || "campanie"} a fost marcata ca finalizata de ${session.name}.`,
        entityId: `${reservationId}:${kind}:${taskId || "base"}`,
        metadata: { reservationId, kind, taskId, proofPhotoCount: files.length }
      });
    } catch {
      console.error("Operational completion notification failed", { reservationId, kind });
    }

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

async function fileToDataUrl(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const type = file.type || "application/octet-stream";
  return `data:${type};base64,${buffer.toString("base64")}`;
}
