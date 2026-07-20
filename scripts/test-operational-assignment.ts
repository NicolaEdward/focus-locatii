import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";

loadEnvFile(process.env.ENV_FILE);
assertSyntheticEnvironment();

const suffix = `op-assignment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const created = {
  users: [] as string[],
  categories: [] as string[],
  locations: [] as string[],
  clients: [] as string[],
  campaigns: [] as string[],
  reservations: [] as string[],
  batches: [] as string[]
};

let prisma: any;

async function main() {
  process.env.OPERATIONAL_ASSIGNMENT_ENABLED = "true";
  ({ prisma } = await import("../src/lib/prisma"));
  const assignment = await import("../src/lib/operational-assignment");
  const { deriveBaseTasksFromReservation } = await import("../src/lib/operation-tasks");
  const before = await sensitiveCounts();

  try {
    assert.equal(deriveBaseTasksFromReservation({ status: "HOLD", id: "hold", periodStart: new Date(), periodEnd: new Date() }).tasks.length, 0, "HOLD must not derive field tasks");
    assert.equal(deriveBaseTasksFromReservation({ status: "RESERVED", id: "reserved", periodStart: new Date(), periodEnd: new Date() }).tasks.length, 0, "RESERVED must not derive field tasks");

    const [coo, fieldOne, fieldTwo, fieldThree, owner, unrelatedSeller] = await Promise.all([
      createUser("coo", "COO"),
      createUser("field-one", "FIELD_OPERATOR"),
      createUser("field-two", "FIELD_OPERATOR"),
      createUser("field-three", "FIELD_OPERATOR"),
      createUser("owner", "SALES_AGENT"),
      createUser("unrelated", "SALES_AGENT")
    ]);
    const cooSession = session(coo);
    const fieldOneSession = session(fieldOne);
    const fieldTwoSession = session(fieldTwo);
    const fieldThreeSession = session(fieldThree);
    const ownerSession = session(owner);
    const unrelatedSession = session(unrelatedSeller);

    const category = await prisma.category.create({ data: { name: `Operational QA ${suffix}`, slug: `operational-qa-${suffix}` } });
    created.categories.push(category.id);
    const [bookedLocation, holdLocation] = await Promise.all([
      prisma.location.create({ data: { code: `OP-BOOKED-${suffix}`, categoryId: category.id, city: "Preview", status: "BOOKED", showInPublic: false } }),
      prisma.location.create({ data: { code: `OP-HOLD-${suffix}`, categoryId: category.id, city: "Preview", status: "RESERVED", showInPublic: false } })
    ]);
    created.locations.push(bookedLocation.id, holdLocation.id);
    const client = await prisma.clientAccount.create({
      data: { companyName: `Operational client ${suffix}`, normalizedName: `operational client ${suffix}`, accountOwnerUserId: owner.id, createdByUserId: owner.id, status: "active" }
    });
    created.clients.push(client.id);
    const campaign = await prisma.campaign.create({
      data: { clientId: client.id, campaignName: `Operational campaign ${suffix}`, status: "active", accountOwnerUserId: owner.id, sellerUserId: owner.id, createdByUserId: owner.id }
    });
    created.campaigns.push(campaign.id);

    const booked = await prisma.reservation.create({
      data: {
        locationId: bookedLocation.id,
        clientId: client.id,
        campaignId: campaign.id,
        status: "BOOKED",
        clientName: client.companyName,
        campaignName: campaign.campaignName,
        periodStart: day(-2),
        periodEnd: day(20),
        installationDate: day(-1),
        neutralizationDate: day(20),
        ownerId: owner.id,
        sellerUserId: owner.id,
        salesperson: owner.name
      }
    });
    const hold = await prisma.reservation.create({
      data: {
        locationId: holdLocation.id,
        status: "HOLD",
        clientName: `Hold ${suffix}`,
        periodStart: day(1),
        periodEnd: day(4),
        holdExpiresAt: day(1),
        ownerId: owner.id,
        sellerUserId: owner.id,
        salesperson: owner.name
      }
    });
    created.reservations.push(booked.id, hold.id);

    const managerTasks = await assignment.listOperationalAssignmentTasks({ session: cooSession });
    const bookedTasks = managerTasks.filter((task: any) => task.reservationId === booked.id);
    assert.deepEqual(bookedTasks.map((task: any) => task.kind).sort(), ["DECORATION", "NEUTRALIZATION"], "BOOKED derives decoration and neutralization tasks");
    assert.equal(managerTasks.some((task: any) => task.reservationId === hold.id), false, "HOLD is absent from assignment board");
    assert.equal((await assignment.listOperationalAssignmentTasks({ session: fieldOneSession, includeCompleted: true })).length, 0, "Field sees no unassigned task");

    const decorationKey = `reservation:${booked.id}:DECORATION:base`;
    const dryRun = await assignment.buildOperationalAssignmentDryRun({ taskKeys: [decorationKey], assigneeUserId: fieldOne.id, session: cooSession });
    assert.equal(dryRun.createCount, 1, "first assignment materializes only the selected task");
    assert.equal(dryRun.blocked.length, 0, "eligible BOOKED assignment has no blockers");
    created.batches.push(dryRun.batchId);
    const applied = await assignment.applyOperationalAssignmentBatch({
      taskKeys: [decorationKey],
      assigneeUserId: fieldOne.id,
      expectedBatchId: dryRun.batchId,
      reason: "Planificare sintetica pentru teren",
      session: cooSession
    });
    assert.equal(applied.updated, 1, "assignment applies exactly one task");
    const taskId = applied.taskIds[0];

    const fieldOneTasks = await assignment.listOperationalAssignmentTasks({ session: fieldOneSession, includeCompleted: true });
    assert.deepEqual(fieldOneTasks.map((task: any) => task.taskKey), [decorationKey], "Field sees only the assigned task");
    assert(await assignment.getOperationalTaskForAccess(taskId, fieldOneSession), "assigned Field can open task directly");
    assert.equal(await assignment.getOperationalTaskForAccess(taskId, fieldTwoSession), null, "unassigned Field direct access is denied");
    assert(await assignment.getOperationalTaskForAccess(taskId, ownerSession), "responsible seller can access own client task");
    assert.equal(await assignment.getOperationalTaskForAccess(taskId, unrelatedSession), null, "unrelated seller direct access is denied");
    assert.equal(await assignment.fieldCanAccessOperationalProof({ session: fieldOneSession, reservationId: booked.id, kind: "decoration" }), true, "assigned Field can access task proof");
    assert.equal(await assignment.fieldCanAccessOperationalProof({ session: fieldTwoSession, reservationId: booked.id, kind: "decoration" }), false, "unassigned Field cannot access task proof");

    await assignment.updateAssignedOperationalTaskStatus({ operationTaskId: taskId, status: "IN_PROGRESS", session: fieldOneSession });
    const inProgress = await prisma.operationTask.findUniqueOrThrow({ where: { id: taskId }, select: { status: true } });
    assert.equal(inProgress.status, "IN_PROGRESS", "assigned Field can start work");

    const [reassignTwo, reassignThree] = await Promise.all([
      assignment.buildOperationalAssignmentDryRun({ taskKeys: [decorationKey], assigneeUserId: fieldTwo.id, session: cooSession }),
      assignment.buildOperationalAssignmentDryRun({ taskKeys: [decorationKey], assigneeUserId: fieldThree.id, session: cooSession })
    ]);
    assert.equal(reassignTwo.reassignCount, 1, "reassignment is classified explicitly");
    assert.equal(reassignThree.reassignCount, 1, "parallel reassignment sees the same initial owner");
    created.batches.push(reassignTwo.batchId, reassignThree.batchId);
    const commands = [
      { assignee: fieldTwo, session: fieldTwoSession, dryRun: reassignTwo },
      { assignee: fieldThree, session: fieldThreeSession, dryRun: reassignThree }
    ];
    const concurrent = await Promise.allSettled(commands.map((command) => assignment.applyOperationalAssignmentBatch({
      taskKeys: [decorationKey],
      assigneeUserId: command.assignee.id,
      expectedBatchId: command.dryRun.batchId,
      reason: "Realocare sintetica pentru teren",
      session: cooSession
    })));
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1, "exactly one concurrent reassignment succeeds");
    assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1, "stale concurrent reassignment is rejected");
    const winnerIndex = concurrent.findIndex((result) => result.status === "fulfilled");
    const winner = commands[winnerIndex];
    const reassigned = concurrent[winnerIndex] as PromiseFulfilledResult<any>;
    assert.equal(reassigned.value.updated, 1, "winning reassignment updates one task");
    const repeated = await assignment.applyOperationalAssignmentBatch({
      taskKeys: [decorationKey],
      assigneeUserId: winner.assignee.id,
      expectedBatchId: winner.dryRun.batchId,
      reason: "Realocare sintetica pentru teren",
      session: cooSession
    });
    assert.equal(repeated.idempotent, true, "assignment batch is idempotent");
    assert.equal((await assignment.listOperationalAssignmentTasks({ session: fieldOneSession, includeCompleted: true })).length, 0, "old assignee loses task immediately");
    assert.deepEqual((await assignment.listOperationalAssignmentTasks({ session: winner.session, includeCompleted: true })).map((task: any) => task.taskKey), [decorationKey], "new assignee receives task immediately");
    assert.equal(await assignment.getOperationalTaskForAccess(taskId, fieldOneSession), null, "old assignee direct API access is revoked");

    const taskAudits = await prisma.auditLog.count({ where: { entityType: "operation_task", entityId: taskId, action: { in: ["operation.assignment.assigned", "operation.assignment.reassigned", "operation.task.status_changed"] } } });
    assert.equal(taskAudits, 3, "assignment, status change and reassignment are audited");

    process.env.OPERATIONAL_ASSIGNMENT_ENABLED = "false";
    await assert.rejects(() => assignment.listOperationalAssignmentTasks({ session: fieldTwoSession }), /nu este activ/, "feature flag fails closed");
    assert.equal(await assignment.getOperationalTaskForAccess(taskId, fieldTwoSession), null, "direct access fails closed when pilot is disabled");
    process.env.OPERATIONAL_ASSIGNMENT_ENABLED = "true";

    staticSafetyTests();
  } finally {
    process.env.OPERATIONAL_ASSIGNMENT_ENABLED = "true";
    await cleanup();
    const after = await sensitiveCounts();
    assert.deepEqual(after, before, "synthetic assignment test restores all sensitive counts");
    await prisma.$disconnect();
  }

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "HOLD and RESERVED excluded",
      "BOOKED task derivation",
      "manager dry-run and assignment",
      "Field assigned-only inbox",
      "direct API IDOR denial",
      "responsible Sales access",
      "status bridge and audit",
    "reassignment and idempotency",
      "concurrent assignment permits one winner",
      "preview-only feature flag",
      "sensitive counts restored"
    ]
  }, null, 2));
}

function staticSafetyTests() {
  const assignmentRoute = read("src", "app", "api", "admin", "operational", "assignments", "route.ts");
  const completionRoute = read("src", "app", "api", "admin", "operational", "tasks", "complete", "route.ts");
  const taskRoute = read("src", "app", "api", "admin", "operational", "tasks", "route.ts");
  const page = read("src", "app", "admin", "operational", "page.tsx");
  const reservations = read("src", "lib", "reservations.ts");
  const service = read("src", "lib", "operational-assignment.ts");

  assert(assignmentRoute.includes("buildOperationalAssignmentDryRun"), "assignment API requires dry-run");
  assert(assignmentRoute.includes("ATRIBUIE TASKURILE OPERATIONALE"), "assignment API requires explicit confirmation");
  assert(assignmentRoute.includes("previousAssigneeUserIds"), "reassignment notifies the previous assignee");
  assert(service.includes("MAX_ASSIGNMENT_BATCH = 100"), "batch assignment is bounded");
  assert(service.includes('reservation: { status: "BOOKED" }'), "Field task query is restricted to BOOKED reservations");
  assert(completionRoute.includes("!operationalAssignmentEnabled() || !operationTaskId"), "Field cannot use the legacy completion path");
  assert(completionRoute.includes('existing.status === "BOOKED"'), "Field completion requires BOOKED");
  assert(completionRoute.includes('session.role === "FIELD_OPERATOR" && files.length < 1'), "Field completion requires a new proof photo");
  assert(taskRoute.includes("updateAssignedOperationalTaskStatus"), "task status API delegates to assignment service");
  assert(page.includes("FieldWorkInbox"), "Field receives the dedicated mobile inbox");
  assert(page.includes("OperationalAssignmentBoard"), "manager receives explicit assignment UI");
  assert(reservations.includes('if (session.role === "FIELD_OPERATOR") return [];'), "Field no longer receives broad derived BOOKED rows");
  assert(!service.includes("OPERATION_TASKS_ENABLED") && !service.includes("OPERATION_TASK_READS_ENABLED"), "pilot does not activate legacy OperationTask flags");
  assert(!completionRoute.toLowerCase().includes("smartbill"), "completion does not mutate SmartBill");
  assert(!assignmentRoute.includes("reservation.create") && !taskRoute.includes("reservation.create"), "assignment routes do not create reservations");
}

async function sensitiveCounts() {
  const [reservations, hold, booked, operationTasks, proofPhotos] = await Promise.all([
    prisma.reservation.count(),
    prisma.reservation.count({ where: { status: "HOLD" } }),
    prisma.reservation.count({ where: { status: "BOOKED" } }),
    prisma.operationTask.count(),
    prisma.clientDocument.count({ where: { documentType: "operational_proof_photo" } })
  ]);
  return { reservations, hold, booked, operationTasks, proofPhotos };
}

async function createUser(label: string, role: "COO" | "SALES_AGENT" | "FIELD_OPERATOR") {
  const user = await prisma.user.create({
    data: { email: `${label}-${suffix}@example.invalid`, name: `Synthetic ${label} ${suffix}`, passwordHash: "not-used", role, active: true }
  });
  created.users.push(user.id);
  return user;
}

function session(user: { id: string; email: string; name: string; role: any; tokenVersion: number }) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, tokenVersion: user.tokenVersion, iat: 1, exp: 9999999999 };
}

function day(offset: number) {
  const value = new Date();
  value.setUTCHours(12, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + offset);
  return value;
}

async function cleanup() {
  const taskIds = (await prisma.operationTask.findMany({ where: { reservationId: { in: created.reservations } }, select: { id: true } })).map((row: any) => row.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...created.batches, ...taskIds, ...created.reservations] } }, { userId: { in: created.users } }] } }).catch(() => undefined);
  await prisma.appNotification.deleteMany({ where: { userId: { in: created.users } } }).catch(() => undefined);
  await prisma.clientDocument.deleteMany({ where: { reservationId: { in: created.reservations } } }).catch(() => undefined);
  await prisma.operationTask.deleteMany({ where: { reservationId: { in: created.reservations } } }).catch(() => undefined);
  await prisma.reservation.deleteMany({ where: { id: { in: created.reservations } } }).catch(() => undefined);
  await prisma.campaign.deleteMany({ where: { id: { in: created.campaigns } } }).catch(() => undefined);
  await prisma.clientAccount.deleteMany({ where: { id: { in: created.clients } } }).catch(() => undefined);
  await prisma.location.deleteMany({ where: { id: { in: created.locations } } }).catch(() => undefined);
  await prisma.category.deleteMany({ where: { id: { in: created.categories } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: created.users } } }).catch(() => undefined);
}

function read(...segments: string[]) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
