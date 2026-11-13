import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { AuthSession } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
import { canonicalDocumentValue, DocumentAuditError, documentHash, safeBaseReference, type DocumentFact } from "../src/lib/document-source-domain";
import { createDocumentSource, getDocumentAuditSummary, getDocumentAuditWorkspace, ingestDocumentSource, issueDocumentIngestKey, reviewDocumentFacts, revokeDocumentIngestKey, updateDocumentSource } from "../src/lib/document-source-service";
import { runDocumentReconciliation, runScheduledDocumentAudit } from "../src/lib/document-reconciliation";
import { GET as scheduledAuditRoute } from "../src/app/api/cron/document-audit/route";

// Never reuse a production connection or a general-purpose preview database.
loadEnvFile();
assertSyntheticEnvironment();
const database = new URL(process.env.DATABASE_URL!);
assert.ok(["127.0.0.1", "localhost"].includes(database.hostname), "Local synthetic database required");
assert.equal(decodeURIComponent(database.pathname.slice(1)), process.env.DOCUMENT_AUDIT_TEST_DATABASE || "focus_preview_nas_document_audit");
assert.notEqual(process.env.NODE_ENV, "production");
const tag = `nas-audit-${randomUUID()}`;
const users: string[] = [], sources: string[] = [], locations: string[] = [];
const clients: string[] = [], uploads: string[] = [], categories: string[] = [], runs: string[] = [];
const checks: string[] = [];
const previousCronSecret = process.env.CRON_SECRET;
const cronSecret = `synthetic-cron-${randomUUID()}`;
const now = Date.now() - 120_000;
const suiteScanId = randomUUID();
let tick = 0;
const instant = () => new Date(now + ++tick * 1000).toISOString();
const config = (indexTextEnabled = false) => ({ label: tag, baseReference: "smb://synthetic.invalid/contracts", allowedPathPrefixes: ["contracts", "invoices"], indexTextEnabled, maxStaleHours: 24 });
const evidence = { page: 1, quote: "Synthetic contract explicitly states the location and agreed commercial terms." };
const reservationFact = (locationCode: string, extra: Record<string, unknown> = {}) => ({ kind: "reservation", locationCode, periodStart: "2090-01-01", periodEnd: "2090-01-31", ...extra, evidence }) as DocumentFact;
const pdf = (path: string, contents = path, extractionStatus = "metadata_only", pages: { page: number; text: string }[] = []) => ({ path, displayName: path.split("/").at(-1)!, documentType: path.startsWith("invoices/") ? "invoice" : "contract", sha256: documentHash(contents), sizeBytes: 123, modifiedAt: new Date(now - 86400000).toISOString(), extractionStatus, textTruncated: false, pages, facts: [], verification: "unverified" });
type InputDocument = ReturnType<typeof pdf>;
function batch(documents: InputDocument[], scanComplete = false, scanId: string = suiteScanId) {
  return { requestKey: `test:${randomUUID()}`, scanId, scanComplete, observedAt: instant(), documents };
}
async function denied(work: () => Promise<unknown>, code: string, status?: number) {
  await assert.rejects(work, (error: unknown) => error instanceof DocumentAuditError && error.code === code && (status === undefined || error.status === status));
}
async function actor(role: AuthSession["role"]): Promise<AuthSession> {
  const row = await prisma.user.create({ data: { name: tag, email: `${tag}-${role}@example.invalid`, role, passwordHash: "synthetic-no-login", active: true } });
  users.push(row.id);
  return { id: row.id, name: row.name, email: row.email, role, tokenVersion: row.tokenVersion, iat: 1, exp: 4_000_000_000 };
}
async function source(owner: AuthSession, text = false) {
  const result = await createDocumentSource(config(text), owner); sources.push(result.id);
  const key = await issueDocumentIngestKey({ sourceId: result.id, expectedVersion: 0 }, owner);
  return { id: result.id, key: key.ingestKey, version: key.version };
}
async function current(sourceId: string, path: string) {
  const document = await prisma.sourceDocument.findUniqueOrThrow({ where: { sourceId_pathHash: { sourceId, pathHash: documentHash(path) } } });
  const version = await prisma.sourceDocumentVersion.findUniqueOrThrow({ where: { id: document.currentVersionId! } });
  return { document, version };
}
async function verify(sourceId: string, path: string, facts: DocumentFact[], owner: AuthSession) {
  const { version } = await current(sourceId, path);
  return reviewDocumentFacts({ documentVersionId: version.id, expectedReviewVersion: version.reviewVersion, sourceSha256: version.sha256, originalReviewed: true, state: "verified", note: "Synthetic human review of the explicit original evidence.", facts }, owner);
}
async function report(owner: AuthSession) { const run = await runDocumentReconciliation(owner); runs.push(run.id); return run; }
async function businessSnapshot() {
  const where = { id: { in: locations } };
  return JSON.stringify({ locations: await prisma.location.findMany({ where, orderBy: { id: "asc" } }), reservations: await prisma.reservation.findMany({ where: { locationId: { in: locations } }, orderBy: { id: "asc" } }), clients: await prisma.clientAccount.findMany({ where: { id: { in: clients } }, orderBy: { id: "asc" } }), receivables: await prisma.financialReceivable.findMany({ where: { uploadId: { in: uploads } }, orderBy: { id: "asc" } }) });
}

async function scanOrderingRegressions(owner: AuthSession) {
  const feed = await source(owner), auth = `Bearer ${feed.key}`;
  const doc = pdf("contracts/ordered.pdf", "reviewed-ordering-fixture");
  const initialScan = randomUUID(), laterScan = randomUUID();
  const begin = (scanId: string, observedAt = instant()) => ({ ...batch([], false, scanId), observedAt });
  await denied(() => ingestDocumentSource(feed.id, auth, batch([doc], true, initialScan)), "DOCUMENT_SCAN_BEGIN_REQUIRED", 409);
  await ingestDocumentSource(feed.id, auth, begin(initialScan));
  const initialDoc = batch([doc], false, initialScan);
  await ingestDocumentSource(feed.id, auth, initialDoc);
  await verify(feed.id, doc.path, [reservationFact(`${tag}-ordering-missing-location`)], owner);
  await ingestDocumentSource(feed.id, auth, batch([], true, initialScan));
  await ingestDocumentSource(feed.id, auth, begin(laterScan));
  const completed = batch([], true, laterScan);
  await ingestDocumentSource(feed.id, auth, completed);
  const absent = await current(feed.id, doc.path);
  assert.equal(absent.document.state, "missing"); assert.equal(absent.version.reviewVersion, 1);
  const sourceBefore = await prisma.documentAuditSource.findUniqueOrThrow({ where: { id: feed.id } });
  const delayed = { ...initialDoc, requestKey: `test:${randomUUID()}`, observedAt: new Date(new Date(initialDoc.observedAt).getTime() + 1).toISOString(), documents: [pdf(doc.path, "stale-replacement")] };
  const ignored = await ingestDocumentSource(feed.id, auth, delayed);
  assert.equal(ignored.batchAccepted, false); assert.equal(ignored.scanCompletionAccepted, false);
  assert.equal(ignored.payloadHash, documentHash(canonicalDocumentValue(delayed)));
  const stillAbsent = await current(feed.id, doc.path);
  assert.equal(stillAbsent.document.state, "missing"); assert.equal(stillAbsent.version.id, absent.version.id); assert.equal(stillAbsent.version.reviewVersion, 1);
  assert.equal((await prisma.documentAuditSource.findUniqueOrThrow({ where: { id: feed.id } })).lastIngestAt?.getTime(), sourceBefore.lastIngestAt?.getTime());
  const replayed = await ingestDocumentSource(feed.id, auth, initialDoc);
  assert.equal(replayed.replayed, true); assert.equal(replayed.batchAccepted, true);
  assert.equal((await current(feed.id, doc.path)).document.state, "missing");
  const equal = await ingestDocumentSource(feed.id, auth, begin(randomUUID(), completed.observedAt));
  assert.equal(equal.batchAccepted, false, "A distinct scan at the completed timestamp cannot become authoritative");
  await denied(() => ingestDocumentSource(feed.id, auth, begin(initialScan)), "DOCUMENT_SCAN_RETIRED", 409);
  checks.push("empty begin required; delayed partial/equal watermark cannot resurrect missing reviewed evidence; old exact receipt replays without state change");

  const contenders = [randomUUID(), randomUUID()];
  const concurrentAt = instant();
  const outcomes = await Promise.allSettled(contenders.map((scanId) => ingestDocumentSource(feed.id, auth, begin(scanId, concurrentAt))));
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const winner = contenders[outcomes.findIndex((outcome) => outcome.status === "fulfilled")], loser = contenders.find((scanId) => scanId !== winner)!;
  const failure = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(failure?.status === "rejected" && failure.reason instanceof DocumentAuditError && failure.reason.code === "DOCUMENT_SCAN_BUSY");
  const winnerEnvelope = batch([doc, pdf("contracts/winner.pdf")], false, winner);
  const accepted = await ingestDocumentSource(feed.id, auth, winnerEnvelope);
  assert.equal(accepted.batchAccepted, true);
  assert.equal(accepted.payloadHash, documentHash(canonicalDocumentValue(winnerEnvelope)));
  await denied(() => ingestDocumentSource(feed.id, auth, batch([pdf("contracts/loser.pdf")], true, loser)), "DOCUMENT_SCAN_BUSY", 409);
  await ingestDocumentSource(feed.id, auth, batch([], true, winner));
  assert.equal((await current(feed.id, doc.path)).document.state, "present");
  assert.equal((await current(feed.id, "contracts/winner.pdf")).document.state, "present");
  assert.equal(await prisma.sourceDocument.count({ where: { sourceId: feed.id, relativePath: "contracts/loser.pdf" } }), 0);
  checks.push("simultaneous scan begin has one winner; losing scan cannot overwrite membership or falsely mark winner files missing");

  const abandoned = randomUUID(), replacement = randomUUID();
  await ingestDocumentSource(feed.id, auth, begin(abandoned));
  await ingestDocumentSource(feed.id, auth, batch([pdf("contracts/abandoned.pdf")], false, abandoned));
  // Expire only our synthetic source's lease, as if its bridge had crashed.
  await prisma.documentAuditSource.update({ where: { id: feed.id }, data: { activeScanLeaseUntil: new Date(Date.now() - 1000) } });
  await denied(() => ingestDocumentSource(feed.id, auth, batch([], false, abandoned)), "DOCUMENT_SCAN_LEASE_EXPIRED", 409);
  await ingestDocumentSource(feed.id, auth, begin(replacement));
  await denied(() => ingestDocumentSource(feed.id, auth, batch([doc], true, abandoned)), "DOCUMENT_SCAN_BUSY", 409);
  const replacementEnvelope = batch([doc, pdf("contracts/winner.pdf")], false, replacement);
  await ingestDocumentSource(feed.id, auth, replacementEnvelope);
  const reordered = await ingestDocumentSource(feed.id, auth, { ...batch([pdf(doc.path, "out-of-order")], false, replacement), observedAt: new Date(new Date(replacementEnvelope.observedAt).getTime() - 1).toISOString() });
  assert.equal(reordered.batchAccepted, false);
  // Equal milliseconds are legal within the same leased scan, including final ACK.
  const equalWithin = { ...batch([doc], false, replacement), observedAt: replacementEnvelope.observedAt };
  assert.equal((await ingestDocumentSource(feed.id, auth, equalWithin)).batchAccepted, true);
  await denied(() => ingestDocumentSource(feed.id, auth, { ...equalWithin, requestKey: `test:${randomUUID()}`, documents: [pdf(doc.path, "equivocated-same-millisecond")] }), "DOCUMENT_SCAN_OBSERVATION_CONFLICT", 409);
  const endReplacement = { ...batch([], true, replacement), observedAt: replacementEnvelope.observedAt };
  assert.equal((await ingestDocumentSource(feed.id, auth, endReplacement)).scanCompletionAccepted, true);
  await denied(() => ingestDocumentSource(feed.id, auth, begin(abandoned)), "DOCUMENT_SCAN_RETIRED", 409);
  assert.equal((await current(feed.id, doc.path)).version.sha256, doc.sha256);
  assert.equal((await current(feed.id, "contracts/winner.pdf")).document.state, "present");
  assert.equal((await current(feed.id, "contracts/abandoned.pdf")).document.state, "missing");
  checks.push("expired lease requires a new scan ID; superseded scan cannot return; out-of-order batch ignored; equal milliseconds allowed only within the active scan");

  const revokedScan = randomUUID();
  await ingestDocumentSource(feed.id, auth, begin(revokedScan));
  const beforeRotation = await prisma.documentAuditSource.findUniqueOrThrow({ where: { id: feed.id } });
  const replacementKey = await issueDocumentIngestKey({ sourceId: feed.id, expectedVersion: beforeRotation.version }, owner);
  assert.equal((await prisma.documentAuditSource.findUniqueOrThrow({ where: { id: feed.id } })).activeScanId, null);
  await denied(() => ingestDocumentSource(feed.id, auth, batch([doc], true, revokedScan)), "DOCUMENT_SOURCE_UNAUTHORIZED", 401);
  await denied(() => ingestDocumentSource(feed.id, `Bearer ${replacementKey.ingestKey}`, begin(revokedScan)), "DOCUMENT_SCAN_RETIRED", 409);
  const renewedScan = randomUUID();
  await ingestDocumentSource(feed.id, `Bearer ${replacementKey.ingestKey}`, begin(renewedScan));
  await ingestDocumentSource(feed.id, `Bearer ${replacementKey.ingestKey}`, batch([doc, pdf("contracts/winner.pdf")], true, renewedScan));
  checks.push("key rotation invalidates the active lease; neither old key nor a fresh key can resume its retired scan ID");
}

async function main() {
  const noSource = await runScheduledDocumentAudit();
  assert.equal(noSource.state, "no_authorized_source"); assert.equal(noSource.reportGenerated, false); assert.equal(noSource.businessRowsModified, 0);
  assert.equal(await prisma.documentAuditRun.count(), 0);
  delete process.env.CRON_SECRET;
  assert.equal((await scheduledAuditRoute(new NextRequest("http://localhost/api/cron/document-audit", { headers: { authorization: `Bearer ${cronSecret}` } }))).status, 401);
  process.env.CRON_SECRET = cronSecret;
  assert.equal((await scheduledAuditRoute(new NextRequest("http://localhost/api/cron/document-audit"))).status, 401);
  assert.equal((await scheduledAuditRoute(new NextRequest("http://localhost/api/cron/document-audit", { headers: { authorization: "Bearer synthetic-wrong" } }))).status, 401);
  const noSourceResponse = await scheduledAuditRoute(new NextRequest("http://localhost/api/cron/document-audit", { headers: { authorization: `Bearer ${cronSecret}` } }));
  assert.equal(noSourceResponse.status, 200); assert.equal(noSourceResponse.headers.get("cache-control"), "no-store");
  assert.equal((await noSourceResponse.json()).state, "no_authorized_source");
  checks.push("scheduler without source produces no report; direct cron handler requires configured exact CRON_SECRET and uses no-store");
  const coo = await actor("COO"), sales = await actor("SALES_AGENT"), director = await actor("D_CEO");
  const empty = await getDocumentAuditSummary(coo);
  assert.equal(empty.state, "unconfigured"); assert.equal(empty.configured, false);
  await denied(() => getDocumentAuditSummary(sales), "DOCUMENT_AUDIT_FORBIDDEN", 403);
  await denied(() => getDocumentAuditWorkspace(sales), "DOCUMENT_AUDIT_FORBIDDEN", 403);
  await denied(() => createDocumentSource(config(), sales), "DOCUMENT_AUDIT_FORBIDDEN", 403);
  await denied(() => createDocumentSource(config(), director), "DOCUMENT_AUDIT_FORBIDDEN", 403);
  await denied(() => runDocumentReconciliation(director), "DOCUMENT_AUDIT_FORBIDDEN", 403);
  await getDocumentAuditSummary(director);
  checks.push("SA denied; D_CEO reads without write capability; unconfigured is not zero-difference assurance");

  const metadata = await source(coo);
  const stored = await prisma.documentAuditSource.findUniqueOrThrow({ where: { id: metadata.id } });
  assert.equal(stored.ingestTokenHash, documentHash(metadata.key));
  assert.notEqual(stored.ingestTokenHash, metadata.key); assert.equal(stored.ownerUserId, coo.id);
  await denied(() => issueDocumentIngestKey({ sourceId: metadata.id, expectedVersion: metadata.version }, director), "DOCUMENT_AUDIT_FORBIDDEN", 403);
  const rotated = await issueDocumentIngestKey({ sourceId: metadata.id, expectedVersion: metadata.version }, coo);
  await denied(() => ingestDocumentSource(metadata.id, `Bearer ${metadata.key}`, batch([])), "DOCUMENT_SOURCE_UNAUTHORIZED", 401);
  metadata.key = rotated.ingestKey; metadata.version = rotated.version;
  await revokeDocumentIngestKey(metadata.id, coo);
  await denied(() => ingestDocumentSource(metadata.id, `Bearer ${metadata.key}`, batch([])), "DOCUMENT_SOURCE_UNAUTHORIZED", 401);
  const afterRevoke = await prisma.documentAuditSource.findUniqueOrThrow({ where: { id: metadata.id } });
  assert.equal(afterRevoke.ingestTokenHash, null);
  const reissued = await issueDocumentIngestKey({ sourceId: metadata.id, expectedVersion: afterRevoke.version }, coo);
  metadata.key = reissued.ingestKey;
  checks.push("hash-only delegation; rotate and revoke reject old keys immediately");

  const privateText = "SYNTHETIC-TEXT-REQUIRING-EXPLICIT-CONSENT";
  await ingestDocumentSource(metadata.id, `Bearer ${metadata.key}`, batch([]));
  const envelope = batch([pdf("contracts/metadata.pdf", "immutable-v1", "text_available", [{ page: 1, text: privateText }])]);
  const inserted = await ingestDocumentSource(metadata.id, `Bearer ${metadata.key}`, envelope);
  assert.ok("newVersions" in inserted && "binariesStored" in inserted && "verifiedFactsImported" in inserted);
  assert.equal(inserted.newVersions, 1); assert.equal(inserted.binariesStored, false); assert.equal(inserted.verifiedFactsImported, 0);
  const first = await current(metadata.id, "contracts/metadata.pdf");
  assert.equal(first.version.extractionStatus, "metadata_only"); assert.deepEqual(first.version.textPages, []);
  assert.equal(JSON.stringify(first).includes(privateText), false);
  assert.equal((await ingestDocumentSource(metadata.id, `Bearer ${metadata.key}`, envelope)).replayed, true);
  await denied(() => ingestDocumentSource(metadata.id, `Bearer ${metadata.key}`, { ...envelope, documents: [pdf("contracts/metadata.pdf", "changed-payload")] }), "DOCUMENT_INGEST_REPLAY_MISMATCH", 409);
  const beforeAtomic = await prisma.sourceDocument.count({ where: { sourceId: metadata.id } });
  await denied(() => ingestDocumentSource(metadata.id, `Bearer ${metadata.key}`, batch([pdf("contracts/atomic-valid.pdf"), pdf("private/atomic-forbidden.pdf")])), "DOCUMENT_SOURCE_PATH_FORBIDDEN", 403);
  assert.equal(await prisma.sourceDocument.count({ where: { sourceId: metadata.id } }), beforeAtomic);
  assert.equal(await prisma.documentIngestBatch.count({ where: { sourceId: metadata.id } }), 2);
  checks.push("no text without consent; idempotent replay and payload mismatch; forbidden path rolls back entire batch");

  const fact = reservationFact(`${tag}-not-present`);
  const reviewInput = { documentVersionId: first.version.id, expectedReviewVersion: 0, sourceSha256: first.version.sha256, originalReviewed: true as const, state: "verified" as const, note: "Synthetic review of the original and its exact hash.", facts: [fact] };
  await denied(() => reviewDocumentFacts({ ...reviewInput, sourceSha256: "0".repeat(64) }, coo), "DOCUMENT_EVIDENCE_STALE", 409);
  await denied(() => reviewDocumentFacts(reviewInput, director), "DOCUMENT_AUDIT_FORBIDDEN", 403);
  await reviewDocumentFacts(reviewInput, coo);
  await denied(() => reviewDocumentFacts(reviewInput, coo), "DOCUMENT_EVIDENCE_STALE", 409);
  const previousReview = await prisma.documentFactReview.findMany({ where: { documentVersionId: first.version.id } });
  await ingestDocumentSource(metadata.id, `Bearer ${metadata.key}`, batch([pdf("contracts/metadata.pdf", "immutable-v1")]));
  const same = await current(metadata.id, "contracts/metadata.pdf");
  assert.equal(same.version.id, first.version.id); assert.equal(same.version.reviewVersion, 1);
  await ingestDocumentSource(metadata.id, `Bearer ${metadata.key}`, batch([pdf("contracts/metadata.pdf", "immutable-v2")]));
  const second = await current(metadata.id, "contracts/metadata.pdf");
  assert.notEqual(second.version.id, first.version.id); assert.equal(second.version.reviewVersion, 0);
  assert.deepEqual(await prisma.documentFactReview.findMany({ where: { documentVersionId: first.version.id } }), previousReview);
  assert.equal((await prisma.sourceDocumentVersion.findUniqueOrThrow({ where: { id: first.version.id } })).sha256, documentHash("immutable-v1"));
  await denied(() => reviewDocumentFacts({ ...reviewInput, expectedReviewVersion: 1 }, coo), "DOCUMENT_EVIDENCE_STALE", 409);
  checks.push("human review hash/version/current-version gates; immutable old version and review retained; unchanged hash preserves review");

  // A completion reports missing references without deleting old evidence.
  await ingestDocumentSource(metadata.id, `Bearer ${metadata.key}`, batch([], true));
  const missingScanId = randomUUID();
  await ingestDocumentSource(metadata.id, `Bearer ${metadata.key}`, batch([], false, missingScanId));
  const missingScan = batch([], true, missingScanId);
  const missing = await ingestDocumentSource(metadata.id, `Bearer ${metadata.key}`, missingScan);
  assert.ok("missingFiles" in missing && "scanCompletionAccepted" in missing);
  assert.equal(missing.missingFiles, 1); assert.equal(missing.scanCompletionAccepted, true);
  const missingDocument = await current(metadata.id, "contracts/metadata.pdf");
  assert.equal(missingDocument.document.state, "missing");
  assert.equal(await prisma.sourceDocumentVersion.count({ where: { documentId: first.document.id } }), 2);
  const oldCompletion = { ...batch([], true), observedAt: new Date(now - 3600000).toISOString() };
  const oldCompleted = await ingestDocumentSource(metadata.id, `Bearer ${metadata.key}`, oldCompletion);
  assert.ok("scanCompletionAccepted" in oldCompleted); assert.equal(oldCompleted.scanCompletionAccepted, false);
  assert.equal((await prisma.documentAuditSource.findUniqueOrThrow({ where: { id: metadata.id } })).lastCompletedScanId, missingScan.scanId);
  assert.ok((await report(coo)).findings.some((finding) => finding.code === "SOURCE_FILE_NOT_SEEN"));
  checks.push("complete scan marks missing, older completion ignored, evidence history retained");

  const indexed = await source(coo, true);
  await ingestDocumentSource(indexed.id, `Bearer ${indexed.key}`, batch([]));
  await ingestDocumentSource(indexed.id, `Bearer ${indexed.key}`, batch([pdf("contracts/scanned.pdf", "image-only", "needs_ocr")]));
  const unknown = await report(coo);
  assert.equal(unknown.scopeComplete, false); assert.ok(unknown.findings.some((finding) => finding.code === "OCR_REVIEW_REQUIRED"));
  const unknownSummary = await getDocumentAuditSummary(director);
  assert.ok(unknownSummary.needsOcrDocuments >= 1); assert.notEqual(unknownSummary.state, "within_reviewed_scope");
  checks.push("image PDFs require OCR or original review and never count as verified zero differences");

  const category = await prisma.category.create({ data: { name: tag, slug: tag } }); categories.push(category.id);
  const client = await prisma.clientAccount.create({ data: { companyName: tag, taxId: "RO12345678", accountOwnerUserId: sales.id } }); clients.push(client.id);
  async function location(suffix: string) {
    const row = await prisma.location.create({ data: { code: `${tag}-${suffix}`, categoryId: category.id, type: "Panou", showInPublic: false } }); locations.push(row.id); return row;
  }
  const a = await location("period-rent"), b = await location("currency"), c = await location("unbooked"), d = await location("overlap"), e = await location("last-day-noon"), f = await location("truncated-conflicts");
  const booked = await prisma.reservation.create({ data: { locationId: a.id, clientId: client.id, clientName: tag, status: "BOOKED", periodStart: new Date("2090-01-02"), periodEnd: new Date("2090-01-30"), monthlyRentShare: 100, amount: 100, currency: "EUR", contractNumber: "SYN-1", ownerId: sales.id } });
  const wrongCurrency = await prisma.reservation.create({ data: { locationId: b.id, clientName: tag, status: "BOOKED", periodStart: new Date("2090-01-01"), periodEnd: new Date("2090-01-31"), monthlyRentShare: 100, currency: "RON", ownerId: sales.id } });
  await prisma.reservation.createMany({ data: [1, 2].map(() => ({ locationId: d.id, clientName: tag, status: "BOOKED" as const, periodStart: new Date("2090-01-01"), periodEnd: new Date("2090-01-31"), currency: "EUR", ownerId: sales.id })) });
  const overlapBooked = await prisma.reservation.findFirstOrThrow({ where: { locationId: d.id }, orderBy: { id: "asc" } });
  const noonBooked = await prisma.reservation.create({ data: { locationId: e.id, clientName: tag, status: "BOOKED", periodStart: new Date("2090-01-01"), periodEnd: new Date("2090-01-31"), currency: "EUR", ownerId: sales.id } });
  await prisma.reservation.create({ data: { locationId: e.id, clientName: tag, status: "BOOKED", periodStart: new Date("2090-01-31T12:00:00Z"), periodEnd: new Date("2090-02-02"), currency: "EUR", ownerId: sales.id } });
  const truncatedBooked = await prisma.reservation.create({ data: { locationId: f.id, clientName: tag, status: "BOOKED", periodStart: new Date("2090-01-01"), periodEnd: new Date("2090-01-31"), currency: "EUR", ownerId: sales.id } });
  await prisma.reservation.createMany({ data: Array.from({ length: 201 }, () => ({ locationId: f.id, clientName: tag, status: "HOLD" as const, periodStart: new Date("2090-01-01"), periodEnd: new Date("2090-01-31"), holdExpiresAt: new Date("2000-01-01"), currency: "EUR", ownerId: sales.id })) });
  const upload = await prisma.financialReportUpload.create({ data: { originalFileName: "synthetic.csv", fileHash: documentHash(tag), uploadedByUserId: coo.id } }); uploads.push(upload.id);
  const invoiceNumber = `${tag}-INV-1`;
  await prisma.financialReceivable.create({ data: { uploadId: upload.id, clientId: client.id, companyName: "Focus Media", companyCode: "FOCUS_MEDIA", invoiceNumber, normalizedInvoiceNumber: invoiceNumber.toUpperCase(), canonicalKey: tag, invoicedAmount: 1000, collectedAmount: 200, remainingAmount: 800, currency: "EUR", invoiceDate: new Date("2090-01-01"), includedInReport: true } });
  const businessBefore = await businessSnapshot();
  const docs = [pdf("contracts/terms.pdf", "terms", "text_available", [{ page: 1, text: evidence.quote }]), pdf("contracts/terms-amendment.pdf", "conflicting-amendment", "text_available", [{ page: 1, text: evidence.quote }]), pdf("invoices/invoice.pdf", "invoice", "text_available", [{ page: 1, text: evidence.quote }])];
  await ingestDocumentSource(indexed.id, `Bearer ${indexed.key}`, batch(docs));
  const termsFacts: DocumentFact[] = [
    reservationFact(a.code, { reservationId: booked.id, monthlyRent: "125.00", currency: "EUR", contractNumber: "SYN-1", clientTaxId: "RO12345678" }),
    reservationFact(b.code, { reservationId: wrongCurrency.id, monthlyRent: "125.00", currency: "EUR" }),
    reservationFact(c.code), reservationFact(`${tag}-missing-location`), reservationFact(d.code),
    reservationFact(d.code, { reservationId: overlapBooked.id }),
    reservationFact(e.code, { reservationId: noonBooked.id }),
    reservationFact(f.code, { reservationId: truncatedBooked.id }),
  ];
  await verify(indexed.id, "contracts/terms.pdf", termsFacts, coo);
  await verify(indexed.id, "contracts/terms-amendment.pdf", [reservationFact(a.code, { reservationId: booked.id, monthlyRent: "130.00", currency: "EUR", contractNumber: "SYN-2", clientTaxId: "RO12345678" })], coo);
  await verify(indexed.id, "invoices/invoice.pdf", [
    { kind: "invoice", invoiceNumber, companyCode: "FOCUS_MEDIA", currency: "EUR", grossAmount: "1200.00", invoiceDate: "2090-01-02", clientTaxId: "RO87654321", evidence },
    { kind: "invoice", invoiceNumber: `${tag}-missing-invoice`, companyCode: "FOCUS_MEDIA", currency: "RON", grossAmount: "100.00", evidence },
  ], coo);
  const reconciled = await report(coo);
  const codes = new Set(reconciled.findings.map((finding) => finding.code));
  for (const code of ["BOOKING_PERIOD_DIFFERS", "BOOKING_MONTHLY_RENT_DIFFERS", "BOOKING_CURRENCY_DIFFERS", "BOOKING_NOT_FOUND", "LOCATION_NOT_FOUND", "RESERVATION_MATCH_AMBIGUOUS", "APP_BOOKING_OVERLAP", "DOCUMENT_CONTRACTS_OVERLAP", "INVOICE_GROSS_DIFFERS", "INVOICE_DATE_DIFFERS", "INVOICE_CLIENT_IDENTITY_DIFFERS", "INVOICE_NOT_FOUND"]) assert.ok(codes.has(code), `Expected deterministic finding: ${code}`);
  assert.ok(reconciled.findings.some((finding) => finding.code === "APP_BOOKING_OVERLAP" && finding.targetId === overlapBooked.id));
  assert.ok(reconciled.findings.some((finding) => finding.code === "DOCUMENT_CONTRACTS_OVERLAP" && finding.locationCode === a.code));
  assert.ok(reconciled.findings.some((finding) => finding.code === "APP_BOOKING_OVERLAP" && finding.targetId === noonBooked.id), "Legacy noon on inclusive final day overlaps");
  assert.ok(reconciled.findings.some((finding) => finding.code === "BOOKING_CONFLICT_SCOPE_TOO_LARGE" && finding.targetId === truncatedBooked.id), "Truncated conflicting candidate query cannot imply no overlap");
  assert.equal(reconciled.businessRowsModified, 0); assert.equal(await businessSnapshot(), businessBefore);
  const persisted = await prisma.documentAuditRun.findUniqueOrThrow({ where: { id: reconciled.id } });
  assert.equal(persisted.sourceSnapshotHash, reconciled.sourceSnapshotHash);
  assert.ok(reconciled.findings.filter((finding) => finding.severity === "difference" && finding.evidence).every((finding) => finding.sourceSha256.length === 64 && finding.evidence!.page === 1));
  checks.push("verified explicit period/rent/currency, missing inventory/booking/invoice, overlap ambiguity, fiscal amount/date/client differences with immutable report and evidence");
  checks.push("contradictory overlapping contracts and a second effective booking are reported even for an explicit reservation ID");
  checks.push("inclusive final-day noon overlap detected; candidate truncation emits mandatory review instead of a clean conclusion");
  checks.push("commercial location, reservation, client and invoice rows unchanged byte-for-byte");
  await scanOrderingRegressions(coo);

  const workspace = await getDocumentAuditWorkspace(director);
  const workspaceText = JSON.stringify(workspace);
  assert.ok(workspaceText.includes(evidence.quote), "Authorized workspace exposes reviewed evidence, making the secret-minimization check non-vacuous");
  for (const secret of [metadata.key, indexed.key, documentHash(metadata.key), documentHash(indexed.key), '"ingestKey"', '"ingestTokenHash"']) assert.equal(workspaceText.includes(secret), false, "Workspace must not expose bridge credentials or their hashes");
  const summaryText = JSON.stringify(await getDocumentAuditSummary(director));
  for (const privateValue of ["smb://synthetic.invalid/contracts", ...docs.map((doc) => doc.path), "contracts/metadata.pdf", "RO12345678", "12345678", "RO87654321", "87654321", evidence.quote, privateText, metadata.key, indexed.key, documentHash(metadata.key), documentHash(indexed.key)]) assert.equal(summaryText.includes(privateValue), false, "Aggregate summary must exclude source paths, private tax IDs, extracted text and credentials");
  checks.push("authorized workspace omits bridge keys/hashes; aggregate summaries omit NAS paths, tax IDs and private text");

  // Source updates revoke keys and invalidate completion; changed owner rights revoke delegation.
  const beforeConfig = await prisma.documentAuditSource.findUniqueOrThrow({ where: { id: indexed.id } });
  await updateDocumentSource({ id: indexed.id, expectedVersion: beforeConfig.version, state: "active", configuration: config(true) }, coo);
  await denied(() => ingestDocumentSource(indexed.id, `Bearer ${indexed.key}`, batch([])), "DOCUMENT_SOURCE_UNAUTHORIZED", 401);
  const changed = await prisma.documentAuditSource.findUniqueOrThrow({ where: { id: indexed.id } });
  assert.equal(changed.lastCompletedScanAt, null);
  const newKey = await issueDocumentIngestKey({ sourceId: indexed.id, expectedVersion: changed.version }, coo);
  const beforeScheduled = await prisma.documentAuditRun.count({ where: { requestedByUserId: { in: users } } });
  const reused = await runScheduledDocumentAudit();
  assert.ok("runId" in reused); assert.equal(reused.state, "recent_report_available"); assert.equal(reused.runId, reconciled.id);
  assert.equal(await prisma.documentAuditRun.count({ where: { requestedByUserId: { in: users } } }), beforeScheduled);
  const routeResponse = await scheduledAuditRoute(new NextRequest("http://localhost/api/cron/document-audit", { headers: { authorization: `Bearer ${cronSecret}` } }));
  assert.equal(routeResponse.status, 200);
  const routeResult = await routeResponse.json();
  assert.equal(routeResult.runId, reconciled.id); assert.equal(routeResult.businessRowsModified, 0);
  assert.equal(await prisma.documentAuditRun.count({ where: { requestedByUserId: { in: users } } }), beforeScheduled);
  assert.equal(await businessSnapshot(), businessBefore);
  // Expire only this run's synthetic report fixtures; never alter business rows.
  await prisma.documentAuditRun.updateMany({ where: { id: { in: runs } }, data: { createdAt: new Date(Date.now() - 6 * 60_000) } });
  const fresh = await runScheduledDocumentAudit();
  assert.ok("runId" in fresh); assert.notEqual(fresh.runId, reconciled.id); assert.equal(fresh.reportGenerated, true); assert.equal(fresh.businessRowsModified, 0);
  assert.equal(await prisma.documentAuditRun.count({ where: { requestedByUserId: { in: users } } }), beforeScheduled + 1);
  assert.equal(await businessSnapshot(), businessBefore);
  checks.push("scheduler and authenticated cron reuse a recent manual report; expired fixture snapshot produces one new report without commercial writes");
  await prisma.user.update({ where: { id: coo.id }, data: { tokenVersion: { increment: 1 } } });
  await denied(() => ingestDocumentSource(indexed.id, `Bearer ${newKey.ingestKey}`, batch([])), "DOCUMENT_SOURCE_UNAUTHORIZED", 401);
  await denied(() => getDocumentAuditSummary(coo), "DOCUMENT_AUDIT_SESSION_CHANGED", 401);
  const revokedCron = await runScheduledDocumentAudit();
  assert.equal(revokedCron.state, "delegation_revoked"); assert.equal(revokedCron.reportGenerated, false); assert.equal(revokedCron.businessRowsModified, 0);
  assert.equal(await prisma.documentAuditRun.count({ where: { requestedByUserId: { in: users } } }), beforeScheduled + 1);
  assert.equal(await businessSnapshot(), businessBefore);
  checks.push("scheduler rechecks owner tokenVersion and suspends revoked delegation without another report or business write");
  checks.push("configuration and owner credential changes revoke delegation; stale session refused");
  assert.equal(safeBaseReference("file://nas/contracts/"), "file://nas/contracts/");
  assert.equal(safeBaseReference("smb://nas/contracts/"), "smb://nas/contracts/");
  assert.equal(safeBaseReference("https://nas.example.invalid/contracts/"), "https://nas.example.invalid/contracts/");
  for (const reference of ["file:///C:/contracts/", "https://user:synthetic@nas.example.invalid/contracts/", "smb://user:synthetic@nas/contracts/", "https://nas.example.invalid/contracts/?token=synthetic", "file://nas/contracts/?token=synthetic", "https://nas.example.invalid/contracts/../private/", "file://nas/contracts/%2e%2e/private/", "smb://nas/contracts/../private/"]) assert.throws(() => safeBaseReference(reference), DocumentAuditError, `Unsafe NAS reference must be refused: ${reference}`);
  checks.push("network file:// NAS references accepted; local files, URL credentials/query and traversal refused");
  console.log(JSON.stringify({ ok: true, suite: "document-source-audit", checks }, null, 2));
}

main().finally(async () => {
  if (previousCronSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previousCronSecret;
  // Only IDs created by this run are deleted, in FK dependency order.
  const docs = await prisma.sourceDocument.findMany({ where: { sourceId: { in: sources } }, select: { id: true } });
  const versions = await prisma.sourceDocumentVersion.findMany({ where: { documentId: { in: docs.map((doc) => doc.id) } }, select: { id: true } });
  await prisma.documentFactReview.deleteMany({ where: { documentVersionId: { in: versions.map((version) => version.id) } } });
  await prisma.sourceDocumentVersion.deleteMany({ where: { id: { in: versions.map((version) => version.id) } } });
  await prisma.sourceDocument.deleteMany({ where: { id: { in: docs.map((doc) => doc.id) } } });
  await prisma.documentIngestBatch.deleteMany({ where: { sourceId: { in: sources } } });
  await prisma.documentAuditSource.deleteMany({ where: { id: { in: sources } } });
  await prisma.documentAuditRun.deleteMany({ where: { requestedByUserId: { in: users } } });
  await prisma.reservation.deleteMany({ where: { locationId: { in: locations } } });
  await prisma.location.deleteMany({ where: { id: { in: locations } } });
  await prisma.financialReportUpload.deleteMany({ where: { id: { in: uploads } } });
  await prisma.clientAccount.deleteMany({ where: { id: { in: clients } } });
  await prisma.category.deleteMany({ where: { id: { in: categories } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
}).catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Document source synthetic test failed"); process.exitCode = 1; });
