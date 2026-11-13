import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../src/lib/prisma";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
import * as mutations from "../src/lib/location-mutations";
import * as locations from "../src/lib/locations";

loadEnvFile();
assertSyntheticEnvironment();
const database = new URL(process.env.DATABASE_URL || "");
assert.ok(["127.0.0.1", "localhost"].includes(database.hostname), "Only local synthetic databases are authorized for this test.");
assert.match(database.pathname, /^\/focus_preview_/);
const tag = `location-tx-${Date.now()}`;
const actor: mutations.LocationMutationActor = { id: `${tag}-user`, email: `${tag}@example.test`, role: "COO", tokenVersion: 3, sessionId: `${tag}-session`, exp: Math.floor(Date.now() / 1000) + 3600 };
const code = `${tag}-location`;
const categoryName = `${tag}-category`;
const originalTransaction = prisma.$transaction;
const runTransaction = originalTransaction.bind(prisma);
const proofs: string[] = [];
const require = createRequire(`${process.cwd()}/package.json`);

async function rejected(work: () => Promise<unknown>, status: number) {
  await assert.rejects(work, (error: unknown) => error instanceof mutations.LocationMutationError && error.status === status);
}

async function auditFailure(work: () => Promise<unknown>) {
  (prisma as any).$transaction = (callback: any, options: any) => runTransaction(async (tx) => callback(new Proxy(tx, { get(target, key) {
    if (key === "auditLog") return { create: async () => { throw new Error("synthetic audit storage failure"); } };
    return Reflect.get(target, key);
  } })), options);
  try { await assert.rejects(work, /synthetic audit storage failure/); }
  finally { (prisma as any).$transaction = originalTransaction; }
}

function route(file: string) {
  const mocks: Record<string, unknown> = {
    "next/server": { NextRequest, NextResponse }, "@/lib/prisma": { prisma },
    "@/lib/locations": locations, "@/lib/location-mutations": mutations,
    "@/lib/auth": { requirePermission: async () => ({ session: actor }), requireAnyPermission: async () => ({ session: actor }) },
    "@/lib/observability": { observeRoute: () => {}, setObservabilityRole: () => {} }
  };
  const exports: Record<string, (...args: any[]) => Promise<Response>> = {};
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  runInNewContext(compiled.outputText, { exports, require: (name: string) => name in mocks ? mocks[name] : require(name), Buffer, URL, Error, SyntaxError });
  return exports;
}

async function main() {
  await prisma.user.create({ data: { id: actor.id, email: actor.email!, name: "Synthetic inventory test", role: actor.role, tokenVersion: actor.tokenVersion, passwordHash: "synthetic-no-login", active: true } });
  await prisma.authSessionRecord.create({ data: { id: actor.sessionId!, userId: actor.id, expiresAt: new Date(Date.now() + 3600000) } });
  const input = { code, categoryName, address: "Original synthetic address", showInPublic: false, showPricePublic: true, showInstallationCostPublic: false, lifecycleStatus: "ARCHIVED", isFeatured: true, isPremium: true, gpsAuditStatus: "CORRECTED", benefits: ["keep"], internalNotes: "keep synthetic note", latReal: 45, lngReal: 24, imageUrls: ["https://example.test/synthetic.png"], productionSketchUrl: "https://example.test/synthetic-sketch.png" };
  await auditFailure(() => mutations.createLocation(input, actor));
  assert.equal(await prisma.location.count({ where: { code } }), 0);
  assert.equal(await prisma.category.count({ where: { name: categoryName } }), 0, "category creation must roll back with the location/audit");
  proofs.push("CREATE rollback includes category, location and gallery when durable audit fails");
  const original = await mutations.createLocation(input, actor);
  assert.equal(original.images.length, 2);
  assert.equal(await prisma.auditLog.count({ where: { userId: actor.id, action: "location.create" } }), 1);

  await auditFailure(() => mutations.updateLocation(original.id, { address: "rollback", categoryName: `${tag}-rollback-category`, imageUrls: ["https://example.test/replacement.png"], productionSketchUrl: null }, actor));
  const kept = await prisma.location.findUniqueOrThrow({ where: { id: original.id }, include: { images: true } });
  assert.equal(kept.address, input.address);assert.equal(kept.images.length, 2);assert.equal(kept.categoryId, original.categoryId);
  assert.equal(await prisma.category.count({ where: { name: `${tag}-rollback-category` } }), 0);
  await mutations.updateLocation(original.id, { address: "Successful edit" }, actor);
  const patched = await prisma.location.findUniqueOrThrow({ where: { id: original.id }, include: { images: true } });
  assert.equal(patched.showInPublic, false);assert.equal(patched.showPricePublic, true);assert.equal(patched.showInstallationCostPublic, false);
  assert.equal(patched.isFeatured, true);assert.equal(patched.isPremium, true);assert.equal(patched.lifecycleStatus, "ARCHIVED");assert.equal(patched.gpsAuditStatus, "CORRECTED");
  assert.deepEqual(patched.benefits, ["keep"]);assert.equal(patched.internalNotes, input.internalNotes);assert.equal(patched.images.length, 2);assert.equal(patched.latReal, 45);
  proofs.push("UPDATE rollback restores category/gallery; Zod 4 PATCH omission preserves every defaulted/manual field");

  await auditFailure(() => mutations.duplicateLocation(original.id, actor));
  assert.equal(await prisma.location.count({ where: { code: { startsWith: tag } } }), 1);
  const copies = await Promise.all([mutations.duplicateLocation(original.id, actor), mutations.duplicateLocation(original.id, actor)]);
  assert.notEqual(copies[0].code, copies[1].code);assert.equal(copies[0].images.length, 2);assert.equal(copies[0].showInPublic, false);
  await auditFailure(() => mutations.deleteLocation(copies[0].id, actor));
  assert.equal(await prisma.location.count({ where: { id: copies[0].id } }), 1);
  assert.equal(await prisma.image.count({ where: { locationId: copies[0].id } }), 2, "cascaded images must roll back with a failed delete audit");
  await mutations.deleteLocation(copies[0].id, actor);
  assert.equal(await prisma.location.count({ where: { id: copies[0].id } }), 0);assert.equal(await prisma.image.count({ where: { locationId: copies[0].id } }), 0);
  proofs.push("DUPLICATE and DELETE have no partial/cascaded effects on audit failure; simultaneous duplicates get unique codes");

  const commands = (candidate: mutations.LocationMutationActor) => [
    () => mutations.createLocation({ code: `${tag}-denied`, categoryName }, candidate),
    () => mutations.updateLocation(original.id, { address: "unauthorized" }, candidate),
    () => mutations.duplicateLocation(original.id, candidate),
    () => mutations.deleteLocation(original.id, candidate)
  ];
  const auditCount = await prisma.auditLog.count({ where: { userId: actor.id } });
  await prisma.user.update({ where: { id: actor.id }, data: { tokenVersion: 4 } });
  for (const command of commands(actor)) await rejected(command, 401);
  const listing = route("src/app/api/locations/route.ts"), detail = route("src/app/api/locations/[id]/route.ts");
  const context = { params: Promise.resolve({ id: original.id }) };
  const staleResponses = await Promise.all([
    listing.POST(new NextRequest("http://localhost/api/locations", { method: "POST", body: JSON.stringify({ code: `${tag}-denied`, categoryName }) })),
    detail.PATCH(new NextRequest(`http://localhost/api/locations/${original.id}`, { method: "PATCH", body: JSON.stringify({ address: "denied" }) }), context),
    detail.POST(new NextRequest(`http://localhost/api/locations/${original.id}?action=duplicate`, { method: "POST" }), context),
    detail.DELETE(new NextRequest(`http://localhost/api/locations/${original.id}`, { method: "DELETE" }), context)
  ]);
  assert.deepEqual(staleResponses.map((response) => response.status), [401, 401, 401, 401], "each route forwards its previously authorized actor for a fresh transactional check");
  await prisma.user.update({ where: { id: actor.id }, data: { tokenVersion: 3, active: false } });
  for (const command of commands(actor)) await rejected(command, 401);
  await prisma.user.update({ where: { id: actor.id }, data: { active: true, role: "D_CEO" } });
  for (const command of commands(actor)) await rejected(command, 401);
  for (const command of commands({ ...actor, role: "D_CEO" })) await rejected(command, 403);
  await prisma.user.update({ where: { id: actor.id }, data: { role: "COO" } });
  await prisma.authSessionRecord.update({ where: { id: actor.sessionId! }, data: { revokedAt: new Date() } });
  for (const command of commands(actor)) await rejected(command, 401);
  await prisma.authSessionRecord.update({ where: { id: actor.sessionId! }, data: { revokedAt: null, expiresAt: new Date(Date.now() - 1000) } });
  for (const command of commands(actor)) await rejected(command, 401);
  await prisma.authSessionRecord.update({ where: { id: actor.sessionId! }, data: { expiresAt: new Date(Date.now() + 3600000) } });
  assert.equal(await prisma.auditLog.count({ where: { userId: actor.id } }), auditCount);
  assert.equal((await prisma.location.findUniqueOrThrow({ where: { id: original.id } })).address, "Successful edit");
  assert.equal(await prisma.location.count({ where: { code: `${tag}-denied` } }), 0);
  proofs.push("all commands and actual routes reject stale token, disabled actor, changed role, missing permission and revoked/expired registered sessions before writes");

  const createReservation = () => prisma.reservation.create({ data: { id: `${tag}-reservation`, locationId: original.id, clientName: "Synthetic history", status: "CANCELLED", periodStart: new Date("2028-01-01"), periodEnd: new Date("2028-02-01") } });
  await createReservation();await rejected(() => mutations.deleteLocation(original.id, actor), 409);await prisma.reservation.delete({ where: { id: `${tag}-reservation` } });
  await prisma.operationTask.create({ data: { id: `${tag}-task`, locationId: original.id, kind: "MAINTENANCE", status: "ARCHIVED" } });
  await rejected(() => mutations.deleteLocation(original.id, actor), 409);await prisma.operationTask.delete({ where: { id: `${tag}-task` } });
  await prisma.gpsAuditLog.create({ data: { id: `${tag}-gps`, locationId: original.id, status: "CORRECTED" } });
  await rejected(() => mutations.deleteLocation(original.id, actor), 409);await prisma.gpsAuditLog.delete({ where: { id: `${tag}-gps` } });
  await prisma.locationAvailabilityOverride.create({ data: { id: `${tag}-override`, locationId: original.id, type: "COMMERCIAL_BLOCK", reason: "Synthetic history", periodStart: new Date("2028-01-01"), clearedAt: new Date() } });
  await rejected(() => mutations.deleteLocation(original.id, actor), 409);await prisma.locationAvailabilityOverride.delete({ where: { id: `${tag}-override` } });
  await prisma.financialReportUpload.create({ data: { id: `${tag}-upload`, originalFileName: "synthetic", fileHash: tag } });
  await prisma.financialReceivableImportRow.create({ data: { id: `${tag}-financial-row`, locationId: original.id, uploadId: `${tag}-upload`, companyName: "Synthetic", companyCode: tag, sheetName: "Synthetic", rowNumber: 1, sourceRowKey: tag, sourceHash: tag } });
  await rejected(() => mutations.deleteLocation(original.id, actor), 409);await prisma.financialReceivableImportRow.delete({ where: { id: `${tag}-financial-row` } });
  proofs.push("DELETE preserves cancelled commercial, archived operational, financial-import, GPS and cleared availability history");

  let reached!: () => void, resume!: () => void;
  const beforeLock = new Promise<void>((resolve) => { reached = resolve; });
  const continueLock = new Promise<void>((resolve) => { resume = resolve; });
  (prisma as any).$transaction = (callback: any, options: any) => runTransaction(async (tx) => callback(new Proxy(tx, { get(target, key) {
    if (key === "$queryRaw") return async (sql: TemplateStringsArray, ...values: unknown[]) => {
      if (String(sql[0]).includes("portfolio_locations")) { reached();await continueLock; }
      return (target.$queryRaw as any)(sql, ...values);
    };
    return Reflect.get(target, key);
  } })), options);
  const deleting = mutations.deleteLocation(original.id, actor);
  try {
    // Also observe an early rejection so a failed actor check cannot leave the
    // test waiting forever for a location lock that will never be attempted.
    await Promise.race([beforeLock, deleting.then(() => { throw new Error("Deletion completed before the controlled lock."); })]);
    // Actor read has happened; a REPEATABLE READ snapshot would now be stale.
    await createReservation();resume();await rejected(() => deleting, 409);
  } finally { resume();(prisma as any).$transaction = originalTransaction; }
  assert.equal(await prisma.location.count({ where: { id: original.id } }), 1);
  assert.equal(await prisma.reservation.count({ where: { locationId: original.id } }), 1);
  const audit = await prisma.auditLog.findMany({ where: { userId: actor.id } });
  assert.ok(audit.every((row) => row.metadata && typeof row.metadata === "object" && (row.metadata as Record<string, unknown>).durability === "business-transaction"));
  proofs.push("deterministic concurrent history insert after actor read is visible after location lock and prevents deletion");
  console.log(JSON.stringify({ ok: true, database: database.pathname.slice(1), proofs }, null, 2));
}

void main().catch((error) => { console.error(error);process.exitCode = 1; }).finally(async () => {
  (prisma as any).$transaction = originalTransaction;
  await prisma.auditLog.deleteMany({ where: { userId: actor.id } });
  await prisma.reservation.deleteMany({ where: { id: { startsWith: tag } } });
  await prisma.operationTask.deleteMany({ where: { id: { startsWith: tag } } });
  await prisma.financialReceivableImportRow.deleteMany({ where: { id: { startsWith: tag } } });
  await prisma.financialReportUpload.deleteMany({ where: { id: { startsWith: tag } } });
  await prisma.location.deleteMany({ where: { code: { startsWith: tag } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.user.deleteMany({ where: { id: actor.id } });
  await prisma.$disconnect();
});
