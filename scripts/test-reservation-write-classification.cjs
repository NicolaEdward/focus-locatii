const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const clientsLib = read("src", "lib", "clients.ts");
const mergeRoute = read("src", "app", "api", "admin", "clients", "merge", "route.ts");
const commandCenterRoute = read("src", "app", "api", "admin", "command-center", "route.ts");
const legacySync = read("src", "lib", "legacy-reservations-sync.ts");
const legacySyncRoute = read("src", "app", "api", "admin", "reservations", "sync", "route.ts");

assert(
  mergeRoute.includes('import { mergeClientAccounts } from "@/lib/clients";'),
  "client merge route must call client merge domain helper"
);
assert(
  !/prisma\.reservation\.(create|update|updateMany|delete|deleteMany|upsert)\s*\(/.test(mergeRoute),
  "client merge route must not write reservations directly"
);
assert(
  /\["COO", "SUPER_ADMIN"\]\.includes\(session\.role\)/.test(mergeRoute),
  "client merge route must restrict merge to COO/SUPER_ADMIN"
);

assert(clientsLib.includes("export async function mergeClientAccounts"), "clients domain must expose mergeClientAccounts");
assert(clientsLib.includes("prisma.$transaction(async (tx)"), "client merge must run in one transaction");
assert(
  /tx\.campaign\.updateMany\(\{\s*where:\s*\{\s*clientId:\s*duplicate\.id\s*\},\s*data:\s*\{\s*clientId:\s*primary\.id\s*\}/s.test(clientsLib),
  "client merge must move Campaign.clientId"
);
assert(
  /tx\.reservation\.findMany\(\{[\s\S]*?where:\s*reservationWhere[\s\S]*?select:\s*\{\s*id:\s*true\s*\}/.test(clientsLib),
  "client merge must select affected reservations before relinking"
);

const reservationUpdateBlock = blockFrom(clientsLib, "tx.reservation.updateMany", "const billingItems");
for (const requiredField of ["clientId", "clientName", "clientCompany", "clientEmail", "clientPhone"]) {
  assert(
    new RegExp(`\\b${requiredField}\\s*:`).test(reservationUpdateBlock),
    `client merge must update reservation ${requiredField}`
  );
}
for (const forbiddenField of ["locationId", "periodStart", "periodEnd", "status"]) {
  assert(
    !new RegExp(`\\b${forbiddenField}\\s*:`).test(reservationUpdateBlock),
    `client merge must preserve reservation ${forbiddenField}`
  );
}

assert(
  legacySync.includes("Import-only sync boundary"),
  "legacy reservation sync direct writes must be explicitly classified as import-only"
);
assert(
  /\["COO", "SUPER_ADMIN"\]\.includes\(session\.role\)/.test(legacySyncRoute),
  "legacy reservation sync route must be restricted to COO/SUPER_ADMIN"
);
assert(legacySyncRoute.includes("LEGACY_RESERVATION_SYNC_RETIRED"), "legacy reservation sync route must be retired");
assert(!legacySyncRoute.includes("syncLegacyReservations"), "retired route must not invoke the legacy writer");

const notesOnlyBlock = blockFrom(commandCenterRoute, 'input.action === "approveException"', 'input.action === "createTask"');
assert(notesOnlyBlock.includes("productionNotes"), "command-center exception/resolution branch must be productionNotes-only");
for (const forbiddenField of ["status", "locationId", "periodStart", "periodEnd", "sellerUserId", "ownerId", "clientId", "campaignId"]) {
  assert(
    !new RegExp(`\\b${forbiddenField}\\s*:`).test(notesOnlyBlock),
    `command-center productionNotes direct write must not mutate ${forbiddenField}`
  );
}

console.log(JSON.stringify({
  ok: true,
  checked: [
    "client merge route uses domain helper",
    "client merge moves campaigns and reservations",
    "client merge updates reservation denormalized client fields",
    "client merge preserves reservation availability fields",
    "legacy sync writer retained as history but runtime route retired",
    "command-center direct write classified as notes-only"
  ]
}, null, 2));

function read(...parts) {
  return fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
}

function blockFrom(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `Missing start token: ${startToken}`);
  const end = source.indexOf(endToken, start);
  assert.notEqual(end, -1, `Missing end token: ${endToken}`);
  return source.slice(start, end);
}
