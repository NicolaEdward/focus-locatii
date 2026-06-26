const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

const { evaluateDocumentAccess } = loadTsModule(path.join(process.cwd(), "src", "lib", "client-document-access.ts"), {
  "@/lib/prisma": { prisma: {} }
});

const ownAgent = session("agent-1", "SALES_AGENT");
const foreignAgent = session("agent-2", "SALES_AGENT");
const coo = session("coo-1", "COO");
const admin = session("admin-1", "SUPER_ADMIN");
const finance = session("finance-1", "FINANCE_OPERATOR");

const ownClientDocument = resolved({ entity: "client", id: "client-1", ownerUserIds: ["agent-1"] });
assert.equal(evaluateDocumentAccess(ownAgent, ownClientDocument, "view"), null, "Own document download should be allowed.");
assert.equal(evaluateDocumentAccess(ownAgent, ownClientDocument, "manage"), null, "Own document archive should be allowed.");
assert.equal(evaluateDocumentAccess(foreignAgent, ownClientDocument, "view")?.status, 403, "Foreign document download must be rejected.");
assert.equal(evaluateDocumentAccess(foreignAgent, ownClientDocument, "manage")?.status, 403, "Foreign document archive must be rejected.");

const ownReservationUpload = resolved({ entity: "reservation", id: "res-1", ownerUserIds: ["agent-1"] });
assert.equal(evaluateDocumentAccess(ownAgent, ownReservationUpload, "manage"), null, "Upload to own linked reservation should be allowed.");
assert.equal(evaluateDocumentAccess(foreignAgent, ownReservationUpload, "manage")?.status, 403, "Upload to foreign linked reservation must be rejected.");

const foreignDocument = resolved({ entity: "client", id: "client-2", ownerUserIds: ["agent-2"] });
assert.equal(evaluateDocumentAccess(coo, foreignDocument, "view"), null, "COO cross-client document access should be allowed.");
assert.equal(evaluateDocumentAccess(admin, foreignDocument, "manage"), null, "SUPER_ADMIN cross-client archive should be allowed.");

assert.equal(
  evaluateDocumentAccess(finance, { ...foreignDocument, hasFinancialLink: false }, "view")?.status,
  403,
  "Finance users must not access non-financial client documents."
);
assert.equal(
  evaluateDocumentAccess(finance, { ...foreignDocument, hasFinancialLink: true }, "view"),
  null,
  "Finance users should access financial documents."
);

assert.equal(
  evaluateDocumentAccess(ownAgent, { ownerChecks: [], hasFinancialLink: false, missingLinks: ["clientId"] }, "view")?.status,
  404,
  "Missing linked entities should be rejected before ownership checks."
);

console.log(JSON.stringify({
  ok: true,
  checked: [
    "own document download",
    "foreign document download rejected",
    "own archive",
    "foreign archive rejected",
    "upload to own linked entity",
    "upload to foreign linked entity rejected",
    "admin/COO access allowed",
    "finance limited to financial documents"
  ]
}, null, 2));

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

function resolved(check) {
  return {
    ownerChecks: [check],
    hasFinancialLink: false,
    missingLinks: []
  };
}
