import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import * as documentAccess from "../src/lib/client-document-access";
import * as importService from "../src/lib/inventory-import";
import * as excelService from "../src/lib/import-excel";
import * as XLSX from "xlsx";
import { readImportRequestBody } from "../src/lib/import-request-body";
import { SpreadsheetSecurityError } from "../src/lib/secure-spreadsheet";
import { OPERATIONAL_PROOF_DOCUMENT_TYPE } from "../src/lib/operational-proof";
import { prisma } from "../src/lib/prisma";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
import { confirmInventoryImport, inventoryPayloadHash, inventoryOptions, previewInventoryImport, type InventoryImportRow } from "../src/lib/inventory-import";
import { evaluateDocumentAccess, resolveDocumentAccess } from "../src/lib/client-document-access";
import { securityHash } from "../src/lib/security-secrets";

loadEnvFile();
assertSyntheticEnvironment();
const url = new URL(process.env.DATABASE_URL || "");
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "This suite is restricted to local synthetic databases.");
assert.match(url.pathname, /^\/focus_preview_/);
const tag = `data-import-test-${Date.now()}`;
const actor = { id: `${tag}-user`, email: `${tag}@example.test` };
const options = inventoryOptions({});
const category = `${tag}-category`;
const inputRows: InventoryImportRow[] = [
  { code: `${tag}-A`, categoryName: category, data: { address: "new address", showInPublic: true, showInstallationCostPublic: true, latReal: null, latDisplay: null, lngDisplay: null, internalNotes: null, isFeatured: false } },
  { code: `${tag}-B`, categoryName: category, data: { address: "new hidden location", latReal: 44.4, lngReal: 26.1 } }
];
const hash = inventoryPayloadHash(JSON.stringify(inputRows));
const confirmations: string[] = [];
const attempts: string[] = [];
const require = createRequire(`${process.cwd()}/package.json`);

function route(file: string, mocks: Record<string, unknown>) {
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exported: Record<string, (...args: any[]) => Promise<Response>> = {};
  runInNewContext(compiled.outputText, { exports: exported, require: (name: string) => name in mocks ? mocks[name] : require(name), Buffer, Request, File, URL, Error, performance, setTimeout, clearTimeout });
  return exported;
}

async function preview(rows = inputRows, payloadHash = hash) { return previewInventoryImport({ rows, payloadHash, actor, options }); }
async function apply(token: string, rows = inputRows, payloadHash = hash) { return confirmInventoryImport({ rows, payloadHash, fileName: "synthetic-inventory.json", actor, options, previewToken: token }); }
async function mustReject(work: () => Promise<unknown>, pattern: RegExp) { await assert.rejects(work, (e: unknown) => e instanceof Error && pattern.test(e.message)); }

async function main() {
  await prisma.user.create({ data: { id: actor.id, email: actor.email, name: "Synthetic import tester", role: "COO", passwordHash: "synthetic-test-no-login", active: true } });
  const cat = await prisma.category.create({ data: { name: category, slug: category } });
  await prisma.location.create({ data: { id: `${tag}-existing`, code: inputRows[0].code, categoryId: cat.id, address: "old address", showInPublic: false, showInstallationCostPublic: false, showPricePublic: true, latReal: 45, lngReal: 24, latDisplay: 45.1, lngDisplay: 24.1, coordinateSource: "manual", gpsAuditStatus: "CORRECTED", internalNotes: "Keep this manual note", isFeatured: true } });

  const initial = await preview();
  assert.equal(initial.rows[0].changes.some((change) => ["status", "blockedReason", "availableFrom"].includes(change.field)), false, "preview must not promise writes to ignored legacy state");
  assert.equal(await prisma.importBatch.count({ where: { importedBy: actor.email } }), 0, "preview is read-only");
  assert.equal(await prisma.location.count({ where: { code: inputRows[1].code } }), 0);
  await mustReject(() => confirmInventoryImport({ rows: inputRows, payloadHash: hash, fileName: "x.json", actor: { ...actor, id: "another-actor" }, options, previewToken: initial.previewToken }), /sesiunea/);
  await mustReject(() => apply(initial.previewToken, inputRows, "different-file-hash"), /Fișierul/);
  await mustReject(() => apply(`${initial.previewToken}x`), /Preview-ul/);
  const [encoded] = initial.previewToken.split(".");
  const expired = JSON.parse(Buffer.from(encoded, "base64url").toString());expired.expiresAt = Date.now() - 1;
  const expiredEncoded = Buffer.from(JSON.stringify(expired)).toString("base64url");
  await mustReject(() => apply(`${expiredEncoded}.${securityHash("inventory-preview-v1", expiredEncoded)}`), /expirat/);
  await prisma.location.update({ where: { id: `${tag}-existing` }, data: { address: "changed after preview" } });
  await mustReject(() => apply(initial.previewToken), /s-a schimbat/);
  assert.equal(await prisma.importBatch.count({ where: { importedBy: actor.email } }), 0, "stale preview rolls back the batch");
  assert.equal(await prisma.location.count({ where: { code: inputRows[1].code } }), 0);

  const ready = await preview();
  const oldTransaction = prisma.$transaction;
  const runTransaction = oldTransaction.bind(prisma);
  // Deterministic database failure after the first actual write, not parser validation.
  (prisma as any).$transaction = (callback: any, txOptions: any) => runTransaction(async (tx) => callback(new Proxy(tx, { get(target, key) {
    if (key === "location") return new Proxy(target.location, { get(delegate, operation) {
      if (operation === "create") return async () => { throw new Error("injected second-row database failure"); };
      const value = Reflect.get(delegate, operation);return typeof value === "function" ? value.bind(delegate) : value;
    } });
    return Reflect.get(target, key);
  } })), txOptions);
  try { await mustReject(() => apply(ready.previewToken), /second-row/); }
  finally { (prisma as any).$transaction = oldTransaction; }
  assert.equal((await prisma.location.findUniqueOrThrow({ where: { id: `${tag}-existing` } })).address, "changed after preview", "first update rolled back");
  assert.equal(await prisma.location.count({ where: { code: inputRows[1].code } }), 0);
  assert.equal(await prisma.importBatch.count({ where: { importedBy: actor.email } }), 0);
  confirmations.push("mid-import database failure rolls back all rows and batch");

  const committed = await apply(ready.previewToken);
  const again = await apply(ready.previewToken);
  assert.equal(committed.batchId, again.batchId);
  const a = await prisma.location.findUniqueOrThrow({ where: { code: inputRows[0].code } });
  const b = await prisma.location.findUniqueOrThrow({ where: { code: inputRows[1].code } });
  assert.equal(a.address, "new address");assert.equal(a.showInPublic, false);assert.equal(a.showInstallationCostPublic, false);assert.equal(a.showPricePublic, true);
  assert.equal(a.latReal, 45);assert.equal(a.latDisplay, 45.1);assert.equal(a.lngDisplay, 24.1);assert.equal(a.internalNotes, "Keep this manual note");assert.equal(a.isFeatured, true);
  assert.equal(b.showInPublic, false);assert.equal(b.showInstallationCostPublic, false);assert.equal(b.showPricePublic, false);
  assert.equal(await prisma.auditLog.count({ where: { entityId: committed.batchId } }), 1, "retry has exactly one audit and business effect");
  confirmations.push("manual visibility, corrected coordinates, notes and featured flags survive reimport", "new locations are hidden by default", "confirmed retry returns the original result exactly once");

  const concurrentRows = [{ code: `${tag}-C`, categoryName: category, data: { address: "same intent" } }];
  const concurrentHash = inventoryPayloadHash(JSON.stringify(concurrentRows));
  const concurrentPreview = await preview(concurrentRows, concurrentHash);
  const same = await Promise.all([apply(concurrentPreview.previewToken, concurrentRows, concurrentHash), apply(concurrentPreview.previewToken, concurrentRows, concurrentHash)]);
  assert.equal(same[0].batchId, same[1].batchId);assert.equal(await prisma.location.count({ where: { code: concurrentRows[0].code } }), 1);
  confirmations.push("concurrent replay commits one complete batch");

  const otherRows = [{ code: inputRows[0].code, categoryName: category, data: { address: "competing changes" } }];
  const otherHash = inventoryPayloadHash(JSON.stringify(otherRows));
  const [p1, p2] = await Promise.all([preview(otherRows, otherHash), preview(otherRows, otherHash)]);
  const competing = await Promise.allSettled([apply(p1.previewToken, otherRows, otherHash), apply(p2.previewToken, otherRows, otherHash)]);
  assert.equal(competing.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(competing.filter((r) => r.status === "rejected").length, 1);
  confirmations.push("competing previews recheck current locked versions");

  const auditRows = [{ code: `${tag}-D`, categoryName: category, data: { address: "audit rollback" } }];const auditHash = inventoryPayloadHash(JSON.stringify(auditRows));const auditPreview = await preview(auditRows, auditHash);
  (prisma as any).$transaction = (callback: any, txOptions: any) => runTransaction(async (tx) => callback(new Proxy(tx, { get(target, key) {
    if (key === "auditLog") return new Proxy(target.auditLog, { get(delegate, operation) {
      if (operation === "create") return async () => { throw new Error("injected audit failure"); };
      const value = Reflect.get(delegate, operation);return typeof value === "function" ? value.bind(delegate) : value;
    } });return Reflect.get(target, key);
  } })), txOptions);
  try { await mustReject(() => apply(auditPreview.previewToken, auditRows, auditHash), /audit failure/); }
  finally { (prisma as any).$transaction = oldTransaction; }
  assert.equal(await prisma.location.count({ where: { code: auditRows[0].code } }), 0);
  confirmations.push("audit failure rolls back the inventory write");

  await prisma.clientAccount.createMany({ data: ["A", "B"].map((n) => ({ id: `${tag}-client-${n}`, companyName: `${tag} ${n}`, normalizedName: `${tag}-${n}`, accountOwnerUserId: actor.id })) });
  await prisma.campaign.createMany({ data: ["A", "B"].map((n) => ({ id: `${tag}-campaign-${n}`, clientId: `${tag}-client-${n}`, campaignName: `${tag} ${n}`, accountOwnerUserId: actor.id })) });
  const session = { ...actor, role: "COO" as const, name: "Synthetic tester", tokenVersion: 1, iat: 1, exp: 9999999999 };
  assert.equal(evaluateDocumentAccess(session, await resolveDocumentAccess({ clientId: `${tag}-client-A`, campaignId: `${tag}-campaign-B` }), "manage")?.status, 422);
  assert.equal(evaluateDocumentAccess(session, await resolveDocumentAccess({ clientId: `${tag}-client-A`, campaignId: `${tag}-campaign-A` }), "manage"), null);
  const sellerSession = { ...session, role: "SALES_AGENT" as const };
  assert.equal(evaluateDocumentAccess(sellerSession, await resolveDocumentAccess({ clientId: `${tag}-client-A`, campaignId: `${tag}-campaign-B` }), "manage")?.status, 422);
  assert.equal(evaluateDocumentAccess({ ...sellerSession, id: "foreign-seller" }, await resolveDocumentAccess({ clientId: `${tag}-client-A` }), "manage")?.status, 403);
  const start = new Date("2027-01-01T00:00:00.000Z"), end = new Date("2027-02-01T00:00:00.000Z");
  await prisma.reservation.create({ data: { id: `${tag}-reservation-B`, locationId: a.id, clientId: `${tag}-client-B`, campaignId: `${tag}-campaign-B`, clientName: "Synthetic B", periodStart: start, periodEnd: end, sellerUserId: actor.id } });
  await prisma.billingItem.create({ data: { id: `${tag}-billing-B`, reservationId: `${tag}-reservation-B`, clientId: `${tag}-client-B`, billingPeriodStart: start, billingPeriodEnd: end, invoiceDate: start, dueDate: end, currency: "RON", billingRule: "MONTHLY" } });
  await prisma.financialReportUpload.create({ data: { id: `${tag}-upload`, originalFileName: "synthetic.json", fileHash: `${tag}-hash` } });
  await prisma.financialReceivable.create({ data: { id: `${tag}-receivable-B`, uploadId: `${tag}-upload`, companyName: "Synthetic B", clientId: `${tag}-client-B`, campaignId: `${tag}-campaign-B`, billingItemId: `${tag}-billing-B` } });
  for (const links of [
    { campaignId: `${tag}-campaign-A`, reservationId: `${tag}-reservation-B` },
    { clientId: `${tag}-client-A`, billingItemId: `${tag}-billing-B` },
    { clientId: `${tag}-client-A`, financialReceivableId: `${tag}-receivable-B` }
  ]) assert.equal(evaluateDocumentAccess(session, await resolveDocumentAccess(links), "manage")?.status, 422);
  assert.equal(evaluateDocumentAccess(session, await resolveDocumentAccess({ clientId: `${tag}-client-B`, campaignId: `${tag}-campaign-B`, reservationId: `${tag}-reservation-B`, billingItemId: `${tag}-billing-B`, financialReceivableId: `${tag}-receivable-B` }), "manage"), null);
  confirmations.push("document matrix rejects same-owner, privileged, reservation, billing and invoice contradictions; foreign seller is denied");

  const baseMocks = {
    "next/server": { NextRequest, NextResponse },
    "@/lib/auth": { requireAnyPermission: async () => ({ session }), requirePermission: async () => ({ session }) },
    "@/lib/prisma": { prisma },
    "@/lib/client-document-access": documentAccess,
    "@/lib/operational-proof": { OPERATIONAL_PROOF_DOCUMENT_TYPE },
    "@/lib/import-request-body": { readImportRequestBody },
    "@/lib/inventory-import": importService,
    "@/lib/import-excel": excelService,
    "@/lib/secure-spreadsheet": { SpreadsheetSecurityError },
    "@/lib/observability": { emitStructuredLog: () => {}, requestCorrelationId: () => "synthetic-import", safeErrorCode: () => "SYNTHETIC_ERROR" }
  };
  const upload = route("src/app/api/admin/client-documents/route.ts", baseMocks);
  const documentForm = (client: string, campaign: string) => { const form = new FormData();form.set("clientId", client);form.set("campaignId", campaign);form.set("storageUrl", "https://example.test/synthetic.pdf");return form; };
  const mismatch = await upload.POST(new NextRequest("http://localhost/api/admin/client-documents", { method: "POST", body: documentForm(`${tag}-client-A`, `${tag}-campaign-B`) }));
  assert.equal(mismatch.status, 422);assert.equal(await prisma.clientDocument.count({ where: { uploadedByUserId: actor.id } }), 0);
  const uploaded = await upload.POST(new NextRequest("http://localhost/api/admin/client-documents", { method: "POST", body: documentForm(`${tag}-client-A`, `${tag}-campaign-A`) }));
  assert.equal(uploaded.status, 201);const createdDoc = (await uploaded.json()).document;assert.equal(createdDoc.storageUrl, undefined);
  const archive = route("src/app/api/admin/client-documents/[id]/route.ts", baseMocks);
  const archiveRequest = () => archive.PATCH(new NextRequest(`http://localhost/api/admin/client-documents/${createdDoc.id}`, { method: "PATCH" }), { params: Promise.resolve({ id: createdDoc.id }) });
  (prisma as any).$transaction = (callback: any, txOptions: any) => runTransaction(async (tx) => callback(new Proxy(tx, { get(target, key) {
    if (key === "auditLog") return { create: async () => { throw new Error("injected document audit failure"); } };
    return Reflect.get(target, key);
  } })), txOptions);
  try { assert.equal((await archiveRequest()).status, 503); }
  finally { (prisma as any).$transaction = oldTransaction; }
  assert.equal((await prisma.clientDocument.findUniqueOrThrow({ where: { id: createdDoc.id } })).status, "active");
  const archived = await archiveRequest();assert.equal(archived.status, 200);assert.match(archived.headers.get("Cache-Control") || "", /no-store/);
  assert.deepEqual(Object.keys((await archived.json()).document).sort(), ["id", "status"]);
  assert.equal(await prisma.auditLog.count({ where: { entityId: createdDoc.id } }), 2);
  confirmations.push("real document routes reject contradictory upload with zero writes; archive and audit roll back together");

  const json = route("src/app/api/import/json/route.ts", baseMocks);
  const jsonPayload = { locations: [{ code: `${tag}-json-route`, categoryName: category, address: "Synthetic JSON route" }] };
  const jsonRequest = (body: unknown) => new NextRequest("http://localhost/api/import/json", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const jsonPreviewResponse = await json.POST(jsonRequest(jsonPayload));assert.equal(jsonPreviewResponse.status, 200);
  const jsonPreview = (await jsonPreviewResponse.json()).preview;
  assert.equal(await prisma.location.count({ where: { code: `${tag}-json-route` } }), 0);
  assert.equal((await json.POST(jsonRequest({ ...jsonPayload, action: "confirm", previewToken: jsonPreview.previewToken }))).status, 200);
  assert.equal((await json.POST(jsonRequest({ locations: [], action: "confirm" }))).status, 409, "a confirm request without a reviewed token is refused");
  await assert.rejects(() => readImportRequestBody(new Request("http://localhost/import", { method: "POST", body: "1234", headers: { "content-length": "1" } }), 3), (error: unknown) => error instanceof importService.InventoryImportError && error.status === 413);
  await assert.rejects(() => readImportRequestBody(new Request("http://localhost/import", { method: "POST", body: "1234" }), 3), (error: unknown) => error instanceof importService.InventoryImportError && error.status === 413);

  const excel = route("src/app/api/import/excel/route.ts", baseMocks);
  const book = XLSX.utils.book_new();XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["nr", "address", "city"], [`${tag}-xlsx-route`, "Synthetic Excel route", "Bucuresti"]]), category.slice(0, 31));
  const workbook = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const excelRequest = (action: string, previewToken?: string) => { const form = new FormData();form.set("file", new File([workbook], "synthetic.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));form.set("action", action);if (previewToken) form.set("previewToken", previewToken);return new NextRequest("http://localhost/api/import/excel", { method: "POST", body: form }); };
  const excelPreviewResponse = await excel.POST(excelRequest("preview"));assert.equal(excelPreviewResponse.status, 200, await excelPreviewResponse.clone().text());
  const excelPreview = (await excelPreviewResponse.json()).preview;
  const excelConfirmed = await excel.POST(excelRequest("confirm", excelPreview.previewToken));assert.equal(excelConfirmed.status, 200, await excelConfirmed.clone().text());
  assert.equal((await excel.POST(excelRequest("confirm", excelPreview.previewToken))).status, 200);
  confirmations.push("actual JSON and multipart Excel routes require read-only preview and confirm; replay returns completed result");
  console.log(JSON.stringify({ ok: true, database: url.pathname.slice(1), confirmations, attempts }, null, 2));
}

void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: actor.id } });
  await prisma.importBatch.deleteMany({ where: { importedBy: actor.email } });
  await prisma.clientDocument.deleteMany({ where: { uploadedByUserId: actor.id } });
  await prisma.financialReceivable.deleteMany({ where: { id: { startsWith: tag } } });
  await prisma.financialReportUpload.deleteMany({ where: { id: { startsWith: tag } } });
  await prisma.billingItem.deleteMany({ where: { id: { startsWith: tag } } });
  await prisma.reservation.deleteMany({ where: { id: { startsWith: tag } } });
  await prisma.campaign.deleteMany({ where: { id: { startsWith: tag } } });
  await prisma.clientAccount.deleteMany({ where: { id: { startsWith: tag } } });
  await prisma.location.deleteMany({ where: { code: { startsWith: tag } } });
  await prisma.category.deleteMany({ where: { name: { in: [category, category.slice(0, 31)] } } });
  await prisma.user.deleteMany({ where: { id: actor.id } });
  await prisma.$disconnect();
});
