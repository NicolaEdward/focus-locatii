import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
import { prisma } from "../src/lib/prisma";
import { listOperationalExecutionHistory } from "../src/lib/operational-execution-history";

async function main() {
  loadEnvFile(); assertSyntheticEnvironment();
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(process.env.DATABASE_URL || "invalid:").hostname));
  assert.notEqual(process.env.NODE_ENV, "production");
  const tag = `sim-execution-${randomUUID()}`;
  const seller = `${tag}-seller`, other = `${tag}-other`, category = `${tag}-category`, location = `${tag}-location`;
  const rentals = ["0-limit", "1-cancelled", "2-legacy", "3-foreign"].map((id) => `${tag}-${id}`);
  const actor = { id: seller, email: `${seller}@example.invalid`, name: "SIM Seller", role: "SALES_AGENT" } as any;
  const checked: string[] = [];
  try {
    await prisma.user.createMany({ data: [seller, other].map((id) => ({ id, email: `${id}@example.invalid`, name: id, passwordHash: "synthetic-unusable", role: "SALES_AGENT", active: true })) });
    await prisma.category.create({ data: { id: category, name: tag, slug: tag } });
    await prisma.location.create({ data: { id: location, categoryId: category, code: tag, city: "SIM Bucuresti", type: "Mesh", showInPublic: false } });
    await prisma.reservation.createMany({ data: rentals.map((id, index) => ({
      id, locationId: location, clientName: `SIM Client ${index}`, status: index === 1 ? "CANCELLED" : "BOOKED",
      periodStart: new Date("2080-01-01Z"), periodEnd: new Date("2080-01-31Z"), ownerId: index === 3 ? other : seller, sellerUserId: index === 3 ? other : seller,
      currency: "EUR", productionNotes: index === 2 ? '<!--focus-ops:{"decorationStatus":"DONE","decorationUpdatedAt":"2092-01-04T12:00:00Z","decorationCost":50,"decorationCurrency":"RON"}-->'
        : index === 1 ? '<!--focus-ops:{"decorationStatus":"DONE","decorationUpdatedAt":"2092-01-04T12:00:00Z","decorationCost":999,"decorationCurrency":"EUR"}-->' : null
    })) });
    await prisma.operationTask.createMany({ data: [
      { id: `${tag}-cancelled`, reservationId: rentals[1], locationId: location, kind: "DECORATION", status: "DONE", scheduledFor: new Date("2092-01-03Z"), completedAt: new Date("2092-01-04Z"), cost: 250, currency: "RON", createdByUserId: seller },
      { id: `${tag}-unknown`, reservationId: rentals[1], locationId: location, kind: "REDECORATION", status: "DONE", scheduledFor: new Date("2092-01-03Z"), completedAt: new Date("2092-01-04Z"), cost: null, currency: null, createdByUserId: seller },
      { id: `${tag}-foreign`, reservationId: rentals[3], locationId: location, kind: "DECORATION", status: "DONE", completedAt: new Date("2092-01-04Z"), cost: 500, currency: "EUR", createdByUserId: other },
      ...Array.from({ length: 101 }, (_, index) => ({ id: `${tag}-bulk-${String(index).padStart(3, "0")}`, reservationId: rentals[0], locationId: location, kind: "REDECORATION" as const, status: "DONE" as const, completedAt: new Date("2092-01-04Z"), cost: 1, currency: "RON", createdByUserId: seller }))
    ] });
    const page = await listOperationalExecutionHistory(actor, { month: "2092-01", pageSize: 50 });
    assert.ok(page.rows.every((row) => row.reservationId !== rentals[3]));
    const cancelled = page.rows.filter((row) => row.reservationId === rentals[1]);
    assert.equal(cancelled.length, 2); assert.ok(cancelled.every((row) => row.billingReview === "rental_status_review"));
    assert.equal(cancelled.find((row) => row.taskType === "initial")?.cost, 250);
    assert.equal(cancelled.find((row) => row.taskType === "initial")?.currency, "RON");
    assert.equal(cancelled.find((row) => row.taskType === "redecoration")?.currency, null);
    assert.equal(cancelled.find((row) => row.taskType === "redecoration")?.cost, null);
    checked.push("cancelled performed work survives, relational mirror deduplicates, unknown amounts/currencies remain null, foreign seller data excluded");
    assert.equal(page.rows.find((row) => row.reservationId === rentals[2])?.cost, 50);
    checked.push("legacy completion month is independent of the rental period");
    assert.equal(page.limitedTaskGroups, 1); assert.equal(page.coverage, "task_limit_requires_review");
    assert.equal(page.rows.filter((row) => row.reservationId === rentals[0]).length, 100);
    checked.push("more than 100 tasks are bounded and explicitly flagged incomplete");
    const seen = new Set<string>(); let cursor: string | null = null;
    for (let index = 0; index < 10; index++) {
      const part = await listOperationalExecutionHistory(actor, { month: "2092-01", after: cursor, pageSize: 1 });
      for (const row of part.rows) assert.ok(!seen.has(row.key)), seen.add(row.key);
      cursor = part.nextCursor; if (!cursor) break;
    }
    assert.equal(seen.size, page.rows.length);
    checked.push("deterministic cursor pages neither duplicate nor lose visible executions");
    await assert.rejects(() => listOperationalExecutionHistory({ ...actor, role: "FIELD_OPERATOR" }, { month: "2092-01" }), (error: any) => error.status === 403);
    await assert.rejects(() => listOperationalExecutionHistory({ ...actor, role: "FINANCE_OPERATOR" }, { month: "2092-01" }), (error: any) => error.status === 403);
    await assert.rejects(() => listOperationalExecutionHistory(actor, { month: "2092-13" }), (error: any) => error.status === 400);
    const manager = await listOperationalExecutionHistory({ ...actor, role: "COO" }, { month: "2092-01", pageSize: 50 });
    assert.ok(manager.rows.some((row) => row.reservationId === rentals[3]));
    checked.push("Field and unauthorized roles refused, invalid month refused, management scope preserved");
    const payload = JSON.stringify(page);
    for (const secretKey of ["productionNotes", "monthlyRentShare", "contractCompany", "ownerId", "clientEmail", "storageUrl"]) assert.equal(payload.includes(`\"${secretKey}\"`), false);
    checked.push("read response exposes a minimal ledger, not full rentals or attachments");
    console.log(JSON.stringify({ ok: true, checked }, null, 2));
  } finally {
    await prisma.operationTask.deleteMany({ where: { createdByUserId: { in: [seller, other] } } });
    await prisma.reservation.deleteMany({ where: { id: { in: rentals } } });
    await prisma.location.deleteMany({ where: { id: location } });
    await prisma.category.deleteMany({ where: { id: category } });
    await prisma.user.deleteMany({ where: { id: { in: [seller, other] } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
