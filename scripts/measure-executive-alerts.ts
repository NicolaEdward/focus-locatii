import assert from "node:assert/strict";
import type { UserRole } from "@prisma/client";
import { ADMIN_COOKIE, createSessionToken } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";

const baseUrl = process.env.EXECUTIVE_ALERTS_MEASURE_URL || "http://127.0.0.1:3015";
const runs = Math.max(5, Math.min(50, Number(process.env.EXECUTIVE_ALERTS_MEASURE_RUNS || 20)));
const snapshot = process.env.EXECUTIVE_ALERTS_SNAPSHOT || "2026-07-24";

async function main() {
  const [coo, dCeo, superAdmin, seller] = await Promise.all([
    prisma.user.findFirst({ where: { active: true, role: "COO" }, select: userSelect }),
    prisma.user.findFirst({ where: { active: true, role: "D_CEO" }, select: userSelect }),
    prisma.user.findFirst({ where: { active: true, role: "SUPER_ADMIN" }, select: userSelect }),
    prisma.user.findFirst({ where: { active: true, role: "SALES_AGENT" }, select: userSelect })
  ]);
  assert(coo && dCeo && superAdmin && seller, "Lipsesc conturile sintetice pentru matricea Executive Alerts.");
  const before = await businessCounts();
  const pathname = `/api/admin/executive/alerts?snapshot=${snapshot}&limit=50`;
  const cold = await timedRequest(pathname, cookieFor(dCeo));
  assert.equal(cold.status, 200);
  assert(cold.bytes < 100_000, `Payload-ul Executive Alerts depășește 100 KB: ${cold.bytes}.`);
  const body = JSON.parse(cold.body);
  assert.equal(body.kind, "executive-alerts");
  assert(body.items.length <= 50);
  assert.equal(body.summary.total >= body.items.length, true);
  assert.equal(body.meta.queryBudget, 6);

  const roleChecks = await Promise.all([
    timedRequest(`${pathname}&severity=P1`, cookieFor(coo)),
    timedRequest(`${pathname}&domain=FINANCE`, cookieFor(dCeo)),
    timedRequest(`${pathname}&dataQuality=LOW`, cookieFor(superAdmin)),
    timedRequest(pathname, cookieFor(seller))
  ]);
  assert.deepEqual(roleChecks.map((row) => row.status), [200, 200, 200, 403]);

  const warmRuns = [];
  const pageRuns = [];
  for (let index = 0; index < runs; index += 1) {
    warmRuns.push(await timedRequest(pathname, cookieFor(dCeo)));
    pageRuns.push(await timedRequest(`/admin/dashboard?panel=alerts&snapshot=${snapshot}`, cookieFor(coo)));
  }
  assert(warmRuns.every((row) => row.status === 200));
  assert(pageRuns.every((row) => row.status === 200 && normalize(row.body).includes("executive alerts")));
  const after = await businessCounts();
  assert.deepEqual(after, before, "Executive Alerts a modificat date de business.");

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    runs,
    cold: withoutBody(cold),
    apiWarm: summary(warmRuns),
    pageWarm: summary(pageRuns),
    roleChecks: roleChecks.map(withoutBody),
    alertCounts: body.summary,
    returned: body.items.length,
    pagination: body.pagination,
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
    headers: { cookie, "x-request-id": `exec-alerts-${crypto.randomUUID()}` },
    redirect: "manual"
  });
  const body = await response.text();
  return {
    durationMs: Math.round(performance.now() - startedAt),
    status: response.status,
    bytes: Buffer.byteLength(body),
    requestId: response.headers.get("x-request-id"),
    body
  };
}

function summary(rows: Array<{ durationMs: number; bytes: number }>) {
  const durations = rows.map((row) => row.durationMs).sort((left, right) => left - right);
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

function withoutBody<T extends { body: string }>(row: T) {
  const { body: _body, ...rest } = row;
  return rest;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

async function businessCounts() {
  const [reservations, holds, booked, receivables, payments, notifications, operationTasks, documents, audits] = await Promise.all([
    prisma.reservation.count(),
    prisma.reservation.count({ where: { status: "HOLD" } }),
    prisma.reservation.count({ where: { status: "BOOKED" } }),
    prisma.financialReceivable.count(),
    prisma.financialReceivablePayment.count(),
    prisma.appNotification.count(),
    prisma.operationTask.count(),
    prisma.clientDocument.count(),
    prisma.auditLog.count()
  ]);
  return { reservations, holds, booked, receivables, payments, notifications, operationTasks, documents, audits };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

