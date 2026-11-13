import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { operationExtraTasks, operationStatus, withOperationCompletion, withOperationTaskCompletion, type OperationKind } from "@/lib/operation-status";
import { OPERATIONAL_PROOF_DOCUMENT_TYPE, OPERATIONAL_PROOF_MAX_FILES_PER_TASK, canCompleteOperationalReservation, operationalProofDownloadPath, operationalProofExpiryDate, operationalProofNotes, parseOperationalProofNotes } from "@/lib/operational-proof";
import { prepareOperationalProofImage, readOperationalProofForm } from "@/lib/operational-proof-image";
import { OperationalProofUploadError } from "@/lib/operational-proof-upload-limits";
import { updateReservationProductionNotesWithClient } from "@/lib/reservations";
import { createOperationalNotifications } from "@/lib/notifications";
import { findOperationalTaskForWork, getOperationalTaskForAccess, operationalAssignmentEnabled } from "@/lib/operational-assignment";
import { operationalBusinessOwner } from "@/lib/operational-responsibility";
import { emitStructuredLog, requestCorrelationId, safeErrorCode } from "@/lib/observability";
import { recordTransactionalAudit } from "@/lib/transactional-audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" };
const allowedKinds = new Set(["decoration", "neutralization"]);

export async function POST(request: NextRequest) {
  const startedAt = performance.now(), correlationId = requestCorrelationId(request);
  const { session, response } = await requireAnyPermission(request, ["dashboard.operations.view", "campaigns.operate", "reservations.view.own"]);
  if (response || !session) return response;
  try {
    const form = await readOperationalProofForm(request);
    const reservationId = textValue(form.get("reservationId")), kind = textValue(form.get("kind"));
    const taskId = textValue(form.get("taskId")), operationTaskId = textValue(form.get("operationTaskId"));
    const completionNote = textValue(form.get("completionNote"));
    const files = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
    if (!reservationId) throw new OperationalProofUploadError("Alege lucrarea operațională.");
    if (!kind || !allowedKinds.has(kind)) throw new OperationalProofUploadError("Tip operațional invalid.");
    if (completionNote && completionNote.length > 4000) throw new OperationalProofUploadError("Nota poate avea maximum 4.000 de caractere.");
    if (session.role === "FIELD_OPERATOR" && (!operationalAssignmentEnabled() || !operationTaskId)) throw new OperationalProofUploadError("Finalizarea de teren necesită un task atribuit în pilotul operațional.", 403);
    if (files.length > OPERATIONAL_PROOF_MAX_FILES_PER_TASK) throw new OperationalProofUploadError("Poți încărca maximum 10 fotografii pentru o lucrare.");
    // Decode before taking business row locks. Actual bytes, pixel count and
    // metadata are checked independently of the browser's MIME declaration.
    const preparedFiles: Awaited<ReturnType<typeof prepareOperationalProofImage>>[] = [];
    for (const file of files) preparedFiles.push(await prepareOperationalProofImage(file));
    const uploadedAt = new Date(), expiresAt = operationalProofExpiryDate(uploadedAt);
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM portfolio_users WHERE id = ${session.id} FOR UPDATE`;
      const currentUser = await tx.user.findUnique({ where: { id: session.id }, select: { active: true, role: true, tokenVersion: true } });
      if (!currentUser?.active || currentUser.role !== session.role || currentUser.tokenVersion !== session.tokenVersion || session.exp * 1000 <= Date.now()) throw new OperationalProofUploadError("Accesul contului s-a schimbat. Autentifică-te din nou.", 403);
      if (session.sessionId) {
        await tx.$queryRaw`SELECT id FROM portfolio_auth_sessions WHERE id = ${session.sessionId} FOR UPDATE`;
        if (!await tx.authSessionRecord.findFirst({ where: { id: session.sessionId, userId: session.id, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } })) throw new OperationalProofUploadError("Sesiunea a fost revocată. Autentifică-te din nou.", 403);
      }
      // Assignment/status writes lock a task before updating its reservation.
      // Take the same order and then reload all facts used for authorization.
      let relationalTask = operationTaskId
        ? await getOperationalTaskForAccess(operationTaskId, session, tx)
        : await findOperationalTaskForWork({ reservationId, kind: kind as OperationKind, legacyTaskId: taskId, client: tx });
      if (operationTaskId && !relationalTask) throw new OperationalProofUploadError("Nu mai ai acces la taskul selectat. Reîncarcă lista lucrărilor.", 403);
      if (relationalTask) await tx.$queryRaw`SELECT id FROM portfolio_operation_tasks WHERE id = ${relationalTask.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM portfolio_reservations WHERE id = ${reservationId} FOR UPDATE`;
      const existing = await tx.reservation.findUnique({ where: { id: reservationId }, select: {
        id: true, status: true, productionNotes: true, ownerId: true, sellerUserId: true, salesperson: true,
        client: { select: { accountOwnerUserId: true, companyName: true } },
        campaign: { select: { campaignName: true, client: { select: { accountOwnerUserId: true } } } },
        location: { select: { code: true } },
      } });
      if (!existing) throw new OperationalProofUploadError("Lucrarea nu există.", 404);
      if (relationalTask) relationalTask = operationTaskId
        ? await getOperationalTaskForAccess(operationTaskId, session, tx)
        : await findOperationalTaskForWork({ reservationId, kind: kind as OperationKind, legacyTaskId: taskId, client: tx });
      if (operationTaskId && !relationalTask) throw new OperationalProofUploadError("Executorul lucrării s-a schimbat. Reîncarcă lista.", 409);
      const fieldHasAssignment = session.role === "FIELD_OPERATOR" && existing.status === "BOOKED" && relationalTask?.assignedToUserId === session.id;
      const hasPlannedFieldExecutor = Boolean(relationalTask?.assignedToUserId);
      const canComplete = hasPlannedFieldExecutor ? fieldHasAssignment : session.role !== "FIELD_OPERATOR" && canCompleteOperationalReservation(session, existing);
      if (!canComplete) throw new OperationalProofUploadError(hasPlannedFieldExecutor ? "Lucrarea poate fi finalizată numai de executorul de teren planificat." : "Nu ai acces să finalizezi această lucrare.", 403);
      const relationalKindMatches = !relationalTask || (kind === "neutralization" ? relationalTask.kind === "NEUTRALIZATION" : relationalTask.kind === "DECORATION" || relationalTask.kind === "REDECORATION");
      if (relationalTask && (relationalTask.reservationId !== reservationId || relationalTask.legacyTaskId !== taskId || !relationalKindMatches)) throw new OperationalProofUploadError("Taskul nu corespunde lucrării selectate.", 403);
      const legacyTask = taskId ? operationExtraTasks(existing.productionNotes, kind as OperationKind).find((task) => task.id === taskId) : null;
      if (taskId && !legacyTask && !relationalTask) throw new OperationalProofUploadError("Lucrarea suplimentară nu mai există. Reîncarcă lista.", 404);
      const currentStatus = relationalTask?.status || (taskId ? legacyTask?.status || "NEW" : operationStatus(existing.productionNotes, kind as OperationKind));
      const activeProofs = (await tx.clientDocument.findMany({ where: {
        reservationId, documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE, status: "active",
        OR: [{ expiryDate: null }, { expiryDate: { gte: uploadedAt } }],
      }, select: { id: true, fileName: true, notes: true, expiryDate: true } })).filter((photo) => {
        const notes = parseOperationalProofNotes(photo.notes);
        if (!notes || notes.kind !== kind) return false;
        if (notes.operationTaskId) return notes.operationTaskId === relationalTask?.id;
        return (notes.taskId || null) === taskId && !(relationalTask?.kind === "REDECORATION" && !taskId);
      });
      const activeProofCount = activeProofs.length;
      if (currentStatus === "DONE") return { alreadyCompleted: true, reservation: null, proofs: activeProofs, existing, relationalTask };
      if (!["NEW", "IN_PROGRESS"].includes(currentStatus)) throw new OperationalProofUploadError("Lucrarea anulată sau arhivată nu poate fi finalizată.", 409);
      if (activeProofCount + preparedFiles.length > OPERATIONAL_PROOF_MAX_FILES_PER_TASK) throw new OperationalProofUploadError("Această lucrare poate avea maximum 10 fotografii active. Fotografiile altor lucrări nu ocupă aceste locuri.");
      if (session.role === "FIELD_OPERATOR" && files.length < 1) throw new OperationalProofUploadError("Încarcă cel puțin o fotografie nouă pentru finalizarea acestei lucrări.");
      const proofs = [...activeProofs];
      for (const file of preparedFiles) {
        const document = await tx.clientDocument.create({ data: {
          reservationId, ...file, documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE,
          uploadedByUserId: session.id, uploadedAt, expiryDate: expiresAt,
          notes: operationalProofNotes({ kind: kind as OperationKind, taskId, operationTaskId: relationalTask?.id, isBaseTask: !taskId && relationalTask?.kind !== "REDECORATION", completionNote, uploadedByUserId: session.id }), status: "active",
        }, select: { id: true, fileName: true, notes: true, expiryDate: true } });
        proofs.push(document);
      }
      if (relationalTask) await tx.operationTask.update({ where: { id: relationalTask.id }, data: { status: "DONE", completedAt: uploadedAt, ...(completionNote ? { notes: completionNote } : {}) } });
      const nextProductionNotes = relationalTask?.kind === "REDECORATION" && !taskId ? existing.productionNotes || "" : taskId
        ? withOperationTaskCompletion(existing.productionNotes, taskId, { completedByUserId: session.id, completionNote })
        : withOperationCompletion(existing.productionNotes, kind as OperationKind, { completedByUserId: session.id, completionNote });
      const reservation = await updateReservationProductionNotesWithClient(tx, reservationId, nextProductionNotes, session);
      await recordTransactionalAudit(tx, { actor: session, action: `operation.${kind}.complete_with_proof`, entityType: "reservation", entityId: reservationId, metadata: { taskId, operationTaskId: relationalTask?.id || null, proofPhotoCount: preparedFiles.length, expiresAt: expiresAt.toISOString(), optimized: true } });
      return { alreadyCompleted: false, reservation, proofs, existing, relationalTask };
    }, { isolationLevel: "ReadCommitted", timeout: 30_000 });

    if (!outcome.alreadyCompleted) {
      try {
        const businessOwner = operationalBusinessOwner({ reservation: outcome.existing });
        await createOperationalNotifications({ recipientUserIds: [businessOwner?.id, outcome.relationalTask?.assignedToUserId], actorUserId: session.id, type: `operation_${kind}_completed`, title: kind === "decoration" ? "Decorare finalizată" : "Neutralizare finalizată", message: `${outcome.existing.location?.code || "Locația"} / ${outcome.existing.campaign?.campaignName || outcome.existing.client?.companyName || "campanie"} a fost finalizată de ${session.name}.`, entityId: `${reservationId}:${kind}:${taskId || "base"}`, metadata: { reservationId, kind, taskId, proofPhotoCount: preparedFiles.length } });
      } catch (error) { emitStructuredLog("error", "notification_sync_failed", { correlationId, operation: "operational.completion_notification", entityType: "reservation", entityId: reservationId, role: session.role, errorCode: safeErrorCode(error, "OPERATIONAL_NOTIFICATION_FAILED") }); }
    }
    emitStructuredLog("info", "proof_storage_upload_completed", { correlationId, operation: "operational.proof_upload", entityType: "reservation", entityId: reservationId, role: session.role, durationMs: Math.round(performance.now() - startedAt), status: 200, metrics: { fileCount: preparedFiles.length, fileBytes: preparedFiles.reduce((sum, file) => sum + file.fileSize, 0) } });
    return NextResponse.json({
      // Field operators receive a work receipt, never commercial rental terms.
      ...(session.role !== "FIELD_OPERATOR" && outcome.reservation ? { reservation: outcome.reservation } : {}),
      reservationId, operationTaskId: outcome.relationalTask?.id || null, status: "DONE", alreadyCompleted: outcome.alreadyCompleted,
      proofPhotoCount: outcome.proofs.length, expiresAt: outcome.proofs[0]?.expiryDate?.toISOString() || null,
      proofPhotos: outcome.proofs.map((photo) => ({ id: photo.id, fileName: photo.fileName, downloadUrl: operationalProofDownloadPath(photo.id) })),
    }, { headers: noStoreHeaders });
  } catch (error) {
    const status = error instanceof OperationalProofUploadError ? error.status : 503;
    emitStructuredLog("error", "proof_storage_upload_failed", { correlationId, operation: "operational.proof_upload", durationMs: Math.round(performance.now() - startedAt), status, errorCode: safeErrorCode(error, "PROOF_UPLOAD_FAILED") });
    return NextResponse.json({ error: error instanceof OperationalProofUploadError ? error.message : "Lucrarea nu a putut fi finalizată. Reîncearcă după reîncărcarea listei." }, { status, headers: noStoreHeaders });
  }
}
function textValue(value: FormDataEntryValue | null) { return typeof value === "string" ? value.trim() || null : null; }
