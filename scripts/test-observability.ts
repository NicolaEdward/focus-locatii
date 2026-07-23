import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { reportAuditWriteFailure } from "../src/lib/audit";
import {
  createStructuredLogRecord,
  prismaSlowQueryThresholdMs,
  requestCorrelationId
} from "../src/lib/observability";
import { evaluatePerformanceBudget } from "../src/lib/observability-budgets";
import { GET as notificationCron } from "../src/app/api/cron/sync-financial-notifications/route";

async function main() {
  structuredLogsAreAllowlistedAndRedacted();
  correlationIdsAreValidated();
  slowQueryThresholdIsConfigurable();
  performanceBudgetsOnlyFailSevereRegressions();
  auditFailuresEmitATestableSignal();
  await cronFailuresAreSafeAndObservable();
  sourceCoverageIsPresent();
  console.log("Observability tests passed: redaction, correlation, slow queries, budgets, cron and audit failure signals.");
}

function structuredLogsAreAllowlistedAndRedacted() {
  const record = createStructuredLogRecord("error", "test_event", {
    route: "/api/test",
    operation: "test.operation",
    role: "COO",
    errorCode: "P2024",
    metrics: { rowCount: 12, ...({ invoiceAmount: 4000 } as object) },
    ...({ email: "private@example.test", invoiceNumber: "INV-1", amount: 4000, token: "secret" } as object)
  });
  const serialized = JSON.stringify(record);
  assert.equal(record.errorCode, "P2024");
  assert.equal(record.metrics?.rowCount, 12);
  for (const forbidden of ["private@example.test", "INV-1", "4000", "secret", "stack", "message"]) {
    assert.equal(serialized.includes(forbidden), false, `structured log leaked ${forbidden}`);
  }
}

function correlationIdsAreValidated() {
  const accepted = requestCorrelationId(new NextRequest("http://localhost/test", {
    headers: { "x-request-id": "req_test-12345678" }
  }));
  assert.equal(accepted, "req_test-12345678");
  const rejected = requestCorrelationId(new NextRequest("http://localhost/test", {
    headers: { "x-request-id": "client name and invoice 123" }
  }));
  assert.match(rejected, /^[0-9a-f-]{36}$/i);
}

function slowQueryThresholdIsConfigurable() {
  const previous = process.env.PRISMA_SLOW_QUERY_MS;
  process.env.PRISMA_SLOW_QUERY_MS = "750";
  assert.equal(prismaSlowQueryThresholdMs(), 750);
  process.env.PRISMA_SLOW_QUERY_MS = "12";
  assert.equal(prismaSlowQueryThresholdMs(), 500);
  if (previous === undefined) delete process.env.PRISMA_SLOW_QUERY_MS;
  else process.env.PRISMA_SLOW_QUERY_MS = previous;
}

function performanceBudgetsOnlyFailSevereRegressions() {
  assert.deepEqual(evaluatePerformanceBudget("public_locations_api", {
    durationMs: 600,
    payloadBytes: 20_000,
    queryCount: 2,
    slowQueryCount: 0
  }), []);
  const warning = evaluatePerformanceBudget("public_locations_api", { durationMs: 900 });
  assert.equal(warning[0]?.severity, "warning");
  const severe = evaluatePerformanceBudget("public_locations_api", { durationMs: 1_501 });
  assert.equal(severe[0]?.severity, "severe");
  assert.deepEqual(evaluatePerformanceBudget("executive_overview_api", {
    durationMs: 900,
    payloadBytes: 99_999,
    queryCount: 15,
    slowQueryCount: 0
  }), []);
  assert.equal(
    evaluatePerformanceBudget("executive_overview_api", { payloadBytes: 100_001 })[0]?.severity,
    "warning"
  );
}

function auditFailuresEmitATestableSignal() {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    reportAuditWriteFailure(
      { action: "test.audit", entityType: "test_entity", entityId: "internal-123" },
      Object.assign(new Error("private client data"), { code: "P2024" })
    );
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.event, "audit_write_failed");
  assert.equal(record.errorCode, "P2024");
  assert.equal(lines[0].includes("private client data"), false);
}

async function cronFailuresAreSafeAndObservable() {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const lines: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => lines.push(args.join(" "));
  let response: Response;
  try {
    response = await notificationCron(new NextRequest("http://localhost/api/cron/sync-financial-notifications"));
  } finally {
    console.error = originalError;
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
  assert.equal(response.status, 503);
  assert.ok(response.headers.get("x-request-id"));
  const body = await response.text();
  assert.equal(body.includes("CRON_SECRET"), false);
  assert.equal(body.toLowerCase().includes("stack"), false);
  assert.ok(lines.some((line) => line.includes('"event":"cron_failed"')));
}

function sourceCoverageIsPresent() {
  const audit = read("src/lib/audit.ts");
  const prisma = read("src/lib/prisma.ts");
  const proofCron = read("src/app/api/cron/delete-expired-operational-proof-photos/route.ts");
  const login = read("src/app/api/auth/login/route.ts");
  const reservations = read("src/lib/reservations.ts");
  assert.match(audit, /reportAuditWriteFailure/);
  assert.match(prisma, /prisma_slow_query/);
  assert.match(proofCron, /proof_storage_delete_failed/);
  assert.match(login, /login_rate_limited/);
  assert.match(reservations, /reservation_conflict/);
}

function read(path: string) {
  return readFileSync(path, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
