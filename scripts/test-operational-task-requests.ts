import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
import { prisma } from "../src/lib/prisma";
import { createOperationalTaskRequest } from "../src/lib/operational-task-requests";
import { operationExtraTasks, withOperationTaskStatus } from "../src/lib/operation-status";

async function main() {
  loadEnvFile(); assertSyntheticEnvironment();
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(process.env.DATABASE_URL || "invalid:").hostname));
  assert.notEqual(process.env.NODE_ENV, "production");
  const tag = `sim-op-intent-${randomUUID()}`, seller = `${tag}-seller`, other = `${tag}-other`, coo = `${tag}-coo`, field = `${tag}-field`, category = `${tag}-category`, location = `${tag}-location`, rental = `${tag}-rental`;
  const users = [seller, other, coo, field];
  const actor = { id: seller, name: "SIM Seller", email: `${seller}@example.invalid`, role: "SALES_AGENT", tokenVersion: 0 } as any;
  const input = { taskId: `${tag}-request`, kind: "decoration", taskType: "redecoration", requestedDate: "2092-01-05", cost: null, currency: null };
  const checked: string[] = [];
  const oldFlag = process.env.OPERATION_TASKS_ENABLED;
  try {
    await prisma.user.createMany({ data: users.map((id) => ({ id, email: `${id}@example.invalid`, name: id, passwordHash: "synthetic-unusable", role: id === coo ? "COO" : id === field ? "FIELD_OPERATOR" : "SALES_AGENT", active: true })) });
    await prisma.category.create({ data: { id: category, name: tag, slug: tag } });
    await prisma.location.create({ data: { id: location, categoryId: category, code: tag, city: "SIM Bucuresti", type: "Mesh", showInPublic: false } });
    await prisma.reservation.create({ data: { id: rental, locationId: location, clientName: "SIM Client", status: "BOOKED", periodStart: new Date("2092-01-01Z"), periodEnd: new Date("2092-01-31Z"), ownerId: seller, sellerUserId: seller, currency: "EUR" } });
    process.env.OPERATION_TASKS_ENABLED = "false";
    const pair = await Promise.all([createOperationalTaskRequest(rental, input, actor), createOperationalTaskRequest(rental, input, actor)]);
    assert.equal(pair.filter((row) => row.duplicate).length, 1);
    let row = await prisma.reservation.findUniqueOrThrow({ where: { id: rental } });
    assert.equal(operationExtraTasks(row.productionNotes).length, 1);
    assert.equal(await prisma.auditLog.count({ where: { entityId: rental, action: "operation.decoration.create_task" } }), 1);
    checked.push("concurrent stable intent creates one task and one durable command audit");

    await prisma.reservation.update({ where: { id: rental }, data: { productionNotes: withOperationTaskStatus(row.productionNotes, input.taskId, "DONE") } });
    row = await prisma.reservation.findUniqueOrThrow({ where: { id: rental } });
    const completedNotes = row.productionNotes;
    const retried = await createOperationalTaskRequest(rental, input, actor);
    assert.equal(retried.duplicate, true); assert.equal(retried.task.status, "DONE");
    assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: rental } })).productionNotes, completedNotes);
    await assert.rejects(() => createOperationalTaskRequest(rental, { ...input, cost: 1, currency: "RON" }, actor), (error: any) => error.status === 409);
    checked.push("timeout/retry cannot reset completed work or change the intent payload");

    await assert.rejects(() => createOperationalTaskRequest(rental, { ...input, taskId: `${tag}-foreign` }, { ...actor, id: other }), (error: any) => error.status === 403);
    await assert.rejects(() => createOperationalTaskRequest(rental, input, { ...actor, tokenVersion: 1 }), (error: any) => error.status === 403);
    await assert.rejects(() => createOperationalTaskRequest(rental, input, { ...actor, role: "COO" }), (error: any) => error.status === 403);
    await assert.rejects(() => createOperationalTaskRequest(rental, input, { ...actor, id: field, role: "FIELD_OPERATOR" }), (error: any) => error.status === 403);
    await prisma.user.update({ where: { id: seller }, data: { active: false } });
    try { await assert.rejects(() => createOperationalTaskRequest(rental, input, actor), (error: any) => error.status === 403); }
    finally { await prisma.user.update({ where: { id: seller }, data: { active: true } }); }
    checked.push("current owner, role, account state and credential version are enforced before replay");

    process.env.OPERATION_TASKS_ENABLED = "true";
    const bridgedInput = { ...input, taskId: `${tag}-bridged`, cost: 250, currency: "RON" };
    await Promise.all([createOperationalTaskRequest(rental, bridgedInput, actor), createOperationalTaskRequest(rental, bridgedInput, actor)]);
    assert.equal(await prisma.operationTask.count({ where: { reservationId: rental, legacyTaskId: bridgedInput.taskId } }), 1);
    assert.equal(operationExtraTasks((await prisma.reservation.findUniqueOrThrow({ where: { id: rental } })).productionNotes).filter((task) => task.id === bridgedInput.taskId).length, 1);
    checked.push("relational bridge and legacy mirror commit one task under concurrent retries");

    const before = await prisma.reservation.findUniqueOrThrow({ where: { id: rental } });
    const transact = prisma.$transaction.bind(prisma);
    (prisma as any).$transaction = (callback: any, options: any) => transact(async (tx: any) => callback(new Proxy(tx, { get(target, key) {
      if (key === "auditLog") return { ...target.auditLog, create: async ({ data }: any) => {
        if (data.action === "operation.decoration.create_task") throw new Error("SYNTHETIC_TASK_AUDIT_FAILURE");
        return target.auditLog.create({ data });
      } };
      const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
    } })), options);
    try { await assert.rejects(() => createOperationalTaskRequest(rental, { ...bridgedInput, taskId: `${tag}-rollback` }, actor), /SYNTHETIC_TASK_AUDIT_FAILURE/); }
    finally { (prisma as any).$transaction = transact; }
    assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: rental } })).productionNotes, before.productionNotes);
    assert.equal(await prisma.operationTask.count({ where: { reservationId: rental, legacyTaskId: `${tag}-rollback` } }), 0);
    checked.push("audit failure rolls back task, mirror and business write atomically");

    await prisma.reservation.update({ where: { id: rental }, data: { status: "CANCELLED" } });
    await assert.rejects(() => createOperationalTaskRequest(rental, { ...input, taskId: `${tag}-after-cancel` }, actor), (error: any) => error.status === 400);
    assert.equal((await createOperationalTaskRequest(rental, input, actor)).duplicate, true);
    await assert.rejects(() => createOperationalTaskRequest(rental, { ...input, taskId: undefined }, actor), (error: any) => error.status === 428);
    checked.push("cancellation stops new work but permits authorized result recovery; missing stable intent refused");
    console.log(JSON.stringify({ ok: true, checked }, null, 2));
  } finally {
    if (oldFlag === undefined) delete process.env.OPERATION_TASKS_ENABLED; else process.env.OPERATION_TASKS_ENABLED = oldFlag;
    await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
    await prisma.operationTask.deleteMany({ where: { reservationId: rental } });
    await prisma.reservation.deleteMany({ where: { id: rental } });
    await prisma.location.deleteMany({ where: { id: location } });
    await prisma.category.deleteMany({ where: { id: category } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
