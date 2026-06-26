import assert from "node:assert/strict";
import { hasPermission, permissionsForRole, USER_ROLES } from "../src/lib/rbac";
import { allowedReservationTransitions, canTransitionReservation } from "../src/lib/reservation-workflow";

for (const role of USER_ROLES) {
  assert(permissionsForRole(role).length > 0, `${role} must have permissions`);
}
assert.equal(hasPermission("SUPER_ADMIN", "users.manage"), true);
assert.equal(hasPermission("SALES_AGENT", "users.manage"), false);
assert.equal(hasPermission("SALES_AGENT", "inventory.manage"), false);
assert.equal(hasPermission("SALES_AGENT", "reservations.manage.own"), true);
assert.equal(hasPermission("SALES_DIRECTOR", "proposals.approve"), true);
assert.equal(hasPermission("COO", "campaigns.operate"), true);
assert.equal(hasPermission("SUPER_ADMIN", "campaigns.operate"), true);
assert.equal(hasPermission("SALES_AGENT", "campaigns.operate"), false);
assert.equal(hasPermission("COO", "users.manage"), true);
assert.equal(hasPermission("COO", "inventory.manage"), true);
assert.equal(hasPermission("COO", "finance.confirm"), true);
assert.equal(hasPermission("FINANCE_OPERATOR", "finance.upload"), true);
assert.equal(hasPermission("FINANCE_OPERATOR", "users.manage"), false);
assert.equal(hasPermission("SALES_AGENT", "finance.view"), false);
assert.equal(canTransitionReservation("DRAFT" as never, "BOOKED"), false);
assert.equal(canTransitionReservation("RESERVED", "BOOKED"), true);
assert.equal(canTransitionReservation("COMPLETED" as never, "RESERVED"), false);
assert.equal(allowedReservationTransitions("RESERVED", "SALES_AGENT").includes("BOOKED"), false);
assert.equal(allowedReservationTransitions("RESERVED", "SALES_DIRECTOR").includes("BOOKED"), true);

console.log(JSON.stringify({ ok: true, roles: USER_ROLES, checks: 18 }, null, 2));
