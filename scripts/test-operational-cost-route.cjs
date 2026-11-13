const assert = require("node:assert/strict");
const { NextRequest } = require("next/server");
const { loadTsModule } = require("./load-ts-module.cjs");
let writes = 0;
let productionNotes = null;
const oldFlag = process.env.OPERATION_TASKS_ENABLED;
process.env.OPERATION_TASKS_ENABLED = "false";
const currentReservation = () => ({ id: "sim-rental", status: "BOOKED", productionNotes, ownerId: null, sellerUserId: null, salesperson: null });
const tx = { $queryRaw: async () => [], user: { findUnique: async () => ({ active: true, role: "COO", tokenVersion: 0 }) }, reservation: { findUnique: async () => currentReservation() } };
const storeNotes = async (_client, id, notes) => { writes++; productionNotes = notes; return { id, productionNotes: notes }; };
const route = loadTsModule("src/app/api/reservations/[id]/operations/route.ts", {
  "@/lib/auth": { requireAnyPermission: async () => ({ session: { id: "sim-cost-manager", name: "SIM Manager", role: "COO", tokenVersion: 0 } }) },
  "@/lib/prisma": { prisma: { ...tx, $transaction: async (callback) => callback(tx) } },
  "@/lib/operation-task-bridge": { bridgeReservationSelect: {} },
  "@/lib/reservations": { updateReservationProductionNotesWithClient: storeNotes, getReservation: async () => currentReservation() },
  "@/lib/transactional-audit": { recordTransactionalAudit: async () => {} },
  "@/lib/audit": { recordAudit: async () => {} },
  "@/lib/observability": { emitStructuredLog: () => {}, safeErrorCode: () => "SYNTHETIC" },
});

(async () => {
  const results = [];
  for (const [name, changes, expected] of [
    ["unknown estimate remains null", { cost: null, currency: null }, 200],
    ["explicit zero is a known value", { cost: 0, currency: "EUR" }, 200],
    ["verified RON installation cost accepted", { cost: "250.00", currency: "RON" }, 200],
    ["negative estimate rejected", { cost: -1, currency: "RON" }, 400],
    ["non-numeric estimate rejected", { cost: "unknown", currency: "RON" }, 400],
    ["a known estimate needs its own currency", { cost: 250, currency: null }, 400],
    ["unsupported estimate currency rejected", { cost: 250, currency: "USD" }, 400],
    ["missing stable request identifier refused", { taskId: null, cost: null, currency: null }, 428],
    ["invalid calendar date refused", { requestedDate: "2092-02-30", cost: null, currency: null }, 400],
    ["extra monetary precision refused", { cost: "250.001", currency: "RON" }, 400],
  ]) {
    const before = writes;
    try {
      const response = await route.POST(new NextRequest("http://127.0.0.1/api/reservations/sim-rental/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: `sim-cost-case-${results.length}`, kind: "decoration", taskType: "redecoration", requestedDate: "2092-01-05", ...changes }) }), { params: Promise.resolve({ id: "sim-rental" }) });
      const payload = await response.json();
      assert.equal(response.status, expected);
      if (expected !== 200) assert.equal(writes, before, "invalid requests cannot mutate an operational task");
      if (changes.cost === null && expected === 200) assert.equal(payload.task.cost, null);
      if (changes.cost === 0 && expected === 200) assert.equal(payload.task.cost, 0);
      results.push({ name, passed: true });
    } catch (error) { results.push({ name, passed: false, error: error.message }); }
  }
  try {
    const intent = { kind: "decoration", taskType: "redecoration", taskId: "sim-stable-request", requestedDate: "2092-01-05", cost: 250, currency: "RON" };
    async function post(data) { return route.POST(new NextRequest("http://127.0.0.1/api/reservations/sim-rental/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), { params: Promise.resolve({ id: "sim-rental" }) }); }
    assert.equal((await post(intent)).status, 200);
    const beforeRetry = writes;
    assert.equal((await post(intent)).status, 200);
    assert.equal(writes, beforeRetry, "the same intent cannot append the same task twice");
    results.push({ name: "stable task intent retry has one effect", passed: true });
  } catch (error) { results.push({ name: "stable task intent retry has one effect", passed: false, error: error.message }); }
  try {
    const response = await route.POST(new NextRequest("http://127.0.0.1/api/reservations/sim-rental/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "decoration", taskType: "redecoration", taskId: "sim-stable-request", requestedDate: "2092-01-05", cost: 251, currency: "RON" }) }), { params: Promise.resolve({ id: "sim-rental" }) });
    assert.equal(response.status, 409);
    results.push({ name: "changed payload with the same intent is refused", passed: true });
  } catch (error) { results.push({ name: "changed payload with the same intent is refused", passed: false, error: error.message }); }
  console.log(JSON.stringify({ ok: results.every((row) => row.passed), results }, null, 2));
  if (results.some((row) => !row.passed)) process.exitCode = 1;
})().finally(() => {
  if (oldFlag === undefined) delete process.env.OPERATION_TASKS_ENABLED; else process.env.OPERATION_TASKS_ENABLED = oldFlag;
});
