const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

const auditCalls = [];
const updates = [];
let productionNotes = "corrupted <!--focus-ops:{not-json--> metadata";

const nextResponse = {
  json: (body, init = {}) => ({ body, status: init.status || 200, headers: init.headers || {} })
};

const route = loadTsModule(path.join(process.cwd(), "src", "app", "api", "reservations", "[id]", "operations", "route.ts"), {
  "next/server": { NextResponse: nextResponse },
  "@/lib/auth": {
    requirePermission: async (request, permission) => {
      assert.equal(permission, "campaigns.operate", "operations PATCH must require campaigns.operate");
      const session = request.session;
      if (!session || !["COO", "SUPER_ADMIN"].includes(session.role)) {
        return {
          session: null,
          response: nextResponse.json({ error: "Forbidden" }, { status: 403 })
        };
      }
      return { session, response: null };
    }
  },
  "@/lib/prisma": {
    prisma: {
      reservation: {
        findUnique: async ({ where }) => where.id === "missing" ? null : { productionNotes }
      }
    }
  },
  "@/lib/reservations": {
    updateReservationProductionNotes: async (id, nextNotes, actor) => {
      updates.push({ id, nextNotes, actor });
      productionNotes = nextNotes;
      return { id, productionNotes: nextNotes };
    }
  },
  "@/lib/audit": {
    recordAudit: async (input) => {
      auditCalls.push(input);
    }
  }
});

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});

async function main() {
  let response = await patch(session("agent-1", "SALES_AGENT"), { kind: "decoration", status: "DONE" });
  assert.equal(response.status, 403, "sales agent denied even for own reservation-style mutation");
  assert.equal(updates.length, 0, "denied sales agent must not mutate productionNotes");

  response = await patch(session("coo-1", "COO"), { kind: "decoration", status: "DONE" });
  assert.equal(response.status, 200, "COO allowed");
  assert.equal(updates.length, 1, "COO mutation persisted");
  assert(updates[0].nextNotes.includes("focus-ops"), "corrupted metadata handled safely and replaced with valid metadata");
  assert.equal(auditCalls.at(-1).action, "operation.decoration.done", "successful operation status change writes audit");

  response = await patch(session("admin-1", "SUPER_ADMIN"), { kind: "neutralization", status: "IN_PROGRESS" });
  assert.equal(response.status, 200, "SUPER_ADMIN allowed");

  response = await patch(session("coo-1", "COO"), { kind: "redecoration", status: "DONE" });
  assert.equal(response.status, 400, "invalid operation kind rejected");
  assert.match(response.body.error, /Tip operational invalid/);

  response = await patch(session("coo-1", "COO"), { kind: "decoration", status: "BROKEN" });
  assert.equal(response.status, 400, "invalid operation status rejected");
  assert.match(response.body.error, /Status operational invalid/);

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "sales agent denied",
      "COO allowed",
      "SUPER_ADMIN allowed",
      "invalid status rejected",
      "invalid operation kind rejected",
      "corrupted productionNotes metadata safe",
      "audit written"
    ]
  }, null, 2));
}

function patch(sessionValue, body) {
  return route.PATCH({
    session: sessionValue,
    json: async () => body
  }, {
    params: Promise.resolve({ id: "reservation-1" })
  });
}

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
