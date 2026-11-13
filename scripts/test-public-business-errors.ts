import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

// Execute the actual route handlers with injected failing dependencies. Nothing
// connects to a database, and no production endpoint is faulted for this test.
class ClientMutationError extends Error {
  constructor(message: string, readonly status = 403) { super(message); }
}
const logs: unknown[][] = [];
const helpers = loadModule("src/lib/public-business-error.ts", {
  zod: { z }, "@/lib/clients": { ClientMutationError },
  "@/lib/observability": {
    emitStructuredLog: (...args: unknown[]) => logs.push(args),
    requestCorrelationId: (request: Request) => request.headers.get("x-request-id") || "synthetic-request-id",
  },
}) as {
  publicBusinessErrorMessage: (error: unknown, fallback: string, operation?: string) => string;
  publicBusinessErrorStatus: (error: unknown, fallback?: number) => number;
};

function loadModule(file: string, mocks: Record<string, unknown>) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exported: Record<string, unknown> = {};
  runInNewContext(output, { Error, SyntaxError, exports: exported, require: (name: string) => {
    assert.ok(Object.hasOwn(mocks, name), `${file}: unexpected dependency ${name}`);
    return mocks[name];
  } }, { filename: file });
  return exported;
}

const cases: Array<{ path: string; method: string; body?: object }> = [
  { path: "clients", method: "GET" },
  { path: "clients", method: "POST", body: { companyName: "Synthetic Company" } },
  { path: "clients/[id]", method: "GET" },
  { path: "clients/[id]", method: "PATCH", body: { companyName: "Synthetic Company" } },
  { path: "clients/[id]/contacts", method: "GET" },
  { path: "clients/[id]/contacts", method: "POST", body: { name: "Synthetic Contact" } },
  { path: "clients/[id]/campaigns", method: "GET" },
  { path: "clients/[id]/documents", method: "GET" },
  { path: "clients/[id]/finance", method: "GET" },
  { path: "clients/finance", method: "GET" },
  { path: "clients/merge/preview", method: "GET" },
  { path: "clients/merge", method: "POST", body: { primaryClientId: "a", duplicateClientId: "b" } },
  { path: "campaigns", method: "GET" },
  { path: "campaigns", method: "POST", body: { campaignName: "Synthetic Campaign", clientId: "a" } },
  { path: "campaigns/[id]", method: "GET" },
  { path: "campaigns/[id]", method: "PATCH", body: { campaignName: "Synthetic Campaign" } },
  { path: "campaigns/[id]", method: "DELETE" },
  { path: "campaigns/[id]/documents", method: "GET" },
  { path: "campaigns/[id]/finance", method: "GET" },
  { path: "campaigns/[id]/reservations", method: "GET" },
  { path: "onboarding", method: "GET" },
];

let injected: unknown;
let dependencyCalls = 0;
let denied = false;
let authUnavailable = false;
const fail = async () => { dependencyCalls++; throw injected; };
const workspace = Object.fromEntries(["getClientsPage", "getClientOverview", "getClientContacts", "getClientDocuments", "getClientFinanceSummary", "getClientPortfolioFinance", "getClientMergePreview", "getCampaignsPage", "getCampaignOverview", "getCampaignDocuments", "getCampaignFinanceSummary", "getCampaignReservations"].map((name) => [name, fail]));
const routeMocks: Record<string, unknown> = {
  "next/server": { NextRequest, NextResponse }, zod: { z },
  "@/lib/public-business-error": helpers,
  "@/lib/auth": {
    requireAnyPermission: async () => denied
      ? { session: null, response: NextResponse.json({ error: "Interzis" }, { status: 403, headers: { "Cache-Control": "no-store" } }) }
      : { session: { id: "synthetic-user", role: "COO" } },
    getAuthSessionFromRequest: async () => { if (authUnavailable) throw injected; return denied ? null : { id: "synthetic-user", role: "COO" }; },
  },
  "@/lib/workplace-onboarding": { onboardingState: fail },
  "@/lib/request-security": { mutationRequestError: () => null },
  "@/lib/bounded-json-request": {},
  "@/lib/client-campaign-workspaces": { ...workspace, CAMPAIGN_DATE_FILTERS: [] },
  "@/lib/campaigns/campaign-effective-status": { CAMPAIGN_EFFECTIVE_STATUSES: [] },
  "@/lib/company-entities": { companyEntities: [] },
  "@/lib/audit": { recordAudit: fail },
  "@/lib/transactional-audit": { recordTransactionalAudit: fail },
  "@/lib/observability": { observeRoute: (_request: unknown, _options: unknown, handler: () => unknown) => handler(), setObservabilityRole: () => {} },
  "@/lib/clients": { ClientMutationError, withAuthorizedClientMutation: fail, mergeClientAccounts: fail },
  "@/lib/campaigns": { createCampaign: fail, updateCampaign: fail, archiveCampaign: fail },
  "@/lib/prisma": { prisma: { campaign: { findUnique: fail } } },
  "@/lib/seller-users": { resolveRequiredSalesOwner: fail },
};

async function call(test: typeof cases[number]) {
  const file = `src/app/api/admin/${test.path}/route.ts`;
  const module = loadModule(file, routeMocks) as Record<string, (request: NextRequest, context: unknown) => Promise<NextResponse>>;
  const request = new NextRequest(`http://localhost/api/admin/${test.path.replace("[id]", "synthetic-id")}`, {
    method: test.method,
    headers: { "x-request-id": "synthetic-request-id", ...(test.body ? { "Content-Type": "application/json" } : {}) },
    ...(test.body ? { body: JSON.stringify(test.body) } : {}),
  });
  return module[test.method](request, { params: Promise.resolve({ id: "synthetic-id" }) });
}

async function main() {
  const diagnostic = "Invalid `prisma.clientAccount.findUnique()` invocation: SELECT taxId FROM private_clients; Server has closed the connection. mysql://private:password@db.invalid/main";
  injected = Object.assign(new Error(diagnostic), { name: "PrismaClientKnownRequestError", code: "P1017" });
  for (const test of cases) {
    dependencyCalls = 0;
    const logCount = logs.length;
    const response = await call(test);
    assert.equal(response.status, 503, `${test.method} ${test.path}: database outage must not look like access denial or user validation`);
    assert.ok(response.headers.get("Cache-Control")?.includes("no-store"));
    const text = JSON.stringify(await response.json());
    assert.equal(/prisma|SELECT|taxId|private_clients|db\.invalid|password|mysql|invocation|closed the connection/.test(text), false, `${test.path}: private database diagnostics leaked`);
    assert.equal(dependencyCalls, 1, `${test.path}: a failure must not replay a write or read automatically`);
    assert.equal(logs.length, logCount + 1, `${test.path}: the hidden failure remains observable`);
    const log = JSON.stringify(logs[logs.length - 1]);
    assert.ok(log.includes("P1017"));
    assert.ok(log.includes("synthetic-request-id"), "the safe error can be correlated to the actual request");
    assert.ok(log.includes(test.method), "the safe event records the method without retaining submitted data");
    assert.equal(log.includes(diagnostic), false, "diagnostic logs retain safe codes, not the raw database query or credentials");
  }

  const ownershipConflict = new ClientMutationError("Clientul exista deja la alt owner.", 409);
  injected = ownershipConflict;
  let response = await call(cases[1]);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, ownershipConflict.message, "typed ownership conflict remains actionable");
  injected = new ClientMutationError("Sesiunea a fost revocata. Reia autentificarea.", 401);
  response = await call(cases[1]);
  assert.equal(response.status, 401, "typed session revocation retains authentication status");
  const campaignRule = new Error("Campania trebuie legata de un client activ.");
  injected = campaignRule;
  response = await call(cases[13]);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, campaignRule.message, "reviewed campaign rules remain understandable");
  const lifecycleRule = new Error("Tranzitia campaniei din archived in active nu este permisa.");
  injected = lifecycleRule;
  response = await call(cases[15]);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, lifecycleRule.message, "formatted enum-only lifecycle error remains actionable");

  for (const [code, expected] of [["P2002", 409], ["P2003", 409], ["P2025", 404], ["P2034", 409], ["ER_DUP_ENTRY", 409], ["ER_LOCK_DEADLOCK", 409], ["ER_ACCESS_DENIED_ERROR", 503], ["ENOTFOUND", 503]] as const) {
    injected = Object.assign(new Error("private underlying detail"), { code });
    response = await call(cases[13]);
    assert.equal(response.status, expected, `typed database code ${code} maps to its correct safe outcome`);
    assert.equal(JSON.stringify(await response.json()).includes("private underlying detail"), false);
  }
  injected = new Error("programmer error with unrelated private detail");
  response = await call(cases[13]);
  assert.equal(response.status, 500, "an unknown failure must not blame the user's input");
  assert.equal(JSON.stringify(await response.json()).includes("unrelated private detail"), false);
  response = await call({ path: "clients", method: "POST", body: { companyName: "x", generalEmail: "private-invalid-address" } });
  assert.equal(response.status, 400);
  const validation = await response.json();
  assert.ok(validation.error.includes("câmpurile obligatorii"));
  assert.equal(JSON.stringify(validation).includes("private-invalid-address"), false, "validation does not echo raw submitted values");

  denied = true; dependencyCalls = 0;
  response = await call(cases[1]);
  assert.equal(response.status, 403);
  assert.equal(dependencyCalls, 0, "error normalization does not bypass the original authorization gate");
  response = await call(cases[cases.length - 1]);
  assert.equal(response.status, 401, "onboarding still requires an authenticated account");
  assert.equal(dependencyCalls, 0);
  denied = false; authUnavailable = true;
  injected = Object.assign(new Error("private authentication connection detail"), { code: "ECONNREFUSED" });
  response = await call(cases[cases.length - 1]);
  assert.equal(response.status, 503, "onboarding auth lookup failure returns JSON, not an unhandled HTML page");
  assert.ok((await response.json()).error.includes("Ghidul"));
  assert.equal(dependencyCalls, 0, "a failed authentication lookup never reads progress");
  console.log(JSON.stringify({ ok: true, routeFailureCases: cases.length, additionalGroups: 9, databaseAccess: false, scope: "actual API handlers, private diagnostics, typed business rules, constraint statuses, no-store and observability" }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
