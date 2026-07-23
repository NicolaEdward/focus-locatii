import assert from "node:assert/strict";
import type { UserRole } from "@prisma/client";
import { ADMIN_COOKIE, createSessionToken } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";

const baseUrl = process.env.EXECUTIVE_MEASURE_URL || "http://127.0.0.1:3015";
const runs = Math.max(5, Math.min(50, Number(process.env.EXECUTIVE_MEASURE_RUNS || 20)));

async function main() {
  const [coo, dCeo] = await Promise.all([
    prisma.user.findFirst({ where: { active: true, role: "COO" }, select: userSelect }),
    prisma.user.findFirst({ where: { active: true, role: "D_CEO" }, select: userSelect })
  ]);
  assert(coo, "Contul sintetic COO lipseste.");
  assert(dCeo, "Contul sintetic D-CEO lipseste.");
  const before = await businessCounts();

  const cold = await timedRequest(
    "/api/admin/executive/overview?entity=BULGARIA&snapshot=2026-07-22&periodStart=2026-07-01&periodEnd=2026-07-22",
    cookieFor(dCeo)
  );
  assert.equal(cold.status, 200);
  assert(cold.bytes < 100_000, `DTO Executive Overview depaseste 100 KB: ${cold.bytes}.`);

  const apiRuns = [];
  const pageRuns = [];
  for (let index = 0; index < runs; index += 1) {
    apiRuns.push(await timedRequest("/api/admin/executive/overview?entity=BULGARIA&snapshot=2026-07-22&periodStart=2026-07-01&periodEnd=2026-07-22", cookieFor(dCeo)));
    pageRuns.push(await timedRequest("/admin/dashboard?entity=BULGARIA&snapshot=2026-07-22&periodStart=2026-07-01&periodEnd=2026-07-22", cookieFor(coo)));
  }
  assert(apiRuns.every((run) => run.status === 200), "Executive API a avut raspuns non-200.");
  assert(pageRuns.every((run) => run.status === 200), "Executive dashboard a avut raspuns non-200.");
  const after = await businessCounts();
  assert.deepEqual(after, before, "Benchmarkul Executive Overview a modificat date de business.");

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    runs,
    cold,
    apiWarm: summary(apiRuns),
    pageWarm: summary(pageRuns),
    businessCountsBefore: before,
    businessCountsAfter: after
  }, null, 2));
}

const userSelect = { id: true, email: true, name: true, role: true, tokenVersion: true } as const;

function cookieFor(user: { id: string; email: string; name: string; role: UserRole; tokenVersion: number }) {
  return `${ADMIN_COOKIE}=${createSessionToken(user)}`;
}

async function timedRequest(pathname: string, cookie: string) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { cookie, "x-request-id": `ecc-measure-${crypto.randomUUID()}` },
    redirect: "manual"
  });
  const body = await response.arrayBuffer();
  return {
    durationMs: Math.round(performance.now() - startedAt),
    status: response.status,
    bytes: body.byteLength,
    requestId: response.headers.get("x-request-id")
  };
}

function summary(rows: Array<{ durationMs: number; bytes: number }>) {
  const durations = rows.map((row) => row.durationMs).sort((a, b) => a - b);
  const bytes = rows.map((row) => row.bytes);
  return {
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    minMs: durations[0],
    maxMs: durations.at(-1),
    minBytes: Math.min(...bytes),
    maxBytes: Math.max(...bytes)
  };
}

function percentile(values: number[], quantile: number) {
  return values[Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1)];
}

async function businessCounts() {
  const [reservations, holds, booked, receivables, payments, notifications, operationTasks, documents] = await Promise.all([
    prisma.reservation.count(),
    prisma.reservation.count({ where: { status: "HOLD" } }),
    prisma.reservation.count({ where: { status: "BOOKED" } }),
    prisma.financialReceivable.count(),
    prisma.financialReceivablePayment.count(),
    prisma.appNotification.count(),
    prisma.operationTask.count(),
    prisma.clientDocument.count()
  ]);
  return { reservations, holds, booked, receivables, payments, notifications, operationTasks, documents };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
