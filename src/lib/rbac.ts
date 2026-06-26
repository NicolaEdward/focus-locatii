export const USER_ROLES = ["SUPER_ADMIN", "COO", "SALES_DIRECTOR", "SALES_AGENT", "FINANCE_OPERATOR"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const PERMISSIONS = [
  "users.manage",
  "roles.manage",
  "settings.manage",
  "dashboard.admin.view",
  "dashboard.executive.view",
  "dashboard.sales.view",
  "dashboard.operations.view",
  "dashboard.agent.view",
  "dashboard.finance.view",
  "clients.view",
  "clients.manage",
  "clients.view.own",
  "clients.manage.own",
  "leads.view",
  "leads.manage",
  "leads.view.own",
  "leads.manage.own",
  "opportunities.view",
  "opportunities.manage",
  "opportunities.view.own",
  "opportunities.manage.own",
  "proposals.view",
  "proposals.view.own",
  "proposals.create",
  "proposals.submit",
  "proposals.approve",
  "proposals.reject",
  "campaigns.view",
  "campaigns.view.own",
  "campaigns.manage",
  "campaigns.operate",
  "inventory.view",
  "inventory.manage",
  "reservations.view",
  "reservations.view.own",
  "reservations.manage",
  "reservations.manage.own",
  "reports.view",
  "reports.view.own",
  "audit.view",
  "finance.view",
  "finance.upload",
  "finance.validate",
  "finance.confirm",
  "finance.export",
  "finance.manage"
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const rolePermissions: Record<UserRole, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  COO: [
    "users.manage",
    "dashboard.executive.view",
    "dashboard.operations.view",
    "dashboard.sales.view",
    "dashboard.admin.view",
    "clients.view",
    "clients.manage",
    "leads.view",
    "leads.manage",
    "opportunities.view",
    "opportunities.manage",
    "proposals.view",
    "proposals.approve",
    "proposals.reject",
    "campaigns.view",
    "campaigns.manage",
    "campaigns.operate",
    "inventory.view",
    "inventory.manage",
    "reservations.view",
    "reservations.manage",
    "reports.view",
    "audit.view",
    "dashboard.finance.view",
    "finance.view",
    "finance.upload",
    "finance.validate",
    "finance.confirm",
    "finance.export",
    "finance.manage"
  ],
  SALES_DIRECTOR: [
    "dashboard.sales.view",
    "clients.view",
    "clients.manage",
    "leads.view",
    "leads.manage",
    "opportunities.view",
    "opportunities.manage",
    "proposals.view",
    "proposals.approve",
    "proposals.reject",
    "campaigns.view",
    "inventory.view",
    "reservations.view",
    "reservations.manage",
    "reports.view"
  ],
  SALES_AGENT: [
    "dashboard.agent.view",
    "clients.view.own",
    "clients.manage.own",
    "leads.view.own",
    "leads.manage.own",
    "opportunities.view.own",
    "opportunities.manage.own",
    "proposals.view.own",
    "proposals.create",
    "proposals.submit",
    "campaigns.view.own",
    "inventory.view",
    "reservations.view.own",
    "reservations.manage.own",
    "reports.view.own"
  ],
  FINANCE_OPERATOR: [
    "dashboard.finance.view",
    "clients.view",
    "clients.manage",
    "campaigns.view",
    "finance.view",
    "finance.upload",
    "finance.validate"
  ]
};

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "Super administrator",
  COO: "COO",
  SALES_DIRECTOR: "Director de vanzari",
  SALES_AGENT: "Agent de vanzari",
  FINANCE_OPERATOR: "Operator financiar"
};

export function isUserRole(value: unknown): value is UserRole {
  return USER_ROLES.includes(String(value) as UserRole);
}

export function permissionsForRole(role: UserRole) {
  return rolePermissions[role];
}

export function hasPermission(role: UserRole, permission: Permission) {
  return rolePermissions[role].includes(permission);
}

export function hasAnyPermission(role: UserRole, permissions: readonly Permission[]) {
  return permissions.some((permission) => hasPermission(role, permission));
}

export function dashboardPathForRole(role: UserRole) {
  return "/admin/dashboard";
}

export function hasGlobalDataAccess(role: UserRole) {
  return role !== "SALES_AGENT" && role !== "FINANCE_OPERATOR";
}
