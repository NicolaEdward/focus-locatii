import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import { isClosedDatabaseConnection, retryClosedConnectionRead } from "../src/lib/database-read-retry";
import { reservationMutationFailure } from "../src/lib/reservation-amendments";

async function main() {
  const closed = Object.assign(new Error("Server has closed the connection."), { code: "P1017" });
  let calls = 0;
  const result = await retryClosedConnectionRead(async () => {
    if (++calls === 1) throw closed;
    return { id: "client" };
  });
  assert.deepEqual(result, { id: "client" });
  assert.equal(calls, 2, "a disconnected read recovers on the second attempt");

  calls = 0;
  await assert.rejects(retryClosedConnectionRead(async () => {
    calls++;
    throw closed;
  }), (error) => error === closed);
  assert.equal(calls, 2, "persistent failures stop after one retry");

  for (const error of [new Error("Clientul selectat nu exista."), { code: "P2002" }, { code: "P2028" }]) {
    calls = 0;
    await assert.rejects(retryClosedConnectionRead(async () => {
      calls++;
      throw error;
    }), (caught) => caught === error);
    assert.equal(calls, 1, "validation, constraints and transaction failures are not retried");
  }
  assert.equal(isClosedDatabaseConnection(null), false);
  assert.equal(isClosedDatabaseConnection(new Error("P1017")), false);
  await reservationRouteDoesNotReplayWrites(closed);
  console.log("Database read recovery: passed");
}

async function reservationRouteDoesNotReplayWrites(closed: Error) {
  const source = readFileSync("src/app/api/reservations/route.ts", "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  let writes = 0;
  let failure: Error = closed;
  const logs: unknown[][] = [];
  const mocks: Record<string, unknown> = {
    "next/server": { NextRequest, NextResponse },
    "@/lib/auth": { requireAnyPermission: async () => ({ session: { role: "SALES_AGENT" } }) },
    "@/lib/reservations": { createReservation: async () => { writes++; throw failure; } },
    "@/lib/audit": { recordAudit: async () => {} },
    "@/lib/observability": {
      observeRoute: (_request: unknown, _options: unknown, callback: () => unknown) => callback(),
      setObservabilityRole: () => {},
      emitStructuredLog: (...args: unknown[]) => logs.push(args)
    },
    "@/lib/database-read-retry": { isClosedDatabaseConnection },
    "@/lib/reservation-amendments": { reservationMutationFailure }
  };
  const exported: { POST?: (request: NextRequest) => Promise<NextResponse> } = {};
  runInNewContext(compiled.outputText, { Error, exports: exported, require: (name: string) => {
    assert.ok(name in mocks, `unexpected route dependency: ${name}`);
    return mocks[name];
  } });
  const request = () => new NextRequest("http://localhost/api/reservations", { method: "POST", body: "{}" });
  const response = await exported.POST!(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control")?.includes("no-store"), true);
  const body = await response.json();
  assert.equal(body.code, "RESERVATION_DATABASE_CONNECTION_CLOSED");
  assert.equal(JSON.stringify(body).includes(closed.message), false, "Prisma internals stay private");
  assert.equal(writes, 1, "the route never replays a write with an unknown commit outcome");
  assert.equal(logs.length, 1, "connection failures remain observable");

  failure = new Error("Campania selectata nu apartine clientului ales.");
  const invalid = await exported.POST!(request());
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, failure.message, "business validation remains actionable");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
