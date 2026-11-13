import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import mysql, { type Connection } from "mysql2/promise";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { ADMIN_COOKIE, createSessionToken, type AuthSession } from "../src/lib/auth";
import { operationStatus } from "../src/lib/operation-status";
import { operationalProofNotes, OPERATIONAL_PROOF_DOCUMENT_TYPE } from "../src/lib/operational-proof";
import { prepareOperationalProofImage, readOperationalProofForm } from "../src/lib/operational-proof-image";
import { OperationalProofUploadError, OPERATIONAL_PROOF_REQUEST_MAX_BYTES, OPERATIONAL_PROOF_MAX_EDGE, OPERATIONAL_PROOF_OPTIMIZED_FILE_BYTES } from "../src/lib/operational-proof-upload-limits";
import { POST } from "../src/app/api/admin/operational/tasks/complete/route";
import { GET as downloadProof } from "../src/app/api/admin/operational/proof-photos/[id]/route";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";

loadEnvFile(); assertSyntheticEnvironment();
const url = new URL(process.env.DATABASE_URL!);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !/^\/focus_(preview|test)_/.test(url.pathname) || process.env.VERCEL_ENV === "production") throw new Error("A local synthetic database is required");
const tag = "proof-upload-" + randomUUID();
const base = "http://localhost:3147";
const originalMode = process.env.MFA_ENFORCEMENT_MODE, originalAssignment = process.env.OPERATIONAL_ASSIGNMENT_ENABLED;
process.env.MFA_ENFORCEMENT_MODE = "off"; process.env.OPERATIONAL_ASSIGNMENT_ENABLED = "true";
const ids: { users: string[]; reservations: string[]; location?: string; category?: string; trigger?: string } = { users: [], reservations: [] };
let groups = 0;
let ddl: Connection | null = null;
const pass = (name: string) => { groups++; console.log("✓ " + name); };
const file = (buffer: Buffer, name = "proof.png", type = "image/png") => new File([new Uint8Array(buffer)], name, { type });
async function user(role: AuthSession["role"], suffix: string): Promise<AuthSession> {
  const row = await prisma.user.create({ data: { name: `${tag}-${suffix}`, email: `${tag}-${suffix}@example.invalid`, role, passwordHash: "unused-synthetic" } });
  ids.users.push(row.id); return { ...row, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
}
async function request(actor: AuthSession, reservationId: string, kind: string, files: File[], operationTaskId?: string, origin = base) {
  const form = new FormData(); form.set("reservationId", reservationId); form.set("kind", kind);
  if (operationTaskId) form.set("operationTaskId", operationTaskId);
  form.set("completionNote", "Synthetic proof verification");
  for (const item of files) form.append("files", item);
  return POST(new NextRequest(base + "/api/admin/operational/tasks/complete", { method: "POST", headers: { origin, cookie: `${ADMIN_COOKIE}=${createSessionToken(actor)}` }, body: form }));
}
async function main() {
  const png = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: "#e9c95b" } }).png().withMetadata({ exif: { IFD0: { ImageDescription: "synthetic source metadata" } } }).toBuffer();
  const normalized = await prepareOperationalProofImage(file(png));
  const decoded = Buffer.from(normalized.storageUrl.split(",")[1], "base64"), meta = await sharp(decoded).metadata();
  assert.equal(meta.format, "jpeg"); assert.ok((meta.width || 0) <= OPERATIONAL_PROOF_MAX_EDGE); assert.ok(normalized.fileSize <= OPERATIONAL_PROOF_OPTIMIZED_FILE_BYTES); assert.equal(meta.exif, undefined); assert.equal(normalized.fileType, "image/jpeg");
  pass("raster bytes are decoded, resized and stored as a bounded JPEG without source EXIF");
  await assert.rejects(prepareOperationalProofImage(file(Buffer.from("<svg onload=alert(1) />"), "fake.jpg", "image/jpeg")), OperationalProofUploadError);
  await assert.rejects(prepareOperationalProofImage(file(png, "wrong-mime.jpg", "image/jpeg")), OperationalProofUploadError);
  const giant = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(prepareOperationalProofImage(file(giant)), OperationalProofUploadError);
  pass("active content, mismatched MIME and decoded pixel bombs are refused");

  await assert.rejects(readOperationalProofForm(new NextRequest(base, { method: "POST", headers: { "content-type": "text/plain" }, body: "invalid" })), (e: unknown) => e instanceof OperationalProofUploadError && e.status === 415);
  const declared = new NextRequest(base, { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test", "content-length": String(OPERATIONAL_PROOF_REQUEST_MAX_BYTES + 1) }, body: "small" });
  await assert.rejects(readOperationalProofForm(declared), (e: unknown) => e instanceof OperationalProofUploadError && e.status === 413);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(OPERATIONAL_PROOF_REQUEST_MAX_BYTES + 1)); }, cancel() { cancelled = true; } });
  const streamed = new NextRequest(new Request(base, { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test" }, body: stream, duplex: "half" } as RequestInit));
  await assert.rejects(readOperationalProofForm(streamed), (e: unknown) => e instanceof OperationalProofUploadError && e.status === 413); assert.equal(cancelled, true);
  const form = new FormData(); form.set("kind", "decoration"); form.append("files", file(png));
  const parsed = await readOperationalProofForm(new NextRequest(base, { method: "POST", body: form })); assert.equal(parsed.get("kind"), "decoration"); assert.equal((parsed.get("files") as File).size, png.length);
  pass("multipart requests are bounded while streaming, including absent Content-Length");

  const owner = await user("SALES_AGENT", "owner"), field = await user("FIELD_OPERATOR", "field"), foreign = await user("FIELD_OPERATOR", "foreign"), manager = await user("COO", "manager");
  const category = await prisma.category.create({ data: { name: tag, slug: tag } }); ids.category = category.id;
  const location = await prisma.location.create({ data: { code: tag, categoryId: category.id, type: "Panou", city: "Synthetic", lifecycleStatus: "ACTIVE", showInPublic: false } }); ids.location = location.id;
  const rental = async (suffix: string) => { const r = await prisma.reservation.create({ data: { locationId: location.id, clientName: `${tag}-${suffix}`, status: "BOOKED", ownerId: owner.id, sellerUserId: owner.id, amount: 777, monthlyRentShare: 777, currency: "EUR", contractNumber: "PRIVATE-SYNTHETIC-CONTRACT", periodStart: new Date("2092-01-01"), periodEnd: new Date("2092-12-31"), installationDate: new Date("2092-01-01"), neutralizationDate: new Date("2092-12-31") } }); ids.reservations.push(r.id); return r; };
  const proofData = (reservationId: string, kind: "decoration" | "neutralization", index: number) => ({ reservationId, documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE, fileName: `${tag}-${index}.jpg`, fileType: "image/jpeg", fileSize: decoded.length, storageUrl: normalized.storageUrl, notes: operationalProofNotes({ kind }), uploadedByUserId: owner.id, status: "active", expiryDate: new Date(Date.now() + 86400000) });
  const independent = await rental("independent");
  await prisma.clientDocument.createMany({ data: Array.from({ length: 10 }, (_, index) => proofData(independent.id, "decoration", index)) });
  await prisma.clientDocument.createMany({ data: Array.from({ length: 45 }, (_, index) => ({ ...proofData(independent.id, "decoration", index + 10), notes: operationalProofNotes({ kind: "decoration", taskId: `synthetic-past-task-${index}` }) })) });
  const differentTask = await request(owner, independent.id, "neutralization", [file(png)]);
  assert.equal(differentTask.status, 200); const independentReceipt = await differentTask.json(); assert.equal(independentReceipt.proofPhotoCount, 1);
  assert.equal(await prisma.clientDocument.count({ where: { reservationId: independent.id } }), 56);
  assert.equal(independentReceipt.reservation.operationProofPhotos.length, 56, "a rental-wide forty-photo preview cannot conceal other task evidence");
  assert.equal(operationStatus((await prisma.reservation.findUniqueOrThrow({ where: { id: independent.id } })).productionNotes, "neutralization"), "DONE");
  pass("ten photos on one task do not consume the quota of another task on the same rental");

  const capped = await rental("capped");
  await prisma.clientDocument.createMany({ data: Array.from({ length: 10 }, (_, index) => proofData(capped.id, "decoration", index)) });
  const capResponse = await request(owner, capped.id, "decoration", [file(png)]);
  assert.equal(capResponse.status, 400); assert.equal(await prisma.clientDocument.count({ where: { reservationId: capped.id } }), 10); assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: capped.id } })).productionNotes, null);
  pass("the actual task quota is enforced without partial photo or status writes");

  const assigned = await rental("assigned");
  const task = await prisma.operationTask.create({ data: { reservationId: assigned.id, locationId: location.id, kind: "DECORATION", status: "NEW", source: "MANUAL", dedupeKey: `reservation:${assigned.id}:DECORATION:base`, assignedToUserId: field.id, scheduledFor: new Date("2092-01-01") } });
  const noProof = await request(field, assigned.id, "decoration", [], task.id); assert.equal(noProof.status, 400); assert.equal((await prisma.operationTask.findUniqueOrThrow({ where: { id: task.id } })).status, "NEW");
  const denied = await request(foreign, assigned.id, "decoration", [file(png)], task.id); assert.equal(denied.status, 403); assert.equal(await prisma.clientDocument.count({ where: { reservationId: assigned.id } }), 0);
  const completed = await request(field, assigned.id, "decoration", [file(png)], task.id); assert.equal(completed.status, 200);
  const fieldReceipt = await completed.json(); assert.equal(fieldReceipt.status, "DONE"); assert.equal(fieldReceipt.proofPhotos.length, 1); assert.equal(fieldReceipt.reservation, undefined);
  for (const key of ["amount", "monthlyRentShare", "monthlyRentTotal", "contractNumber", "paymentTermDays", "currency", "PRIVATE-SYNTHETIC-CONTRACT"]) assert.equal(JSON.stringify(fieldReceipt).includes(key), false, `field receipt must not leak ${key}`);
  assert.equal((await prisma.operationTask.findUniqueOrThrow({ where: { id: task.id } })).status, "DONE");
  assert.equal(operationStatus((await prisma.reservation.findUniqueOrThrow({ where: { id: assigned.id } })).productionNotes, "decoration"), "DONE");
  assert.equal(await prisma.auditLog.count({ where: { action: "operation.decoration.complete_with_proof", entityId: assigned.id } }), 1);
  pass("assigned field completion persists proof and task state with a minimal authorized receipt");
  const replay = await request(field, assigned.id, "decoration", [file(png)], task.id); assert.equal(replay.status, 200); assert.equal((await replay.json()).alreadyCompleted, true);
  assert.equal(await prisma.clientDocument.count({ where: { reservationId: assigned.id } }), 1); assert.equal(await prisma.auditLog.count({ where: { action: "operation.decoration.complete_with_proof", entityId: assigned.id } }), 1);
  pass("a completion retry produces one proof set and one committed completion event");

  const manual = await rental("manual-redecorations");
  await prisma.clientDocument.createMany({ data: Array.from({ length: 10 }, (_, index) => proofData(manual.id, "decoration", index)) });
  const [manualA, manualB] = await Promise.all([field, foreign].map((executor, index) => prisma.operationTask.create({ data: { reservationId: manual.id, locationId: location.id, kind: "REDECORATION", status: "NEW", source: "MANUAL", dedupeKey: `${tag}-manual-${index}`, assignedToUserId: executor.id, scheduledFor: new Date("2092-02-01") } })));
  const a = await request(field, manual.id, "decoration", [file(png)], manualA.id), b = await request(foreign, manual.id, "decoration", [file(png)], manualB.id);
  assert.equal(a.status, 200); assert.equal(b.status, 200); const proofA = (await a.json()).proofPhotos[0];
  assert.equal(operationStatus((await prisma.reservation.findUniqueOrThrow({ where: { id: manual.id } })).productionNotes, "decoration"), "NEW", "a manual redecoration does not finish the base installation");
  assert.equal(await prisma.clientDocument.count({ where: { reservationId: manual.id } }), 12);
  const readRequest = (actor: AuthSession) => new NextRequest(`${base}/api/admin/operational/proof-photos/${proofA.id}`, { headers: { cookie: `${ADMIN_COOKIE}=${createSessionToken(actor)}` } });
  const ownPhoto = await downloadProof(readRequest(field), { params: Promise.resolve({ id: proofA.id }) });
  assert.equal(ownPhoto.status, 200); const otherPhoto = await downloadProof(readRequest(foreign), { params: Promise.resolve({ id: proofA.id }) }); assert.equal(otherPhoto.status, 403);
  pass("separate relational redecorations retain independent proof identity, quota and download authorization");

  const broken = await rental("broken");
  const brokenResponse = await request(owner, broken.id, "decoration", [file(Buffer.from("invalid"))]); assert.equal(brokenResponse.status, 400); assert.equal(await prisma.clientDocument.count({ where: { reservationId: broken.id } }), 0); assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: broken.id } })).productionNotes, null);
  const csrfResponse = await request(owner, broken.id, "decoration", [file(png)], undefined, "https://foreign.example.invalid"); assert.equal(csrfResponse.status, 403);
  pass("invalid photos and cross-origin completion never finalize a task");

  const rollback = await rental("rollback");
  ids.trigger = "proof_atomic_" + randomUUID().replaceAll("-", "");
  ddl = await mysql.createConnection({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)) });
  await ddl.query(`CREATE TRIGGER ${ids.trigger} BEFORE INSERT ON portfolio_audit_logs FOR EACH ROW BEGIN IF NEW.entityId = '${rollback.id}' AND NEW.action = 'operation.decoration.complete_with_proof' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SYNTHETIC_PROOF_AUDIT_FAILURE'; END IF; END`);
  const failed = await request(manager, rollback.id, "decoration", [file(png)]); assert.equal(failed.status, 503);
  assert.equal(await prisma.clientDocument.count({ where: { reservationId: rollback.id } }), 0); assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: rollback.id } })).productionNotes, null);
  assert.equal(await prisma.auditLog.count({ where: { action: "reservation.production_notes.committed", entityId: rollback.id } }), 0);
  await ddl.query(`DROP TRIGGER ${ids.trigger}`); ids.trigger = undefined;
  pass("a durable-audit failure rolls back the proof, task completion and operation notes atomically");
  console.log(JSON.stringify({ ok: true, groups, environment: "isolated local synthetic", noProductionWrites: true }));
}

main().finally(async () => {
  if (ids.trigger && ddl) await ddl.query(`DROP TRIGGER IF EXISTS ${ids.trigger}`);
  if (ddl) await ddl.end();
  await prisma.appNotification.deleteMany({ where: { OR: [{ userId: { in: ids.users } }, ...ids.reservations.map((id) => ({ entityId: { startsWith: `${id}:` } }))] } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: ids.users } }, { entityId: { in: ids.reservations } }] } });
  await prisma.operationTask.deleteMany({ where: { reservationId: { in: ids.reservations } } });
  await prisma.clientDocument.deleteMany({ where: { reservationId: { in: ids.reservations } } });
  await prisma.reservation.deleteMany({ where: { id: { in: ids.reservations } } });
  await prisma.location.deleteMany({ where: { id: ids.location || "never-created" } });
  await prisma.category.deleteMany({ where: { id: ids.category || "never-created" } });
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  process.env.MFA_ENFORCEMENT_MODE = originalMode; process.env.OPERATIONAL_ASSIGNMENT_ENABLED = originalAssignment;
  await prisma.$disconnect();
}).catch((error) => { console.error(error); process.exitCode = 1; });
