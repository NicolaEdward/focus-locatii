import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  PERMISSIONS,
  USER_ROLES,
  assertRoleAssignmentAllowed,
  hasPermission,
  roleCatalog
} from "../src/lib/rbac";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const catalog = roleCatalog();
assert.equal(catalog.length, USER_ROLES.length, "Every application role must be represented in the canonical role catalog.");
assert.deepEqual(catalog.map((role) => role.id), [...USER_ROLES], "Role catalog order must be stable.");

for (const role of catalog) {
  assert(role.label.length > 0, `${role.id} must have a user-facing label.`);
  assert(role.description.length > 0, `${role.id} must explain its business scope.`);
  assert(role.permissions.length > 0, `${role.id} must expose effective permissions.`);
  assert.equal(new Set(role.permissions.map((permission) => permission.id)).size, role.permissions.length, `${role.id} must not contain duplicate permissions.`);
  for (const permission of role.permissions) {
    assert(PERMISSIONS.includes(permission.id), `${permission.id} must be a canonical permission.`);
    assert(permission.label.length > 0, `${permission.id} must have a label.`);
    assert(permission.description.length > 0, `${permission.id} must have a description.`);
  }
}

assert.equal(hasPermission("D_CEO", "users.view"), true, "D-CEO may inspect the user registry.");
assert.equal(hasPermission("D_CEO", "users.manage"), false, "D-CEO must remain read-only.");
assert.equal(hasPermission("COO", "users.manage"), true, "COO retains the existing user administration policy.");
assert.equal(hasPermission("SUPER_ADMIN", "roles.manage"), true, "SUPER_ADMIN retains privileged role policy.");

assert.throws(
  () => assertRoleAssignmentAllowed("COO", null, "D_CEO"),
  /Doar SUPER_ADMIN/,
  "COO must not create a privileged D-CEO account."
);
assert.throws(
  () => assertRoleAssignmentAllowed("COO", "D_CEO", "SALES_AGENT"),
  /Doar SUPER_ADMIN/,
  "COO must not modify a privileged D-CEO account."
);
assert.doesNotThrow(
  () => assertRoleAssignmentAllowed("COO", null, "SALES_AGENT"),
  "COO may create standard operational accounts."
);

const usersService = read("src/lib/users.ts");
assert.doesNotMatch(usersService, /prisma\.user\.delete(?:Many)?\s*\(/, "User administration must never hard-delete users.");
assert.match(usersService, /parsed\.active === false/, "User administration must use soft deactivation.");
assert.match(usersService, /Nu iti poti dezactiva propriul cont/, "Self-deactivation must be blocked.");
assert.match(usersService, /Nu iti poti schimba propriul rol/, "Self role changes must be blocked.");
assert.match(usersService, /cel putin un SUPER_ADMIN activ/, "The last active SUPER_ADMIN must be protected.");
assert.match(usersService, /lastLoginAt/, "The canonical user DTO must expose last login.");
assert.match(usersService, /getUserAuditEvents/, "The canonical service must expose access audit history.");

const usersRoute = read("src/app/api/admin/users/route.ts");
const userRoute = read("src/app/api/admin/users/[id]/route.ts");
const auditRoute = read("src/app/api/admin/users/[id]/audit/route.ts");
assert.match(usersRoute, /requirePermission\(request, "users\.manage"\)/, "User creation must be server-side permission protected.");
assert.doesNotMatch(usersRoute, /export async function DELETE/, "The user collection route must not expose DELETE.");
assert.match(userRoute, /requirePermission\(request, "users\.manage"\)/, "User changes must be server-side permission protected.");
assert.doesNotMatch(userRoute, /export async function DELETE/, "The user route must not expose DELETE.");
assert.match(userRoute, /before,[\s\S]*after/, "Role and lifecycle audit must retain before/after state.");
assert.match(auditRoute, /requireAnyPermission/, "Audit history must be protected server-side.");
assert.doesNotMatch(auditRoute, /ipAddress|userAgent/, "User audit DTO must not expose IP or user-agent data.");

const userManagement = read("src/components/admin/UserManagement.tsx");
assert.match(userManagement, /Creeaza cont/, "Canonical UI must support direct account creation.");
assert.match(userManagement, /Invita/, "Canonical UI must support invitations.");
assert.match(userManagement, /Dezactiveaza/, "Canonical UI must support soft deactivation.");
assert.match(userManagement, /Reseteaza parola/, "Canonical UI must support administrative password reset.");
assert.match(userManagement, /Roluri si permisiuni/, "Canonical UI must expose the effective permission policy.");
assert.match(userManagement, /Istoric acces/, "Canonical UI must expose access audit history.");
assert.match(userManagement, /Motivul modificarii/, "Sensitive access changes must require a human reason.");
assert.match(userManagement, /readOnly/, "The UI must preserve the read-only executive mode.");
assert.doesNotMatch(userManagement, /window\.confirm|window\.prompt/, "Sensitive user actions must use explicit application dialogs.");
assert.match(userManagement, /aria-modal="true"/, "Sensitive dialogs must expose modal semantics.");
assert.match(userManagement, /trapFocus/, "Sensitive dialogs must contain keyboard focus.");

const auth = read("src/lib/auth.ts");
assert.match(auth, /lastLoginAt:\s*new Date\(\)/, "Successful authentication must update last login.");
assert.match(auth, /!user\.active/, "Inactive users must be rejected during credential authentication.");
const authWorkflows = read("src/lib/auth-workflows.ts");
assert.match(authWorkflows, /assertRoleAssignmentAllowed\(actor\.role, null, parsed\.role\)/, "Invitations and direct creation must share the privileged-role policy.");

console.log(JSON.stringify({
  ok: true,
  roles: catalog.length,
  permissions: PERMISSIONS.length,
  checks: 39
}, null, 2));
