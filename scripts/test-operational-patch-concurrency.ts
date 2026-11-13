import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import * as reservations from "../src/lib/reservations";
import * as requests from "../src/lib/operational-task-requests";
import * as status from "../src/lib/operation-status";
import * as bridge from "../src/lib/operation-task-bridge";
import * as audit from "../src/lib/audit";
import * as observability from "../src/lib/observability";
import * as rbac from "../src/lib/rbac";
import { assertSyntheticEnvironment } from "./release/env-utils";

assertSyntheticEnvironment();
const database = new URL(process.env.DATABASE_URL || "invalid:");
assert.ok(["127.0.0.1", "localhost"].includes(database.hostname) && database.pathname.startsWith("/focus_preview_"));
assert.notEqual(process.env.NODE_ENV, "production");
const baseline = process.argv.includes("--baseline-observation");
const tag = "SIM-OOH-op-race-" + randomUUID();
const userId = tag + "-owner", categoryId = tag + "-category", locationId = tag + "-location";
const rentalIds: string[] = [];
const results: Array<Record<string, unknown>> = [];
const actor = { id: userId, role: "COO", name: tag, email: tag + "@example.invalid", tokenVersion: 0, iat: 1, exp: 9999999999 } as any;
const oldFlag = process.env.OPERATION_TASKS_ENABLED;
function gate() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
function route(reservationId: string, read: ReturnType<typeof gate>, resume: ReturnType<typeof gate>, commandCenter: boolean) {
  const require = createRequire(`${process.cwd()}/package.json`);
  let paused = false;
  const db = new Proxy(prisma, { get(target, key) {
    if (key === "reservation") return new Proxy(target.reservation, { get(delegate, method) {
      if (method === "findUnique") return async (args: any) => {
        const snapshot = await delegate.findUnique(args);
        if (!paused && args.where.id === reservationId) { paused = true; read.resolve(); await resume.promise; }
        return snapshot;
      };
      const value = (delegate as any)[method]; return typeof value === "function" ? value.bind(delegate) : value;
    } });
    const value = (target as any)[key]; return typeof value === "function" ? value.bind(target) : value;
  } });
  const mocks: Record<string, unknown> = { "@/lib/auth": { requirePermission: async () => ({ session: actor, response: null }), requireAnyPermission: async () => ({ session: actor, response: null }) }, "@/lib/prisma": { prisma: db }, "@/lib/reservations": reservations, "@/lib/operational-task-requests": requests, "@/lib/operation-status": status, "@/lib/operation-task-bridge": bridge, "@/lib/audit": audit, "@/lib/observability": observability, "@/lib/rbac": rbac };
  const compiled = ts.transpileModule(fs.readFileSync(commandCenter ? "src/app/api/admin/command-center/route.ts" : "src/app/api/reservations/[id]/operations/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exported: { PATCH?: (request: NextRequest, context: any) => Promise<Response>; POST?: (request: NextRequest, context: any) => Promise<Response> } = {};
  runInNewContext(compiled.outputText, { exports: exported, require: (name: string) => name in mocks ? mocks[name] : require(name), process, Buffer, Request, File, URL, Error });
  return (body: Record<string, unknown>) => (commandCenter ? exported.POST! : exported.PATCH!)(new NextRequest("http://127.0.0.1/api/reservations/" + reservationId + "/operations", { method: commandCenter ? "POST" : "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(commandCenter ? { action: "operationStatus", reservationId, ...body } : body) }), { params: Promise.resolve({ id: reservationId }) });
}
async function main() {
  await prisma.user.create({ data: { id: userId, role: "COO", name: tag, email: actor.email, passwordHash: "synthetic-unusable", active: true } });
  await prisma.category.create({ data: { id: categoryId, name: tag, slug: tag } });
  await prisma.location.create({ data: { id: locationId, categoryId, code: tag, city: "SIM Bucuresti", type: "Mesh", showInPublic: false } });
  for (const commandCenter of [false, true]) for (const enabled of [false, true]) {
    process.env.OPERATION_TASKS_ENABLED = String(enabled);
    const rentalId = tag + "-rental-" + commandCenter + "-" + enabled; rentalIds.push(rentalId);
    await prisma.reservation.create({ data: { id: rentalId, locationId, clientName: tag, status: "BOOKED", periodStart: new Date("2092-01-01Z"), periodEnd: new Date("2092-01-31Z"), installationDate: new Date("2092-01-01Z"), neutralizationDate: new Date("2092-01-31Z"), ownerId: userId, sellerUserId: userId, currency: "EUR", amount: 100, monthlyRentShare: 100, monthlyRentTotal: 100 } });
    const read = gate(), resume = gate(), patch = route(rentalId, read, resume, commandCenter);
    const pendingPatch = patch({ kind: "decoration", status: "DONE" });
    const timeout = setTimeout(() => resume.resolve(), 15000);
    await read.promise;
    const input = { taskId: tag + "-intent-" + commandCenter + "-" + enabled, kind: "decoration", taskType: "redecoration", requestedDate: "2092-01-05", cost: 250, currency: "RON" };
    let created: Awaited<ReturnType<typeof requests.createOperationalTaskRequest>>;
    try { created = await requests.createOperationalTaskRequest(rentalId, input, actor); }
    finally { resume.resolve(); clearTimeout(timeout); }
    const response = await pendingPatch;
    const expectedStatus = commandCenter && !enabled ? 409 : 200;
    assert.equal(response.status, expectedStatus, await response.text());
    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: rentalId } });
    const tasks = status.operationExtraTasks(after.productionNotes);
    const originalTask = tasks.find((task) => task.id === input.taskId);
    const preserved = originalTask?.requestFingerprint === created!.task.requestFingerprint;
    const baseDone = status.operationStatus(after.productionNotes, "decoration") === (expectedStatus === 409 ? "NEW" : "DONE");
    const retry = await requests.createOperationalTaskRequest(rentalId, input, actor);
    const auditCount = await prisma.auditLog.count({ where: { entityId: rentalId, action: "operation.decoration.create_task" } });
    const prefix = commandCenter ? "COMMAND-CENTER" : "PATCH";
    const result = { id: prefix + (enabled ? "-BRIDGE-POST-COMMIT" : "-LEGACY-POST-COMMIT"), interleaving: "Status route preflight read paused -> task POST commits -> status route resumes", bridgeEnabled: enabled, responseStatus: response.status, staleStatusSafelyRejected: expectedStatus === 409, baseStatusPreserved: baseDone, taskAndFingerprintPreserved: preserved, sameIntentRetryDuplicate: retry.duplicate, commandAuditCount: auditCount, passed: baseDone && preserved && retry.duplicate && auditCount === 1 };
    results.push(result);
    if (!baseline) assert.ok(result.passed, JSON.stringify(result));
    // A taskId completion following the race must preserve the stable intent,
    // and recovering the POST result must not reopen completed work.
    const completedResponse = await patch({ kind: "decoration", status: "DONE", taskId: input.taskId });
    assert.equal(completedResponse.status, 200, await completedResponse.text());
    const completedRetry = await requests.createOperationalTaskRequest(rentalId, input, actor);
    assert.equal(completedRetry.duplicate, true); assert.equal(completedRetry.task.status, "DONE");
    if (enabled) assert.equal((await prisma.operationTask.findFirstOrThrow({ where: { reservationId: rentalId, legacyTaskId: input.taskId } })).status, "DONE");
    results.push({ id: prefix + (enabled ? "-BRIDGE-TASKID-RETRY" : "-LEGACY-TASKID-RETRY"), taskIdCompleted: true, retryPreservedDone: true, passed: true });
  }
  const report = { syntheticOnly: true, productionWrites: 0, baseline, cases: results.length, passed: results.filter((row) => row.passed).length, observedFailures: results.filter((row) => !row.passed).length, results };
  if (process.env.OPERATIONAL_PATCH_RESULT) { fs.mkdirSync(path.dirname(process.env.OPERATIONAL_PATCH_RESULT), { recursive: true }); fs.writeFileSync(process.env.OPERATIONAL_PATCH_RESULT, JSON.stringify(report, null, 2) + "\n"); }
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (oldFlag === undefined) delete process.env.OPERATION_TASKS_ENABLED; else process.env.OPERATION_TASKS_ENABLED = oldFlag;
  try {
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.operationTask.deleteMany({ where: { reservationId: { in: rentalIds } } });
    await prisma.reservation.deleteMany({ where: { id: { in: rentalIds } } });
    await prisma.location.deleteMany({ where: { id: locationId } }); await prisma.category.deleteMany({ where: { id: categoryId } }); await prisma.user.deleteMany({ where: { id: userId } });
  } finally { await prisma.$disconnect(); }
});
