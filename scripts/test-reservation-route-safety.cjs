const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sellerReassignmentsRoute = fs.readFileSync(
  path.join(process.cwd(), "src", "app", "api", "admin", "seller-reassignments", "route.ts"),
  "utf8"
);
const commandCenterRoute = fs.readFileSync(
  path.join(process.cwd(), "src", "app", "api", "admin", "command-center", "route.ts"),
  "utf8"
);
const reservationsLib = fs.readFileSync(path.join(process.cwd(), "src", "lib", "reservations.ts"), "utf8");

assert(
  sellerReassignmentsRoute.includes('import { assignReservationsSeller } from "@/lib/reservations";'),
  "seller reassignment route must use the reservation domain command"
);
assert(
  !/prisma\.reservation\.(create|update|updateMany|delete|deleteMany|upsert)\s*\(/.test(sellerReassignmentsRoute),
  "seller reassignment route must not write reservations directly"
);
assert(
  /\["COO", "SUPER_ADMIN"\]\.includes\(session\.role\)/.test(sellerReassignmentsRoute),
  "seller reassignment route must enforce COO/SUPER_ADMIN role policy"
);
assert(
  sellerReassignmentsRoute.includes('action: "seller.reassign_reservations"'),
  "seller reassignment route must write an audit log"
);
assert(
  sellerReassignmentsRoute.includes("assignReservationsSeller(input.reservationIds, input.sellerUserId, session)"),
  "seller reassignment route must pass selected reservation ids through the domain command"
);

for (const expectedCall of [
  "releaseReservationHold(reservation.id, session)",
  "markReservationHoldLost(reservation.id, input.note, session)",
  "extendReservationHold(reservation.id, input.days || 5, session)",
  "assignReservationSeller(reservation.id, input.sellerUserId, session)"
]) {
  assert(commandCenterRoute.includes(expectedCall), `command-center must call ${expectedCall}`);
}
assert(
  !/prisma\.reservation\.updateMany\(\{[\s\S]{0,400}data:\s*\{[\s\S]{0,400}status\s*:/.test(commandCenterRoute),
  "command-center must not update reservation status directly"
);
assert(
  !/prisma\.reservation\.updateMany\(\{[\s\S]{0,400}data:\s*\{[\s\S]{0,400}(sellerUserId|ownerId|salesperson)\s*:/.test(commandCenterRoute),
  "command-center must not update reservation seller fields directly"
);

assert(
  reservationsLib.includes("export async function assignReservationsSeller"),
  "reservation domain must expose a bulk seller reassignment command"
);
const helperMatch = reservationsLib.match(/async function assignReservationRowsSeller[\s\S]*?data:\s*\{([^}]+)\}/);
assert(helperMatch, "seller reassignment helper must exist");
const sellerUpdateFields = helperMatch[1];
for (const forbiddenField of ["status", "locationId", "periodStart", "periodEnd", "clientId", "campaignId"]) {
  assert(
    !new RegExp(`\\b${forbiddenField}\\s*:`).test(sellerUpdateFields),
    `seller reassignment must not mutate reservation integrity field ${forbiddenField}`
  );
}

console.log(JSON.stringify({
  ok: true,
  checked: [
    "seller reassignment route rejects unauthorized roles in source",
    "seller reassignment route writes through domain command",
    "seller reassignment route records audit",
    "command-center lifecycle branches use domain commands",
    "seller reassignment preserves reservation integrity fields"
  ]
}, null, 2));
