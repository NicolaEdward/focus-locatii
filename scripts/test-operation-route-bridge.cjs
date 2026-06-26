const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

const auditCalls = [];
const noteUpdates = [];
const taskCalls = [];
const tasks = new Map();
let createCounter = 0;
let reservation = baseReservation();
let tableUnavailable = false;
let operationUpdateFailure = false;
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
    if (operationUpdateFailure) throw new Error("Simulated OperationTask write failure");
    const task = tasks.get(where.id);
    if (!task) throw new Error("missing task");
    const next = { ...task, ...data };
    tasks.set(where.id, next);
    return next;
  }
};

const reservationDelegate = {
  findUnique: async ({ where }) => where.id === "missing" ? null : { ...reservation },
  findUniqueOrThrow: async ({ where }) => {
    if (where.id === "missing") throw new Error("missing reservation");
    return { ...reservation };
  },
  update: async ({ data }) => {
    if (mirrorFailure) throw new Error("Simulated productionNotes mirror failure");
    noteUpdates.push({ id: reservation.id, nextNotes: data.productionNotes });
    reservation = { ...reservation, productionNotes: data.productionNotes };
    return { id: reservation.id, productionNotes: data.productionNotes };
  }
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

const route = loadTsModule(path.join(process.cwd(), "src", "app", "api", "reservations", "[id]", "operations", "route.ts"), {
  "next/server": { NextResponse: nextResponse },
  "@/lib/auth": {
    requirePermission: async (request, permission) => {
      assert.equal(permission, "campaigns.operate", "operations route must require campaigns.operate");
      const session = request.session;
      if (!session || session.role === "SALES_AGENT") {
        return { session: null, response: nextResponse.json({ error: "Forbidden" }, { status: 403 }) };
      }
      return { session, response: null };
    }
  },
  "@/lib/prisma": { prisma },
  "@/lib/reservations": {
    updateReservationProductionNotes: async (id, nextNotes, actor) => {
      noteUpdates.push({ id, nextNotes, actor, legacy: true });
      reservation = { ...reservation, productionNotes: nextNotes };
      return { id, productionNotes: nextNotes };
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
    await featureFlagOffUsesLegacyPath();
    await featureFlagOnUpdatesExistingDecorationTaskTransactionally();
    await missingTaskIsEnsuredAndMirrored();
    await neutralizationMirrorsToProductionNotes();
    await redecorationLegacyTaskMapsToRelationalTask();
    await corruptedProductionNotesFallsThroughSafely();
    await tableUnavailableFallsBackToLegacyBeforeWrite();
    await operationTaskWriteFailureDoesNotFallback();
    await mirrorFailureRollsBackOperationTaskWrite();
    await postFlagOffUsesLegacyPath();
    await postFlagOnCreatesOperationTaskAndMirrors();
    await repeatedPostWithStableTaskIdDoesNotCreateDuplicate();
    await postCorruptedProductionNotesDoesNotCrash();
    await invalidInputsAndRbacStillHold();
  } finally {
    if (previousFlag === undefined) delete process.env.OPERATION_TASKS_ENABLED;
    else process.env.OPERATION_TASKS_ENABLED = previousFlag;
  }

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "feature flag off uses legacy path",
      "feature flag on updates OperationTask transactionally",
      "missing base task is ensured",
      "decoration mirror to productionNotes",
      "neutralization mirror to productionNotes",
      "redecoration legacy task maps to relational task",
      "corrupted productionNotes safe",
      "table unavailable falls back before write",
      "OperationTask write failure does not fallback",
      "mirror failure rolls back OperationTask write",
      "flag off POST uses legacy path",
      "flag on POST creates OperationTask and mirrors",
      "stable POST taskId avoids duplicate relational task",
      "sales denied",
      "COO/SUPER_ADMIN allowed",
      "invalid status/kind rejected",
      "audit written",
      "response keeps reservation"
    ]
  }, null, 2));
}

async function featureFlagOffUsesLegacyPath() {
  reset();
  delete process.env.OPERATION_TASKS_ENABLED;
  const response = await patch(session("coo-1", "COO"), { kind: "decoration", status: "DONE" });
  assert.equal(response.status, 200);
  assert.equal(taskCalls.length, 0, "flag off must not touch OperationTask");
  assert.equal(noteUpdates.length, 1, "legacy productionNotes path should update");
  assert(response.body.reservation, "response should keep reservation shape");
}

async function featureFlagOnUpdatesExistingDecorationTaskTransactionally() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  seedTask({ id: "existing-decoration", kind: "DECORATION", dedupeKey: "reservation:reservation-1:DECORATION:base" });
  const response = await patch(session("coo-1", "COO"), { kind: "decoration", status: "DONE" });
  assert.equal(response.status, 200);
  assert.equal(tasks.get("existing-decoration").status, "DONE", "existing OperationTask should update");
  assert(noteUpdates.at(-1).transactional, "productionNotes mirror should use transactional helper");
  assert(noteUpdates.at(-1).nextNotes.includes('"decorationStatus":"DONE"'), "decoration status should mirror to productionNotes");
  assert.equal(auditCalls.at(-1).action, "operation.decoration.done", "audit should be written");
  assert(response.body.reservation, "response should include reservation");
}

async function missingTaskIsEnsuredAndMirrored() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  const response = await patch(session("admin-1", "SUPER_ADMIN"), { kind: "decoration", status: "IN_PROGRESS" });
  assert.equal(response.status, 200);
  assert([...tasks.values()].some((task) => task.kind === "DECORATION"), "missing decoration task should be created");
  assert([...tasks.values()].some((task) => task.kind === "NEUTRALIZATION"), "ensure should create neutralization base task too");
  assert(noteUpdates.at(-1).nextNotes.includes('"decorationStatus":"IN_PROGRESS"'), "new task status should mirror");
}

async function neutralizationMirrorsToProductionNotes() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  seedTask({ id: "existing-neutralization", kind: "NEUTRALIZATION", dedupeKey: "reservation:reservation-1:NEUTRALIZATION:base" });
  const response = await patch(session("coo-1", "COO"), { kind: "neutralization", status: "ARCHIVED" });
  assert.equal(response.status, 200);
  assert.equal(tasks.get("existing-neutralization").status, "ARCHIVED");
  assert(noteUpdates.at(-1).nextNotes.includes('"neutralizationStatus":"ARCHIVED"'), "neutralization status should mirror");
}

async function redecorationLegacyTaskMapsToRelationalTask() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  reservation.productionNotes = legacyMeta({
    tasks: [{
      id: "legacy-red-1",
      kind: "decoration",
      status: "IN_PROGRESS",
      taskType: "redecoration",
      taskDate: "2026-07-20T00:00:00.000Z"
    }]
  });
  const response = await patch(session("coo-1", "COO"), { kind: "decoration", status: "DONE", taskId: "legacy-red-1" });
  assert.equal(response.status, 200);
  const task = [...tasks.values()].find((item) => item.legacyTaskId === "legacy-red-1");
  assert(task, "legacy extra task should create relational task");
  assert.equal(task.kind, "REDECORATION");
  assert.equal(task.status, "DONE");
  assert(noteUpdates.at(-1).nextNotes.includes('"id":"legacy-red-1"'), "legacy task metadata should remain mirrored");
  assert(noteUpdates.at(-1).nextNotes.includes('"status":"DONE"'), "legacy task status should mirror");
}

async function corruptedProductionNotesFallsThroughSafely() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  reservation.productionNotes = "corrupted <!--focus-ops:{not-json--> metadata";
  const response = await patch(session("coo-1", "COO"), { kind: "decoration", status: "DONE" });
  assert.equal(response.status, 200);
  assert(noteUpdates.at(-1).nextNotes.includes('"decorationStatus":"DONE"'), "corrupted metadata should be replaced safely");
}

async function tableUnavailableFallsBackToLegacyBeforeWrite() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  tableUnavailable = true;
  const response = await patch(session("coo-1", "COO"), { kind: "decoration", status: "DONE" });
  assert.equal(response.status, 200);
  assert.equal(noteUpdates.length, 1, "table failure should fall back to legacy mirror");
  assert(noteUpdates[0].legacy, "fallback should use legacy helper");
  assert(noteUpdates[0].nextNotes.includes('"decorationStatus":"DONE"'));
}

async function operationTaskWriteFailureDoesNotFallback() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  seedTask({ id: "existing-decoration", kind: "DECORATION", dedupeKey: "reservation:reservation-1:DECORATION:base" });
  operationUpdateFailure = true;
  const response = await patch(session("coo-1", "COO"), { kind: "decoration", status: "DONE" });
  assert.equal(response.status, 400);
  assert.equal(noteUpdates.length, 0, "OperationTask write failure must not fallback to legacy");
  assert.equal(tasks.get("existing-decoration").status, "NEW", "failed write should not mutate OperationTask");
}

async function mirrorFailureRollsBackOperationTaskWrite() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  seedTask({ id: "existing-decoration", kind: "DECORATION", dedupeKey: "reservation:reservation-1:DECORATION:base" });
  mirrorFailure = true;
  const response = await patch(session("coo-1", "COO"), { kind: "decoration", status: "DONE" });
  assert.equal(response.status, 400);
  assert.equal(tasks.get("existing-decoration").status, "NEW", "transaction rollback should restore OperationTask status");
  assert.equal(noteUpdates.length, 0, "failed mirror should not persist productionNotes");
  assert.equal(auditCalls.length, 0, "failed bridge should not write audit");
}

async function postFlagOffUsesLegacyPath() {
  reset();
  delete process.env.OPERATION_TASKS_ENABLED;
  reservation.status = "BOOKED";
  const response = await post(session("coo-1", "COO"), postBody({ taskId: "post-red-1" }));
  assert.equal(response.status, 200);
  assert.equal(tasks.size, 0, "flag off POST must not create OperationTask");
  assert.equal(noteUpdates.length, 1);
  assert(response.body.reservation, "POST response should include reservation");
  assert(response.body.task, "POST response should keep task payload");
}

async function postFlagOnCreatesOperationTaskAndMirrors() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  reservation.status = "BOOKED";
  const response = await post(session("coo-1", "COO"), postBody({ taskId: "post-red-1" }));
  assert.equal(response.status, 200);
  const task = [...tasks.values()].find((item) => item.legacyTaskId === "post-red-1");
  assert(task, "flag on POST should create OperationTask");
  assert.equal(task.kind, "REDECORATION");
  assert(noteUpdates.at(-1).transactional, "POST mirror should be transactional");
  assert(noteUpdates.at(-1).nextNotes.includes('"id":"post-red-1"'), "POST should mirror legacy task metadata");
  assert(response.body.reservation);
  assert.equal(response.body.task.id, "post-red-1");
}

async function repeatedPostWithStableTaskIdDoesNotCreateDuplicate() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  reservation.status = "BOOKED";
  let response = await post(session("admin-1", "SUPER_ADMIN"), postBody({ taskId: "stable-red" }));
  assert.equal(response.status, 200);
  response = await post(session("admin-1", "SUPER_ADMIN"), postBody({ taskId: "stable-red" }));
  assert.equal(response.status, 200);
  const matching = [...tasks.values()].filter((item) => item.legacyTaskId === "stable-red");
  assert.equal(matching.length, 1, "stable task id should not create duplicate OperationTask");
  assert.equal((reservation.productionNotes.match(/stable-red/g) || []).length, 1, "stable task id should not duplicate productionNotes task");
}

async function postCorruptedProductionNotesDoesNotCrash() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  reservation.status = "BOOKED";
  reservation.productionNotes = "corrupted <!--focus-ops:{not-json--> metadata";
  const response = await post(session("coo-1", "COO"), postBody({ taskId: "post-corrupt" }));
  assert.equal(response.status, 200);
  assert([...tasks.values()].some((item) => item.legacyTaskId === "post-corrupt"));
}

async function invalidInputsAndRbacStillHold() {
  reset();
  process.env.OPERATION_TASKS_ENABLED = "true";
  let response = await patch(session("agent-1", "SALES_AGENT"), { kind: "decoration", status: "DONE" });
  assert.equal(response.status, 403, "sales agent denied");

  response = await post(session("agent-1", "SALES_AGENT"), postBody({ taskId: "sales-post" }));
  assert.equal(response.status, 403, "sales agent denied for POST");

  response = await patch(session("coo-1", "COO"), { kind: "redecoration", status: "DONE" });
  assert.equal(response.status, 400, "invalid kind rejected");

  response = await patch(session("coo-1", "COO"), { kind: "decoration", status: "BROKEN" });
  assert.equal(response.status, 400, "invalid status rejected");
}

function patch(sessionValue, body) {
  return route.PATCH({
    session: sessionValue,
    json: async () => body
  }, {
    params: Promise.resolve({ id: "reservation-1" })
  });
}

function post(sessionValue, body) {
  return route.POST({
    session: sessionValue,
    json: async () => body
  }, {
    params: Promise.resolve({ id: "reservation-1" })
  });
}

function reset() {
  auditCalls.length = 0;
  noteUpdates.length = 0;
  taskCalls.length = 0;
  tasks.clear();
  createCounter = 0;
  tableUnavailable = false;
  operationUpdateFailure = false;
  mirrorFailure = false;
  reservation = baseReservation();
}

function seedTask(overrides) {
  const task = {
    id: overrides.id,
    reservationId: "reservation-1",
    campaignId: "campaign-1",
    locationId: "location-1",
    kind: overrides.kind,
    status: "NEW",
    source: "SYSTEM_DERIVED",
    dedupeKey: overrides.dedupeKey,
    legacyTaskId: overrides.legacyTaskId || null,
    scheduledFor: new Date("2026-07-01T00:00:00.000Z"),
    completedAt: null,
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
    status: "BOOKED",
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    periodEnd: new Date("2026-08-31T00:00:00.000Z"),
    installationDate: new Date("2026-07-03T00:00:00.000Z"),
    neutralizationDate: new Date("2026-08-28T00:00:00.000Z"),
    productionNotes: null
  };
}

function postBody(overrides = {}) {
  return {
    kind: "decoration",
    taskType: "redecoration",
    requestedDate: "2026-07-20T00:00:00.000Z",
    cost: 120,
    currency: "RON",
    costOwner: "client",
    note: "Schimbare vizual",
    briefUrl: "https://example.invalid/brief.pdf",
    ...overrides
  };
}

function session(id, role) {
  return {
    id,
    role,
    email: `${id}@example.invalid`,
    name: id,
    tokenVersion: 1,
    iat: 1,
    exp: 9999999999
  };
}

function legacyMeta(meta) {
  return `Plain production notes\n<!--focus-ops:${JSON.stringify(meta)}-->`;
}
