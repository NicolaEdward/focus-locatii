import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordTransactionalAudit } from "@/lib/transactional-audit";
import { approvedSourcePath, canonicalDocumentValue, canonicalSourcePath, documentHash, DocumentAuditError, ingestSchema, mayManageDocumentAudit, mayReadDocumentAudit, reviewSchema, safeBaseReference, sourceSchema } from "@/lib/document-source-domain";
import { AssistantOAuthError, authenticateAssistantBearer } from "@/lib/assistant-oauth";

export const documentAuditHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const options = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 30000 };
const scanLeaseMilliseconds = 15 * 60 * 1000;
const clearedScanLease = { activeScanId: null, activeScanStartedAt: null, activeScanObservedAt: null, activeScanLeaseUntil: null };
type Tx = Prisma.TransactionClient;
export type DocumentIngestReceipt = {
  sourceId: string; scanId: string; observedAt: string; payloadHash: string; batchAccepted: boolean; ignoredReason?: string;
  newDocuments: number; newVersions: number; unchanged: number; staleIgnored: number; missingFiles: number;
  scanCompletionAccepted: boolean; binariesStored: false; verifiedFactsImported: 0; replayed: boolean;
};

export async function assertDocumentAuditReader(actor: AuthSession) {
  if (!actor || !mayReadDocumentAudit(actor.role)) throw new DocumentAuditError("Dosarele NAS nealocate sunt vizibile numai conducerii autorizate.", 403, "DOCUMENT_AUDIT_FORBIDDEN");
  const current = await prisma.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true, tokenVersion: true } });
  if (!current?.active || current.role !== actor.role || current.tokenVersion !== actor.tokenVersion || actor.exp <= Math.floor(Date.now() / 1000)) throw new DocumentAuditError("Sesiunea sau drepturile s-au schimbat.", 401, "DOCUMENT_AUDIT_SESSION_CHANGED");
  if (actor.sessionId) {
    const session = await prisma.authSessionRecord.findUnique({ where: { id: actor.sessionId }, select: { userId: true, revokedAt: true, expiresAt: true } });
    if (!session || session.userId !== actor.id || session.revokedAt || session.expiresAt <= new Date()) throw new DocumentAuditError("Sesiunea a expirat sau a fost revocată.", 401, "DOCUMENT_AUDIT_SESSION_CHANGED");
  }
}
export async function assertDocumentAuditWriter(tx: Tx, actor: AuthSession) {
  if (!actor || !mayManageDocumentAudit(actor.role)) throw new DocumentAuditError("Administrarea surselor cere COO sau SUPER_ADMIN.", 403, "DOCUMENT_AUDIT_FORBIDDEN");
  await tx.$queryRaw`SELECT id FROM portfolio_users WHERE id = ${actor.id} FOR UPDATE`;
  const current = await tx.user.findUnique({ where: { id: actor.id }, select: { id: true, email: true, role: true, tokenVersion: true, active: true } });
  if (!current?.active || current.role !== actor.role || current.tokenVersion !== actor.tokenVersion || actor.exp <= Math.floor(Date.now() / 1000)) throw new DocumentAuditError("Sesiunea sau drepturile s-au schimbat.", 401, "DOCUMENT_AUDIT_SESSION_CHANGED");
  if (actor.sessionId) {
    await tx.$queryRaw`SELECT id FROM portfolio_auth_sessions WHERE id = ${actor.sessionId} FOR UPDATE`;
    const session = await tx.authSessionRecord.findUnique({ where: { id: actor.sessionId }, select: { userId: true, revokedAt: true, expiresAt: true } });
    if (!session || session.userId !== actor.id || session.revokedAt || session.expiresAt <= new Date()) throw new DocumentAuditError("Sesiunea a expirat sau a fost revocată.", 401, "DOCUMENT_AUDIT_SESSION_CHANGED");
  }
  return { ...current, auditRequestId: actor.auditRequestId };
}

export async function createDocumentSource(raw: unknown, actor: AuthSession) {
  const input = sourceSchema.parse(raw);
  const prefixes = [...new Set(input.allowedPathPrefixes.map(canonicalSourcePath))].sort();
  const baseReference = safeBaseReference(input.baseReference);
  return prisma.$transaction(async (tx) => {
    const current = await assertDocumentAuditWriter(tx, actor);
    const source = await tx.documentAuditSource.create({ data: { ...input, baseReference, allowedPathPrefixes: prefixes, ownerUserId: current.id, ownerTokenVersion: current.tokenVersion } });
    await recordTransactionalAudit(tx, { actor: current, action: "document_source.created", entityType: "document_source", entityId: source.id, metadata: { sourceType: source.sourceType, textIndexConsent: source.indexTextEnabled, approvedFolderCount: prefixes.length } });
    return { id: source.id };
  }, options);
}

export async function updateDocumentSource(raw: unknown, actor: AuthSession) {
  const { z } = await import("zod");
  const input = z.object({ id: z.string().min(1), expectedVersion: z.number().int().nonnegative(), state: z.enum(["active", "paused"]), configuration: sourceSchema }).strict().parse(raw);
  const prefixes = [...new Set(input.configuration.allowedPathPrefixes.map(canonicalSourcePath))].sort();
  const baseReference = safeBaseReference(input.configuration.baseReference);
  return prisma.$transaction(async (tx) => {
    const current = await assertDocumentAuditWriter(tx, actor);
    await tx.$queryRaw`SELECT id FROM portfolio_document_audit_sources WHERE id = ${input.id} FOR UPDATE`;
    const source = await tx.documentAuditSource.findUnique({ where: { id: input.id } });
    if (!source || source.version !== input.expectedVersion) throw new DocumentAuditError("Configurația s-a schimbat. Reîncarcă înainte de salvare.", 409, "DOCUMENT_SOURCE_VERSION_CONFLICT");
    await tx.documentAuditSource.update({ where: { id: source.id }, data: { ...input.configuration, ...clearedScanLease, baseReference, allowedPathPrefixes: prefixes, state: input.state, ingestTokenHash: null, tokenIssuedAt: null, lastCompletedScanAt: null, lastCompletedScanId: null, version: { increment: 1 } } });
    await recordTransactionalAudit(tx, { actor: current, action: "document_source.configuration_changed", entityType: "document_source", entityId: source.id, metadata: { version: source.version + 1, state: input.state, textIndexConsent: input.configuration.indexTextEnabled, previousDelegationRevoked: true } });
    return { id: source.id, newBridgeKeyRequired: true };
  }, options);
}

export async function issueDocumentIngestKey(raw: unknown, actor: AuthSession) {
  const { z } = await import("zod");
  const input = z.object({ sourceId: z.string().min(1), expectedVersion: z.number().int().nonnegative() }).strict().parse(raw);
  const value = "fm_nas_" + crypto.randomBytes(32).toString("base64url");
  const result = await prisma.$transaction(async (tx) => {
    const current = await assertDocumentAuditWriter(tx, actor);
    await tx.$queryRaw`SELECT id FROM portfolio_document_audit_sources WHERE id = ${input.sourceId} FOR UPDATE`;
    const source = await tx.documentAuditSource.findUnique({ where: { id: input.sourceId } });
    if (!source || source.state !== "active" || source.version !== input.expectedVersion) throw new DocumentAuditError("Sursa trebuie să fie activă și configurația actuală.", 409, "DOCUMENT_SOURCE_VERSION_CONFLICT");
    await tx.documentAuditSource.update({ where: { id: source.id }, data: { ...clearedScanLease, ingestTokenHash: documentHash(value), tokenIssuedAt: new Date(), ownerUserId: current.id, ownerTokenVersion: current.tokenVersion, version: { increment: 1 } } });
    await recordTransactionalAudit(tx, { actor: current, action: "document_source.delegation_issued", entityType: "document_source", entityId: source.id, metadata: { ownerUserId: current.id, previousDelegationRevoked: true } });
    return { sourceId: source.id, version: source.version + 1 };
  }, options);
  return { ...result, ingestKey: value, oneTimeSecret: true };
}

export async function revokeDocumentIngestKey(sourceId: string, actor: AuthSession) {
  return prisma.$transaction(async (tx) => {
    const current = await assertDocumentAuditWriter(tx, actor);
    await tx.$queryRaw`SELECT id FROM portfolio_document_audit_sources WHERE id = ${sourceId} FOR UPDATE`;
    const source = await tx.documentAuditSource.findUnique({ where: { id: sourceId } });
    if (!source) throw new DocumentAuditError("Sursa nu există.", 404);
    await tx.documentAuditSource.update({ where: { id: sourceId }, data: { ...clearedScanLease, ingestTokenHash: null, tokenIssuedAt: null, version: { increment: 1 } } });
    await recordTransactionalAudit(tx, { actor: current, action: "document_source.delegation_revoked", entityType: "document_source", entityId: sourceId });
    return { id: sourceId };
  }, options);
}

export async function ingestDocumentSource(sourceId: string, authorization: string | null, raw: unknown): Promise<DocumentIngestReceipt> {
  const key = authorization?.match(/^Bearer (fm_nas_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!key) throw new DocumentAuditError("Autentificarea bridge-ului este necesară.", 401, "DOCUMENT_SOURCE_UNAUTHORIZED");
  const input = ingestSchema.parse(raw);
  const observedAt = new Date(input.observedAt);
  if (observedAt.getTime() > Date.now() + 300000) throw new DocumentAuditError("Momentul scanării este în viitor.");
  for (const doc of input.documents) {
    canonicalSourcePath(doc.path);
    if (!doc.path.toLowerCase().endsWith(".pdf")) throw new DocumentAuditError("Indexarea inițială acceptă numai referințe PDF.");
    if (new Date(doc.modifiedAt).getTime() > observedAt.getTime() + 300000) throw new DocumentAuditError("Data documentului depășește observația scanării.");
    if (Buffer.byteLength(doc.pages.map((page) => page.text).join(""), "utf8") > 16384) throw new DocumentAuditError("Fragmentele unui document depășesc 16 KiB.");
    if (new Set(doc.pages.map((page) => page.page)).size !== doc.pages.length) throw new DocumentAuditError("Paginile documentului nu sunt unice.");
  }
  if (new Set(input.documents.map((doc) => canonicalSourcePath(doc.path))).size !== input.documents.length) throw new DocumentAuditError("Lotul conține aceeași cale de mai multe ori.");
  const tokenHash = documentHash(key), payloadHash = documentHash(canonicalDocumentValue(input));
  const delegated = await prisma.documentAuditSource.findFirst({ where: { id: sourceId, ingestTokenHash: tokenHash }, select: { ownerUserId: true } });
  if (!delegated) throw new DocumentAuditError("Cheia bridge-ului nu este validă.", 401, "DOCUMENT_SOURCE_UNAUTHORIZED");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM portfolio_users WHERE id = ${delegated.ownerUserId} FOR UPDATE`;
    const owner = await tx.user.findUnique({ where: { id: delegated.ownerUserId }, select: { id: true, email: true, role: true, active: true, tokenVersion: true } });
    await tx.$queryRaw`SELECT id FROM portfolio_document_audit_sources WHERE id = ${sourceId} FOR UPDATE`;
    const source = await tx.documentAuditSource.findUnique({ where: { id: sourceId } });
    if (!source || source.ownerUserId !== delegated.ownerUserId || source.state !== "active" || source.ingestTokenHash !== tokenHash || !owner?.active || !mayManageDocumentAudit(owner.role) || source.ownerTokenVersion !== owner.tokenVersion) throw new DocumentAuditError("Delegația bridge-ului a fost revocată sau drepturile s-au schimbat.", 401, "DOCUMENT_SOURCE_UNAUTHORIZED");
    const prior = await tx.documentIngestBatch.findUnique({ where: { sourceId_requestKey: { sourceId, requestKey: input.requestKey } } });
    if (prior) {
      if (prior.payloadHash !== payloadHash) throw new DocumentAuditError("Aceeași cheie a fost folosită pentru alt lot.", 409, "DOCUMENT_INGEST_REPLAY_MISMATCH");
      const receipt = prior.result as unknown as Omit<DocumentIngestReceipt, "replayed">;
      if (!receipt || receipt.payloadHash !== prior.payloadHash || typeof receipt.batchAccepted !== "boolean") throw new DocumentAuditError("Receipt-ul vechi nu este compatibil cu protocolul de scanare; verifică starea înainte de reluare.", 409, "DOCUMENT_INGEST_RECEIPT_INVALID");
      return { ...receipt, replayed: true };
    }
    const persistReceipt = async (result: Omit<DocumentIngestReceipt, "replayed">) => {
      await tx.documentIngestBatch.create({ data: { sourceId, requestKey: input.requestKey, payloadHash, scanId: input.scanId, observedAt, scanComplete: input.scanComplete, documentCount: input.documents.length, result: result as Prisma.InputJsonValue } });
      await recordTransactionalAudit(tx, { actor: owner, action: "document_source.ingest_committed", entityType: "document_source", entityId: sourceId, metadata: { scanId: input.scanId, documentCount: input.documents.length, payloadHash, batchAccepted: result.batchAccepted, newDocuments: result.newDocuments, newVersions: result.newVersions, staleIgnored: result.staleIgnored, missingFiles: result.missingFiles, scanCompletionAccepted: result.scanCompletionAccepted, textIndexConsent: source.indexTextEnabled } });
      return { ...result, replayed: false };
    };
    // Receipts are checked before watermarks: retries can acknowledge a closed
    // scan, but cannot move any document or renew an expired lease.
    const olderThanCompletion = source.lastCompletedScanAt && observedAt <= source.lastCompletedScanAt;
    const olderThanActive = source.activeScanObservedAt && observedAt < source.activeScanObservedAt;
    if (olderThanCompletion || olderThanActive) return persistReceipt({ sourceId, scanId: input.scanId, observedAt: input.observedAt, payloadHash, batchAccepted: false, ignoredReason: "SCAN_OBSERVATION_NOT_CURRENT", newDocuments: 0, newVersions: 0, unchanged: 0, staleIgnored: input.documents.length, missingFiles: 0, scanCompletionAccepted: false, binariesStored: false, verifiedFactsImported: 0 });
    const leaseCurrent = source.activeScanId && source.activeScanLeaseUntil && source.activeScanLeaseUntil > new Date();
    if (source.activeScanId === input.scanId) {
      if (!leaseCurrent) throw new DocumentAuditError("Lease-ul scanării a expirat; păstrează intenția veche și pornește o scanare nouă după verificarea stării.", 409, "DOCUMENT_SCAN_LEASE_EXPIRED");
    } else {
      if (leaseCurrent) throw new DocumentAuditError("O altă scanare a acestei surse este în curs. Nu porni cititori concurenți.", 409, "DOCUMENT_SCAN_BUSY");
      const seenScan = await tx.documentIngestBatch.findFirst({ where: { sourceId, scanId: input.scanId }, select: { id: true } });
      if (seenScan || source.lastCompletedScanId === input.scanId || source.activeScanId === input.scanId) throw new DocumentAuditError("Scanarea a fost închisă sau înlocuită și nu poate fi redeschisă.", 409, "DOCUMENT_SCAN_RETIRED");
      if (input.documents.length || input.scanComplete) throw new DocumentAuditError("Începe scanarea printr-un lot gol, nefinal, înainte de citirea arhivei.", 409, "DOCUMENT_SCAN_BEGIN_REQUIRED");
    }
    const prefixes = source.allowedPathPrefixes as string[];
    let newDocuments = 0, newVersions = 0, unchanged = 0, staleIgnored = 0;
    for (const item of input.documents) {
      const relativePath = canonicalSourcePath(item.path);
      if (!approvedSourcePath(relativePath, prefixes)) throw new DocumentAuditError("Un document este în afara folderelor aprobate.", 403, "DOCUMENT_SOURCE_PATH_FORBIDDEN");
      const pathHash = documentHash(relativePath);
      let document = await tx.sourceDocument.findUnique({ where: { sourceId_pathHash: { sourceId, pathHash } } });
      if (document && (document.relativePath !== relativePath || observedAt < document.lastSeenAt)) throw new DocumentAuditError("Documentul are deja o observație mai nouă; întregul lot trebuie reobservat.", 409, "DOCUMENT_SCAN_DOCUMENT_NOT_CURRENT");
      if (!document) {
        document = await tx.sourceDocument.create({ data: { sourceId, pathHash, relativePath, displayName: item.displayName, documentType: item.documentType, lastScanId: input.scanId, lastSeenAt: observedAt } });
        newDocuments++;
      }
      const pages = source.indexTextEnabled ? item.pages : [];
      const extractionStatus = source.indexTextEnabled ? item.extractionStatus : "metadata_only";
      const extractionHash = documentHash(canonicalDocumentValue({ pages, extractionStatus, textTruncated: item.textTruncated, baseReference: source.baseReference }));
      if (document.currentVersionId && observedAt.getTime() === document.lastSeenAt.getTime()) {
        const currentVersion = await tx.sourceDocumentVersion.findUnique({ where: { id: document.currentVersionId }, select: { sha256: true, extractionHash: true } });
        if (currentVersion && (currentVersion.sha256 !== item.sha256 || currentVersion.extractionHash !== extractionHash)) throw new DocumentAuditError("Aceeași observație temporală conține versiuni contradictorii ale documentului.", 409, "DOCUMENT_SCAN_OBSERVATION_CONFLICT");
      }
      let version = await tx.sourceDocumentVersion.findUnique({ where: { documentId_sha256_extractionHash: { documentId: document.id, sha256: item.sha256, extractionHash } } });
      if (!version) {
        version = await tx.sourceDocumentVersion.create({ data: { documentId: document.id, sha256: item.sha256, extractionHash, extractionStatus, textTruncated: item.textTruncated, textPages: pages,
          sourceReferenceSnapshot: source.baseReference, sourceConfigVersion: source.version,
          sizeBytes: item.sizeBytes, modifiedAt: new Date(item.modifiedAt), observedAt } });
        newVersions++;
      } else unchanged++;
      await tx.sourceDocument.update({ where: { id: document.id }, data: { displayName: item.displayName, documentType: item.documentType, currentVersionId: version.id, lastScanId: input.scanId, lastSeenAt: observedAt, state: "present" } });
    }
    let missingFiles = 0, scanCompletionAccepted = false;
    if (input.scanComplete && (!source.lastCompletedScanAt || observedAt >= source.lastCompletedScanAt)) {
      const missing = await tx.sourceDocument.updateMany({ where: { sourceId, lastScanId: { not: input.scanId }, lastSeenAt: { lte: observedAt }, state: "present" }, data: { state: "missing" } });
      missingFiles = missing.count; scanCompletionAccepted = true;
    }
    await tx.documentAuditSource.update({ where: { id: sourceId }, data: { lastIngestAt: new Date(),
      ...(scanCompletionAccepted ? clearedScanLease : { activeScanId: input.scanId, activeScanStartedAt: source.activeScanId === input.scanId ? source.activeScanStartedAt : observedAt, activeScanObservedAt: observedAt, activeScanLeaseUntil: new Date(Date.now() + scanLeaseMilliseconds) }),
      ...(scanCompletionAccepted ? { lastCompletedScanAt: observedAt, lastCompletedScanId: input.scanId } : {}) } });
    const result: Omit<DocumentIngestReceipt, "replayed"> = { sourceId, scanId: input.scanId, observedAt: input.observedAt, payloadHash, batchAccepted: true, newDocuments, newVersions, unchanged, staleIgnored, missingFiles, scanCompletionAccepted, binariesStored: false, verifiedFactsImported: 0 };
    return persistReceipt(result);
  }, options);
}

export async function reviewDocumentFacts(raw: unknown, actor: AuthSession) {
  const input = reviewSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const current = await assertDocumentAuditWriter(tx, actor);
    await tx.$queryRaw`SELECT id FROM portfolio_source_document_versions WHERE id = ${input.documentVersionId} FOR UPDATE`;
    const version = await tx.sourceDocumentVersion.findUnique({ where: { id: input.documentVersionId }, include: { document: { include: { source: true } } } });
    if (!version || version.document.currentVersionId !== version.id || version.document.state !== "present" || version.document.source.state !== "active") throw new DocumentAuditError("Documentul nu mai este versiunea curentă prezentă pe sursa activă.", 409, "DOCUMENT_EVIDENCE_STALE");
    if (version.sha256 !== input.sourceSha256 || version.reviewVersion !== input.expectedReviewVersion) throw new DocumentAuditError("Hash-ul sau revizia s-a schimbat. Reîncarcă documentul.", 409, "DOCUMENT_EVIDENCE_STALE");
    const next = version.reviewVersion + 1;
    await tx.documentFactReview.create({ data: { documentVersionId: version.id, version: next, state: input.state, facts: input.facts, note: input.note, reviewedByUserId: current.id } });
    await tx.sourceDocumentVersion.update({ where: { id: version.id }, data: { reviewVersion: next } });
    await recordTransactionalAudit(tx, { actor: current, action: "document_source.facts_reviewed", entityType: "document_version", entityId: version.id, metadata: { sourceSha256: version.sha256, reviewVersion: next, reviewState: input.state, factCount: input.facts.length, originalReviewedByHuman: true } });
    return { documentVersionId: version.id, reviewVersion: next, state: input.state };
  }, options);
}

export async function getDocumentAuditSummary(actor: AuthSession) {
  await assertDocumentAuditReader(actor);
  return readDocumentAuditSummarySnapshot();
}

/** A distinct server-only entry point, not a caller-controlled reader bypass.
 * OAuth validates the real current user and persisted grant/source session on
 * both sides of the read. Only its explicit offline consent may outlive the
 * source session's natural expiry; revocation/deletion still denies access. */
export async function getDocumentAuditSummaryForAssistant(authorization: string) {
  const before = await authenticateAssistantBearer(authorization);
  if (!before.scopes.includes("documents.read") || !mayReadDocumentAudit(before.actor.role)) throw new AssistantOAuthError("insufficient_scope", "Delegarea nu permite auditul documentelor nealocate.", 403);
  const summary = await readDocumentAuditSummarySnapshot();
  const after = await authenticateAssistantBearer(authorization);
  if (after.grant.id !== before.grant.id || !after.scopes.includes("documents.read") || !mayReadDocumentAudit(after.actor.role)) throw new AssistantOAuthError("insufficient_scope", "Permisiunile auditului documentar s-au schimbat.", 403);
  return summary;
}

async function readDocumentAuditSummarySnapshot() {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    // Establish the read view before issuing the remaining independent reads.
    const sources = await tx.documentAuditSource.findMany({ select: { id: true, state: true, lastCompletedScanAt: true, lastIngestAt: true, maxStaleHours: true, activeScanId: true } });
    const [totalDocuments, missingFiles, statuses, reviewTime, audit, reservationsChanged, inventoryChanged, clientsChanged, invoicesChanged, uploadsChanged] = await Promise.all([
      tx.sourceDocument.count(), tx.sourceDocument.count({ where: { state: "missing" } }),
      tx.$queryRaw<Array<{ extractionStatus: string; reviewState: string; total: bigint }>>`SELECT v.extractionStatus, COALESCE(r.state, 'pending') reviewState, COUNT(*) total FROM portfolio_source_documents d JOIN portfolio_source_document_versions v ON v.id = d.currentVersionId AND v.documentId = d.id LEFT JOIN portfolio_document_fact_reviews r ON r.documentVersionId = v.id AND r.version = v.reviewVersion WHERE d.state = 'present' GROUP BY v.extractionStatus, r.state`,
      tx.documentFactReview.aggregate({ _max: { reviewedAt: true } }),
      tx.documentAuditRun.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, asOf: true, scopeComplete: true, counts: true, limitations: true } }),
      tx.reservation.aggregate({ _max: { updatedAt: true } }), tx.location.aggregate({ _max: { updatedAt: true } }),
      tx.clientAccount.aggregate({ _max: { updatedAt: true } }), tx.financialReceivable.aggregate({ _max: { updatedAt: true } }),
      tx.financialReportUpload.aggregate({ _max: { updatedAt: true } }),
    ]);
    const active = sources.filter((source) => source.state === "active");
    const pendingScanSources = active.filter((source) => source.activeScanId).length;
    const syncRequired = active.filter((source) => !source.lastCompletedScanAt || source.activeScanId).length;
    const staleSources = active.filter((source) => source.lastCompletedScanAt && now.getTime() - source.lastCompletedScanAt.getTime() > source.maxStaleHours * 3600000).length;
    const needsOcr = statuses.filter((row) => row.extractionStatus === "needs_ocr").reduce((n, row) => n + Number(row.total), 0);
    const unavailableText = statuses.filter((row) => ["extraction_unavailable", "metadata_only"].includes(row.extractionStatus)).reduce((n, row) => n + Number(row.total), 0);
    const pendingReviewDocuments = statuses.filter((row) => row.reviewState !== "verified").reduce((n, row) => n + Number(row.total), 0);
    const businessChangedAfterReport = Boolean(audit && [reservationsChanged, inventoryChanged, clientsChanged, invoicesChanged, uploadsChanged].some((result) => result._max.updatedAt && result._max.updatedAt > audit.asOf));
    const reportMayBeStale = Boolean(audit && (businessChangedAfterReport || sources.some((source) => source.lastIngestAt && source.lastIngestAt > audit.asOf) || (reviewTime._max.reviewedAt && reviewTime._max.reviewedAt > audit.asOf)));
    const count = audit?.counts && typeof audit.counts === "object" && !Array.isArray(audit.counts) ? audit.counts as Record<string, unknown> : null;
    const reviewedScopeClear = Boolean(audit?.scopeComplete && !reportMayBeStale && count?.documents && count.differences === 0 && count.needsReview === 0 && !pendingReviewDocuments && !missingFiles);
    const state = !sources.length ? "unconfigured" : !active.length ? "paused" : syncRequired ? "sync_required" : staleSources ? "stale" : !audit || reportMayBeStale ? "audit_required" : reviewedScopeClear ? "within_reviewed_scope" : "review_required";
    return { asOf: now.toISOString(), configured: sources.length > 0, state, sourceCount: sources.length, activeSources: active.length, pendingScanSources, syncRequired, staleSources, indexedDocuments: totalDocuments, missingFiles, pendingReviewDocuments, needsOcrDocuments: needsOcr, metadataOnlyOrUnavailableDocuments: unavailableText, reportMayBeStale, businessChangedAfterReport,
      lastCompletedScanAt: active.filter((source) => source.lastCompletedScanAt).map((source) => source.lastCompletedScanAt!.toISOString()).sort()[0] || null,
      latestAudit: audit ? { ...audit, asOf: audit.asOf.toISOString() } : null,
      automaticBusinessCorrections: false, coverage: "Numai referințele sincronizate și faptele confirmate explicit. Lipsa diferențelor nu dovedește că toate contractele firmei sunt în aplicație. Numărul documentelor din index nu este inventarul complet al NAS-ului.",
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 30000 });
}

export async function getDocumentAuditWorkspace(actor: AuthSession, cursor?: string | null) {
  await assertDocumentAuditReader(actor);
  const [summary, sources, documents, latestAudit] = await Promise.all([
    getDocumentAuditSummary(actor),
    prisma.documentAuditSource.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, label: true, sourceType: true, baseReference: true, allowedPathPrefixes: true, indexTextEnabled: true, maxStaleHours: true, state: true, version: true, tokenIssuedAt: true, lastIngestAt: true, lastCompletedScanAt: true } }),
    prisma.sourceDocument.findMany({ where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: "asc" }, take: 26, select: { id: true, sourceId: true, relativePath: true, displayName: true, documentType: true, state: true, lastSeenAt: true, currentVersionId: true } }),
    prisma.documentAuditRun.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
  ]);
  const page = documents.slice(0, 25), ids = page.map((doc) => doc.currentVersionId).filter((id): id is string => Boolean(id));
  const versions = ids.length ? await prisma.sourceDocumentVersion.findMany({ where: { id: { in: ids } }, include: { reviews: { orderBy: { version: "desc" }, take: 1 } } }) : [];
  const byId = new Map(versions.map((version) => [version.id, version]));
  return { summary, sources: sources.map((source) => ({ ...source, tokenIssuedAt: source.tokenIssuedAt?.toISOString() || null, lastIngestAt: source.lastIngestAt?.toISOString() || null, lastCompletedScanAt: source.lastCompletedScanAt?.toISOString() || null })),
    documents: page.map((doc) => { const v = doc.currentVersionId ? byId.get(doc.currentVersionId) : null; return { ...doc, lastSeenAt: doc.lastSeenAt.toISOString(), version: v && v.documentId === doc.id ? { id: v.id, sha256: v.sha256, sizeBytes: v.sizeBytes, extractionStatus: v.extractionStatus, textTruncated: v.textTruncated, textPages: v.textPages, modifiedAt: v.modifiedAt.toISOString(), observedAt: v.observedAt.toISOString(), reviewVersion: v.reviewVersion, sourceReference: v.sourceReferenceSnapshot, review: v.reviews[0] ? { ...v.reviews[0], reviewedAt: v.reviews[0].reviewedAt.toISOString() } : null } : null }; }),
    nextCursor: documents.length > 25 ? page.at(-1)!.id : null,
    latestAudit: latestAudit ? { ...latestAudit, asOf: latestAudit.asOf.toISOString(), createdAt: latestAudit.createdAt.toISOString() } : null,
  };
}
