import assert from "node:assert/strict";
import { dashboardPathForRole, hasPermission, permissionsForRole, ROLE_LABELS, USER_ROLES } from "../src/lib/rbac";
import { allowedReservationTransitions, canTransitionReservation } from "../src/lib/reservation-workflow";

for (const role of USER_ROLES) {
  assert(permissionsForRole(role).length > 0, `${role} must have permissions`);
}
assert.equal(hasPermission("SUPER_ADMIN", "users.manage"), true);
assert.equal(hasPermission("SALES_AGENT", "users.manage"), false);
assert.equal(hasPermission("SALES_AGENT", "inventory.manage"), false);
assert.equal(hasPermission("SALES_AGENT", "reservations.manage.own"), true);
assert.equal(hasPermission("SALES_DIRECTOR", "proposals.approve"), true);
assert.equal(hasPermission("SALES_DIRECTOR", "leads.view"), true);
assert.equal(hasPermission("SALES_DIRECTOR", "leads.manage"), true);
assert.equal(hasPermission("SALES_AGENT", "leads.view.own"), true);
assert.equal(hasPermission("SALES_AGENT", "leads.manage.own"), true);
assert.equal(hasPermission("COO", "leads.view"), true);
assert.equal(hasPermission("SUPER_ADMIN", "leads.manage"), true);
assert.equal(hasPermission("COO", "campaigns.operate"), true);
assert.equal(hasPermission("SUPER_ADMIN", "campaigns.operate"), true);
assert.equal(hasPermission("SALES_AGENT", "campaigns.operate"), false);
assert.equal(hasPermission("COO", "users.manage"), true);
assert.equal(hasPermission("COO", "inventory.manage"), true);
assert.equal(hasPermission("COO", "finance.confirm"), true);
assert.equal(hasPermission("FINANCE_OPERATOR", "finance.upload"), true);
assert.equal(hasPermission("FINANCE_OPERATOR", "users.manage"), false);
assert.equal(hasPermission("SALES_AGENT", "finance.view"), false);
assert.equal(ROLE_LABELS.FIELD_OPERATOR, "Alpinist / montaj");
assert.equal(dashboardPathForRole("FIELD_OPERATOR"), "/admin/operational");
assert.equal(hasPermission("FIELD_OPERATOR", "dashboard.operations.view"), true);
assert.equal(hasPermission("FIELD_OPERATOR", "campaigns.operate"), false);
assert.equal(hasPermission("FIELD_OPERATOR", "reservations.manage"), false);
assert.equal(hasPermission("FIELD_OPERATOR", "reservations.view"), false);
assert.equal(hasPermission("FIELD_OPERATOR", "inventory.view"), false);
assert.equal(hasPermission("FIELD_OPERATOR", "finance.view"), false);
assert.equal(hasPermission("FIELD_OPERATOR", "clients.view"), false);
assert.equal(hasPermission("FIELD_OPERATOR", "users.manage"), false);
assert.equal(canTransitionReservation("DRAFT" as never, "BOOKED"), false);
assert.equal(canTransitionReservation("RESERVED", "BOOKED"), true);
assert.equal(canTransitionReservation("COMPLETED" as never, "RESERVED"), false);
assert.equal(allowedReservationTransitions("RESERVED", "SALES_AGENT").includes("BOOKED"), false);
assert.equal(allowedReservationTransitions("RESERVED", "SALES_DIRECTOR").includes("BOOKED"), true);

console.log(JSON.stringify({ ok: true, roles: USER_ROLES, checks: 34 }, null, 2));
