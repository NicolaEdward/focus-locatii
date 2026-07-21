const assert = require("node:assert/strict");
const fs = require("node:fs");
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

clientVisibilityAllowsSalesDeduplicationWithoutForeignEdits();

console.log(JSON.stringify({
  ok: true,
  checked: [
    "sales agent creating a new client",
    "sales agent same name for own client",
    "sales agent same name for foreign client rejected",
    "sales director foreign client rejected",
    "sales agents can view all registered clients for deduplication",
    "sales agents cannot edit/upload on clients owned by another seller",
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

function clientVisibilityAllowsSalesDeduplicationWithoutForeignEdits() {
  const clientsRoute = read("src", "app", "api", "admin", "clients", "route.ts");
  const workspaceService = read("src", "lib", "client-campaign-workspaces.ts");
  assert(
    !blockFrom(workspaceService, "export async function getClientsPage", "export async function getCampaignsPage").includes('accountOwnerUserId: session.id'),
    "GET /api/admin/clients should not hide foreign clients from sales agents"
  );
  assert(
    workspaceService.includes('status: { notIn: ["merged", "archived"] }'),
    "GET /api/admin/clients should still hide merged/archived clients"
  );
  assert(workspaceService.includes("canViewSensitiveClient"), "foreign client detail must be sanitized through one ownership policy");
  assert(workspaceService.includes('if (session.role === "SALES_AGENT") return accountOwnerUserId === session.id'), "foreign sensitive data must remain hidden from sales agents");
  const listBlock = blockFrom(workspaceService, "export async function getClientsPage", "export async function getCampaignsPage");
  assert(!listBlock.includes("contacts: {") && !listBlock.includes("generalEmail: true"), "client list must not expose contact details");
  assert(!listBlock.includes("documents: {") && !listBlock.includes("storageUrl"), "client list must not expose documents");

  const workspace = read("src", "components", "admin", "client-campaigns", "ClientsWorkspace.tsx");
  assert(workspace.includes("overview.canEdit"), "client workspace should separate visibility from edit rights");
  assert(workspace.includes("Vizibil doar pentru prevenirea duplicatelor"), "read-only foreign clients should be explained in the UI");
  assert(workspace.includes("DocumentUploadDialog") && workspace.includes("overview.canEdit"), "document uploads should follow the same client ownership rule");
}

function blockFrom(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}
