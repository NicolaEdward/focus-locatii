const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

const auditCalls = [];
const noteUpdates = [];
const legacyReservationUpdates = [];
const taskCalls = [];
const tasks = new Map();
let createCounter = 0;
let reservation = baseReservation();
let tableUnavailable = false;
let mirrorFailure = false;

const nextResponse = {
  json: (body, init = {}) => ({ body, status: init.status || 200, headers: init.headers || {} })
};

const operationTaskDelegate = {
  findUnique: async ({ where }) => {
    taskCalls.push({ action: "findUnique", where });
    if (tableUnavailable) throw new Error("The table `portfolio_operation_tasks` does not exist");
    if (where.dedupeKey) return [...tasks.values()].find((task) => task.dedupeKey === where.dedupeKey) || null;
    if (where.id) return tasks.get(where.id) || null;
    return null;
  },
  create: async ({ data }) => {
    taskCalls.push({ action: "create", data });
    if (tableUnavailable) throw new Error("The table `portfolio_operation_tasks` does not exist");
    const existing = [...tasks.values()].find((task) => task.dedupeKey && task.dedupeKey === data.dedupeKey);
    if (existing) return existing;
    const task = {
      id: `task-${++createCounter}`,
      ...data,
      completedAt: data.completedAt || null,
      legacyTaskId: data.legacyTaskId || null
    };
    tasks.set(task.id, task);
    return task;
  },
  update: async ({ where, data }) => {
    taskCalls.push({ action: "update", where, data });
    if (tableUnavailable) throw new Error("The table `portfolio_operation_tasks` does not exist");
    const task = tasks.get(where.id);
    if (!task) throw new Error("missing task");
    const next = { ...task, ...data };
    tasks.set(where.id, next);
    return next;
  }
};

const reservationDelegate = {
  findUnique: async ({ where }) => where.id === "missing" ? null : { ...reservation },
  findMany: async () => [{ ...reservation }],
  update: async ({ where, data }) => {
    if (mirrorFailure) throw new Error("Simulated productionNotes mirror failure");
    noteUpdates.push({ id: where.id, nextNotes: data.productionNotes, transactional: true });
    reservation = { ...reservation, productionNotes: data.productionNotes };
    return { id: reservation.id, productionNotes: reservation.productionNotes };
  },
  updateMany: async () => ({ count: 1 })
};

const prisma = {
  reservation: reservationDelegate,
  operationTask: operationTaskDelegate,
  $transaction: async (callback) => {
    const taskSnapshot = new Map([...tasks.entries()].map(([key, value]) => [key, { ...value }]));
    const reservationSnapshot = { ...reservation };
    const noteLength = noteUpdates.length;
    const taskCallLength = taskCalls.length;
    try {
      return await callback({
        reservation: reservationDelegate,
        operationTask: operationTaskDelegate
      });
    } catch (error) {
      tasks.clear();
      for (const [key, value] of taskSnapshot.entries()) tasks.set(key, value);
      reservation = reservationSnapshot;
      noteUpdates.length = noteLength;
      taskCalls.length = taskCallLength;
      throw error;
    }
  }
};

const route = loadTsModule(path.join(process.cwd(), "src", "app", "api", "admin", "command-center", "route.ts"), {
  "next/server": { NextResponse: nextResponse },
  "@/lib/auth": {
    requireAnyPermission: async (request) => ({ session: request.session, response: request.session ? null : nextResponse.json({ error: "Forbidden" }, { status: 403 }) })
  },
  "@/lib/prisma": { prisma },
  "@/lib/reservations": {
    assignReservationSeller: async () => ({ ok: true }),
    extendReservationHold: async () => ({ ok: true }),
    markReservationHoldLost: async () => ({ ok: true }),
    releaseReservationHold: async () => ({ ok: true }),
    updateReservationGroupStatus: async () => ({ ok: true }),
    updateReservation: async (id, input) => {
      legacyReservationUpdates.push({ id, input });
      if (input.productionNotes !== undefined) reservation = { ...reservation, productionNotes: input.productionNotes };
      return { id, productionNotes: reservation.productionNotes };
    },
    updateReservationProductionNotesWithClient: async (_client, id, nextNotes, actor) => {
      if (mirrorFailure) throw new Error("Simulated productionNotes mirror failure");
      noteUpdates.push({ id, nextNotes, actor, transactional: true });
      reservation = { ...reservation, productionNotes: nextNotes };
      return { id, productionNotes: nextNotes };
    }
  },
  "@/lib/audit": {
    recordAudit: async (input) => {
      auditCalls.push(input);
    }
  }
});

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});

async function main() {
  const previousFlag = process.env.OPERATION_TASKS_ENABLED;
  try {
    await flagOffUsesLegacyPath();
    await flagOnUpdatesBaseDecorationWithoutTaskId();
    await flagOnUpdatesBaseNeutralizationWithoutTaskId();
    await extraTaskUsesStableTaskId();
    await nullTaskIdRejectedBySchema();
    await tableUnavailableFallsBackBeforeWrite();
    await mirrorFailureRollsBackRelationalUpdate();
    await salesAgentDenied();
    await invalidStatusRejected();
    await repeatedBaseUpdateDoesNotCreateDuplicateTasks();
  } finally {
    if (previousFlag === undefined) delete process.env.OPERATION_TASKS_ENABLED;
    else process.env.OPERATION_TASKS_ENABLED = previousFlag;
  }

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "flag off command-center operationStatus uses legacy path",
      "flag on updates OperationTask and mirrors productionNotes",
      "base decoration works without taskId",
      "base neutralization works without taskId",
      "extra task works with taskId",
      "null taskId is rejected and must not be sent",
      "table unavailable falls back before write",
      "mirror failure rolls back relational update",
      "sales agent denied",
      "invalid status rejected",
      "no duplicate OperationTask rows"
    ]
  }, null, 2));
}

async function flagOffUsesLegacyPath() {
  reset();
  delete process.env.OPERATION_TASKS_ENABLED;
  const response = await post(session("coo-1", "COO"), { action: "operationStatus", reservationId: reservation.id, kind: "decoration", status: "DONE" });
  assert.equal(response.status, 200);
  assert.equal(taskCalls.length, 0, "flag off must not touch OperationTask");
  assert.equal(legacyReservationUpdates.length, 1, "flag off should use legacy updateReservation path");
  assert(reservation.productionNotes.includes('"decorationStatus":"DONE"'), "legacy path should mirror decoration status");
}

async function flagOnUpdatesBaseDecorationWithoutTaskId() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  seedTask({ id: "existing-decoration", kind: "DECORATION", dedupeKey: "reservation:reservation-1:DECORATION:base" });
  const response = await post(session("coo-1", "COO"), { action: "operationStatus", reservationId: reservation.id, kind: "decoration", status: "DONE" });
  assert.equal(response.status, 200);
  assert.equal(tasks.get("existing-decoration").status, "DONE");
  assert.equal(legacyReservationUpdates.length, 0, "successful bridge write should not use legacy fallback");
  assert(noteUpdates.at(-1).nextNotes.includes('"decorationStatus":"DONE"'), "productionNotes should mirror decoration status");
  assert.equal(auditCalls.at(-1).action, "command_center.operationStatus");
}

async function flagOnUpdatesBaseNeutralizationWithoutTaskId() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  seedTask({ id: "existing-neutralization", kind: "NEUTRALIZATION", dedupeKey: "reservation:reservation-1:NEUTRALIZATION:base" });
  const response = await post(session("admin-1", "SUPER_ADMIN"), { action: "operationStatus", reservationId: reservation.id, kind: "neutralization", status: "DONE" });
  assert.equal(response.status, 200);
  assert.equal(tasks.get("existing-neutralization").status, "DONE");
  assert(noteUpdates.at(-1).nextNotes.includes('"neutralizationStatus":"DONE"'), "productionNotes should mirror neutralization status");
}

async function extraTaskUsesStableTaskId() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  reservation.productionNotes = legacyMeta({
    tasks: [{
      id: "red-1",
      kind: "decoration",
      status: "NEW",
      taskType: "redecoration",
      taskDate: "2026-07-12T00:00:00.000Z",
      note: "Schimbare vizual"
    }]
  });
  const response = await post(session("coo-1", "COO"), { action: "operationStatus", reservationId: reservation.id, kind: "decoration", status: "DONE", taskId: "red-1" });
  assert.equal(response.status, 200);
  const task = [...tasks.values()].find((item) => item.legacyTaskId === "red-1");
  assert(task, "extra task should create/find relational legacy task");
  assert.equal(task.status, "DONE");
  assert(noteUpdates.at(-1).nextNotes.includes('"id":"red-1"'), "legacy extra task should remain mirrored");
  assert(noteUpdates.at(-1).nextNotes.includes('"status":"DONE"'), "legacy extra task status should mirror");
}

async function nullTaskIdRejectedBySchema() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  const response = await post(session("coo-1", "COO"), { action: "operationStatus", reservationId: reservation.id, kind: "decoration", status: "DONE", taskId: null });
  assert.equal(response.status, 400, "route schema should reject taskId:null");
  assert.equal(taskCalls.length, 0, "invalid payload should not write OperationTask");
  assert.equal(noteUpdates.length, 0, "invalid payload should not mirror productionNotes");
}

async function tableUnavailableFallsBackBeforeWrite() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  tableUnavailable = true;
  const response = await post(session("coo-1", "COO"), { action: "operationStatus", reservationId: reservation.id, kind: "decoration", status: "DONE" });
  assert.equal(response.status, 200);
  assert.equal(legacyReservationUpdates.length, 1, "table unavailable before write may fallback to legacy");
  assert(reservation.productionNotes.includes('"decorationStatus":"DONE"'));
}

async function mirrorFailureRollsBackRelationalUpdate() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  seedTask({ id: "existing-decoration", kind: "DECORATION", status: "NEW", dedupeKey: "reservation:reservation-1:DECORATION:base" });
  mirrorFailure = true;
  const response = await post(session("coo-1", "COO"), { action: "operationStatus", reservationId: reservation.id, kind: "decoration", status: "DONE" });
  assert.equal(response.status, 400);
  assert.equal(tasks.get("existing-decoration").status, "NEW", "transaction rollback should restore OperationTask status");
  assert.equal(legacyReservationUpdates.length, 0, "post-write failure must not silently fallback");
}

async function salesAgentDenied() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  const response = await post(session("agent-1", "SALES_AGENT"), { action: "operationStatus", reservationId: reservation.id, kind: "decoration", status: "DONE" });
  assert.equal(response.status, 403);
  assert.equal(taskCalls.length, 0);
}

async function invalidStatusRejected() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  const response = await post(session("coo-1", "COO"), { action: "operationStatus", reservationId: reservation.id, kind: "decoration", status: "BROKEN" });
  assert.equal(response.status, 400);
  assert.equal(taskCalls.length, 0);
}

async function repeatedBaseUpdateDoesNotCreateDuplicateTasks() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  let response = await post(session("coo-1", "COO"), { action: "operationStatus", reservationId: reservation.id, kind: "decoration", status: "IN_PROGRESS" });
  assert.equal(response.status, 200);
  response = await post(session("coo-1", "COO"), { action: "operationStatus", reservationId: reservation.id, kind: "decoration", status: "DONE" });
  assert.equal(response.status, 200);
  const keys = [...tasks.values()].map((task) => task.dedupeKey).filter(Boolean);
  assert.equal(keys.length, new Set(keys).size, "dedupe keys should remain unique after repeated updates");
  assert.equal([...tasks.values()].filter((task) => task.kind === "DECORATION").length, 1, "base decoration should not duplicate");
}

async function post(sessionValue, body) {
  return route.POST({
    session: sessionValue,
    json: async () => body
  });
}

function reset() {
  auditCalls.length = 0;
  noteUpdates.length = 0;
  legacyReservationUpdates.length = 0;
  taskCalls.length = 0;
  tasks.clear();
  createCounter = 0;
  reservation = baseReservation();
  tableUnavailable = false;
  mirrorFailure = false;
  delete process.env.OPERATION_TASKS_ENABLED;
}

function seedTask(overrides) {
  const task = {
    id: overrides.id,
    reservationId: reservation.id,
    campaignId: reservation.campaignId,
    locationId: reservation.locationId,
    kind: overrides.kind,
    status: overrides.status || "NEW",
    source: "SYSTEM_DERIVED",
    dedupeKey: overrides.dedupeKey,
    legacyTaskId: overrides.legacyTaskId || null,
    scheduledFor: new Date(overrides.kind === "NEUTRALIZATION" ? reservation.periodEnd : reservation.periodStart),
    completedAt: null,
    cost: null,
    currency: null,
    briefUrl: null,
    notes: null,
    createdByUserId: null
  };
  tasks.set(task.id, task);
  return task;
}

function baseReservation() {
  return {
    id: "reservation-1",
    campaignId: "campaign-1",
    locationId: "location-1",
    contractGroupId: null,
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    periodEnd: new Date("2026-08-31T00:00:00.000Z"),
    installationDate: null,
    neutralizationDate: null,
    productionNotes: null,
    notes: null,
    ownerId: "coo-1",
    sellerUserId: "coo-1",
    salesperson: "COO Test",
    status: "BOOKED"
  };
}

function session(id, role) {
  return { id, role, name: `${role} User`, email: `${id}@focus.test` };
}

function legacyMeta(meta) {
  return `Legacy notes\n<!--focus-ops:${JSON.stringify(meta)}-->`;
}
