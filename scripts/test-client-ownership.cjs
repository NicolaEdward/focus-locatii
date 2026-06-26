const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

const { hasClientOwnershipConflict } = loadTsModule(path.join(process.cwd(), "src", "lib", "clients.ts"), {
  "@/lib/prisma": { prisma: {} }
});

const agent = session("agent-1", "SALES_AGENT");
const director = session("director-1", "SALES_DIRECTOR");
const coo = session("coo-1", "COO");
const admin = session("admin-1", "SUPER_ADMIN");

assert.equal(hasClientOwnershipConflict(null, agent), false, "Sales agent creating a new client should be allowed.");
assert.equal(
  hasClientOwnershipConflict({ id: "client-1", accountOwnerUserId: "agent-1" }, agent),
  false,
  "Sales agent submitting same name for own client should be allowed."
);
assert.equal(
  hasClientOwnershipConflict({ id: "client-2", accountOwnerUserId: "agent-2" }, agent),
  true,
  "Sales agent submitting same name for foreign client must be rejected."
);
assert.equal(
  hasClientOwnershipConflict({ id: "client-3", accountOwnerUserId: "agent-2" }, director),
  true,
  "Sales director should not silently update a client owned by another seller through upsert."
);
assert.equal(
  hasClientOwnershipConflict({ id: "client-4", accountOwnerUserId: "agent-2" }, coo),
  false,
  "COO behavior should remain valid."
);
assert.equal(
  hasClientOwnershipConflict({ id: "client-5", accountOwnerUserId: "agent-2" }, admin),
  false,
  "SUPER_ADMIN behavior should remain valid."
);

console.log(JSON.stringify({
  ok: true,
  checked: [
    "sales agent creating a new client",
    "sales agent same name for own client",
    "sales agent same name for foreign client rejected",
    "sales director foreign client rejected",
    "COO/SUPER_ADMIN valid"
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
