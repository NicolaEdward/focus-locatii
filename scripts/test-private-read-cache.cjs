const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

let deniedStatus = 401, businessCalls = 0;
const deny = async () => ({ session: null, response: new Response(JSON.stringify({ error: "Authentication required" }), { status: deniedStatus, headers: { "X-Test-Sentinel": "preserved" } }) });
const forbiddenBusinessCall = () => { businessCalls++; throw new Error("An unauthorized read must stop before accessing business data"); };
const stubs = {
  "@/lib/auth": { requirePermission: deny, requireAnyPermission: deny },
  "@/lib/commercial-options": { commercialOptions: forbiddenBusinessCall },
  "@/lib/location-selection-availability": { getLocationSelectionAvailability: forbiddenBusinessCall },
  "@/lib/quote-hold-context": { resolveQuoteHoldContext: forbiddenBusinessCall },
  "@/lib/client-document-access": { resolveDocumentAccess: forbiddenBusinessCall, evaluateDocumentAccess: forbiddenBusinessCall, linksFromDocument: forbiddenBusinessCall },
  "@/lib/operational-proof": { OPERATIONAL_PROOF_DOCUMENT_TYPE: "operational_proof" },
  "@/lib/prisma": { prisma: {} },
  "@/lib/observability": { observeRoute: async (_request, _config, run) => run(), setObservabilityRole: () => undefined },
};
const routes = [
  ["src/app/api/admin/commercial-options/route.ts", "GET"],
  ["src/app/api/admin/receivables/[id]/documents/route.ts", "GET"],
  ["src/app/api/admin/location-selection/availability/route.ts", "POST"],
];
(async () => {
  let checks = 0;
  for (const [filename, method] of routes) {
    const route = loadTsModule(path.join(process.cwd(), filename), stubs);
    for (const status of [401, 403]) {
      deniedStatus = status;
      const response = await route[method]({ headers: new Headers(), method }, { params: Promise.resolve({ id: "synthetic-invoice" }) });
      assert.equal(response.status, status);
      assert.match(response.headers.get("Cache-Control"), /(?:^|[ ,])no-store(?:$|[ ,])/);
      assert.equal(response.headers.get("Vary"), "Cookie");
      assert.equal(response.headers.get("X-Test-Sentinel"), "preserved");
      assert.deepEqual(await response.json(), { error: "Authentication required" });
      checks++;
    }
  }
  assert.equal(businessCalls, 0);
  console.log(JSON.stringify({ suite: "private-read-cache", groups: checks, passed: checks, businessDataAccesses: businessCalls, databaseConnections: 0 }));
})().catch((error) => { console.error(error); process.exitCode = 1; });
