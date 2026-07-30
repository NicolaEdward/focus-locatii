export const USER_ROLES = ["SUPER_ADMIN", "COO", "D_CEO", "SALES_DIRECTOR", "SALES_AGENT", "FINANCE_OPERATOR", "FIELD_OPERATOR"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const PERMISSIONS = [
  "users.view",
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
  "finance.manage",
  "finance.integrations.saga.view",
  "finance.integrations.saga.sync",
  "finance.integrations.saga.reconcile",
  "finance.integrations.saga.configure"
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const rolePermissions: Record<UserRole, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  COO: [
    "users.view",
    "users.manage",
    "dashboard.executive.view",
    "dashboard.operations.view",
    "dashboard.sales.view",
    "dashboard.admin.view",
    "clients.view",
    "clients.manage",
    "leads.view",
    "leads.manage.own",
    "opportunities.view",
    "opportunities.manage.own",
    "proposals.view",
    "proposals.create",
    "proposals.submit",
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
    "finance.manage",
    "finance.integrations.saga.view",
    "finance.integrations.saga.reconcile"
  ],
  D_CEO: [
    "users.view",
    "dashboard.executive.view",
    "dashboard.operations.view",
    "dashboard.sales.view",
    "clients.view",
    "leads.view",
    "opportunities.view",
    "proposals.view",
    "campaigns.view",
    "inventory.view",
    "reservations.view",
    "reports.view",
    "audit.view",
    "dashboard.finance.view",
    "finance.view",
    "finance.integrations.saga.view"
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
    "finance.validate",
    "finance.confirm",
    "finance.integrations.saga.view",
    "finance.integrations.saga.sync",
    "finance.integrations.saga.reconcile"
  ],
  FIELD_OPERATOR: [
    "dashboard.operations.view"
  ]
};

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "Super administrator",
  COO: "COO",
  D_CEO: "D-CEO",
  SALES_DIRECTOR: "Director de vanzari",
  SALES_AGENT: "Agent de vanzari",
  FINANCE_OPERATOR: "Operator financiar",
  FIELD_OPERATOR: "Alpinist / montaj"
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  SUPER_ADMIN: "Administrare tehnica completa, inclusiv utilizatori, roluri si configurari.",
  COO: "Coordonare globala a activitatii comerciale, operationale si financiare.",
  D_CEO: "Vizibilitate executiva globala, strict read-only pentru datele de business.",
  SALES_DIRECTOR: "Coordonare comerciala la nivel de echipa, clienti, oportunitati si campanii.",
  SALES_AGENT: "Acces la portofoliul propriu, CRM, oferte, campanii si rezervari alocate.",
  FINANCE_OPERATOR: "Operare financiara, importuri, reconciliere si integrarea SAGA permisa.",
  FIELD_OPERATOR: "Acces limitat la munca operationala atribuita."
};

export type PermissionCategory =
  | "Administrare"
  | "Dashboard"
  | "Comercial"
  | "Campanii"
  | "Inventar"
  | "Rezervari"
  | "Rapoarte"
  | "Financiar";

export type PermissionDefinition = {
  id: Permission;
  label: string;
  category: PermissionCategory;
  description: string;
  mutating: boolean;
};

const permissionLabels: Record<Permission, Omit<PermissionDefinition, "id">> = {
  "users.view": { label: "Vizualizare utilizatori", category: "Administrare", description: "Poate consulta conturile si rolurile existente.", mutating: false },
  "users.manage": { label: "Administrare utilizatori", category: "Administrare", description: "Poate crea, activa, dezactiva si actualiza conturi.", mutating: true },
  "roles.manage": { label: "Administrare roluri", category: "Administrare", description: "Poate gestiona politica rolurilor privilegiate.", mutating: true },
  "settings.manage": { label: "Administrare setari", category: "Administrare", description: "Poate modifica setarile globale ale aplicatiei.", mutating: true },
  "dashboard.admin.view": { label: "Dashboard administrativ", category: "Dashboard", description: "Poate consulta sumarul administrativ.", mutating: false },
  "dashboard.executive.view": { label: "Executive Command Center", category: "Dashboard", description: "Poate consulta centrul executiv.", mutating: false },
  "dashboard.sales.view": { label: "Dashboard vanzari", category: "Dashboard", description: "Poate consulta agenda si sumarul echipei comerciale.", mutating: false },
  "dashboard.operations.view": { label: "Dashboard operational", category: "Dashboard", description: "Poate consulta zona operationala permisa.", mutating: false },
  "dashboard.agent.view": { label: "Agenda agent", category: "Dashboard", description: "Poate consulta propria agenda comerciala.", mutating: false },
  "dashboard.finance.view": { label: "Dashboard financiar", category: "Dashboard", description: "Poate consulta sumarul financiar permis.", mutating: false },
  "clients.view": { label: "Vizualizare clienti", category: "Comercial", description: "Poate consulta toti clientii autorizati.", mutating: false },
  "clients.manage": { label: "Administrare clienti", category: "Comercial", description: "Poate crea si modifica clienti autorizati.", mutating: true },
  "clients.view.own": { label: "Vizualizare clienti proprii", category: "Comercial", description: "Poate consulta clientii din portofoliul propriu.", mutating: false },
  "clients.manage.own": { label: "Administrare clienti proprii", category: "Comercial", description: "Poate modifica clientii din portofoliul propriu.", mutating: true },
  "leads.view": { label: "Vizualizare prospecti", category: "Comercial", description: "Poate consulta prospectii autorizati.", mutating: false },
  "leads.manage": { label: "Administrare prospecti", category: "Comercial", description: "Poate crea si modifica prospecti.", mutating: true },
  "leads.view.own": { label: "Vizualizare prospecti proprii", category: "Comercial", description: "Poate consulta prospectii proprii.", mutating: false },
  "leads.manage.own": { label: "Administrare prospecti proprii", category: "Comercial", description: "Poate modifica prospectii proprii.", mutating: true },
  "opportunities.view": { label: "Vizualizare oportunitati", category: "Comercial", description: "Poate consulta oportunitatile autorizate.", mutating: false },
  "opportunities.manage": { label: "Administrare oportunitati", category: "Comercial", description: "Poate crea si modifica oportunitati.", mutating: true },
  "opportunities.view.own": { label: "Vizualizare oportunitati proprii", category: "Comercial", description: "Poate consulta oportunitatile proprii.", mutating: false },
  "opportunities.manage.own": { label: "Administrare oportunitati proprii", category: "Comercial", description: "Poate modifica oportunitatile proprii.", mutating: true },
  "proposals.view": { label: "Vizualizare oferte", category: "Comercial", description: "Poate consulta ofertele autorizate.", mutating: false },
  "proposals.view.own": { label: "Vizualizare oferte proprii", category: "Comercial", description: "Poate consulta ofertele proprii.", mutating: false },
  "proposals.create": { label: "Creare oferta", category: "Comercial", description: "Poate crea oferte comerciale.", mutating: true },
  "proposals.submit": { label: "Trimitere oferta", category: "Comercial", description: "Poate trimite o oferta spre aprobare sau clientului.", mutating: true },
  "proposals.approve": { label: "Aprobare oferta", category: "Comercial", description: "Poate aproba oferte comerciale.", mutating: true },
  "proposals.reject": { label: "Respingere oferta", category: "Comercial", description: "Poate respinge oferte comerciale.", mutating: true },
  "campaigns.view": { label: "Vizualizare campanii", category: "Campanii", description: "Poate consulta toate campaniile autorizate.", mutating: false },
  "campaigns.view.own": { label: "Vizualizare campanii proprii", category: "Campanii", description: "Poate consulta campaniile proprii.", mutating: false },
  "campaigns.manage": { label: "Administrare campanii", category: "Campanii", description: "Poate crea si modifica campanii.", mutating: true },
  "campaigns.operate": { label: "Executie campanii", category: "Campanii", description: "Poate opera workflow-uri asociate campaniilor.", mutating: true },
  "inventory.view": { label: "Vizualizare inventar", category: "Inventar", description: "Poate consulta inventarul si disponibilitatea.", mutating: false },
  "inventory.manage": { label: "Administrare inventar", category: "Inventar", description: "Poate modifica locatii si blocaje comerciale.", mutating: true },
  "reservations.view": { label: "Vizualizare rezervari", category: "Rezervari", description: "Poate consulta toate rezervarile autorizate.", mutating: false },
  "reservations.view.own": { label: "Vizualizare rezervari proprii", category: "Rezervari", description: "Poate consulta rezervarile proprii.", mutating: false },
  "reservations.manage": { label: "Administrare rezervari", category: "Rezervari", description: "Poate crea si modifica rezervari.", mutating: true },
  "reservations.manage.own": { label: "Administrare rezervari proprii", category: "Rezervari", description: "Poate crea si modifica rezervarile proprii.", mutating: true },
  "reports.view": { label: "Vizualizare rapoarte", category: "Rapoarte", description: "Poate consulta rapoartele globale autorizate.", mutating: false },
  "reports.view.own": { label: "Vizualizare rapoarte proprii", category: "Rapoarte", description: "Poate consulta rapoartele pentru portofoliul propriu.", mutating: false },
  "audit.view": { label: "Vizualizare audit", category: "Administrare", description: "Poate consulta istoricul de audit autorizat.", mutating: false },
  "finance.view": { label: "Vizualizare financiar", category: "Financiar", description: "Poate consulta facturi, solduri si incasari.", mutating: false },
  "finance.upload": { label: "Incarcare rapoarte", category: "Financiar", description: "Poate incarca rapoarte financiare in staging.", mutating: true },
  "finance.validate": { label: "Validare rapoarte", category: "Financiar", description: "Poate valida si aloca randuri financiare.", mutating: true },
  "finance.confirm": { label: "Confirmare import", category: "Financiar", description: "Poate confirma importuri financiare canonice.", mutating: true },
  "finance.export": { label: "Export financiar", category: "Financiar", description: "Poate genera exporturi financiare autorizate.", mutating: false },
  "finance.manage": { label: "Administrare financiar", category: "Financiar", description: "Poate gestiona plati, corectii si reconciliere.", mutating: true },
  "finance.integrations.saga.view": { label: "Vizualizare SAGA", category: "Financiar", description: "Poate consulta starea integrarii SAGA.", mutating: false },
  "finance.integrations.saga.sync": { label: "Sincronizare SAGA", category: "Financiar", description: "Poate declansa sincronizarea SAGA autorizata.", mutating: true },
  "finance.integrations.saga.reconcile": { label: "Reconciliere SAGA", category: "Financiar", description: "Poate reconcilia datele SAGA.", mutating: true },
  "finance.integrations.saga.configure": { label: "Configurare SAGA", category: "Financiar", description: "Poate modifica configurarea integrarii SAGA.", mutating: true }
};

export const PERMISSION_CATALOG: readonly PermissionDefinition[] = PERMISSIONS.map((id) => ({
  id,
  ...permissionLabels[id]
}));

export type RoleDefinition = {
  id: UserRole;
  label: string;
  description: string;
  permissions: readonly PermissionDefinition[];
};

export function roleCatalog(): readonly RoleDefinition[] {
  return USER_ROLES.map((id) => ({
    id,
    label: ROLE_LABELS[id],
    description: ROLE_DESCRIPTIONS[id],
    permissions: permissionsForRole(id).map((permission) => ({
      id: permission,
      ...permissionLabels[permission]
    }))
  }));
}

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

export function assertRoleAssignmentAllowed(
  actorRole: UserRole,
  currentRole: UserRole | null,
  nextRole: UserRole
) {
  if (actorRole === "SUPER_ADMIN") return;
  if (currentRole === "SUPER_ADMIN" || nextRole === "SUPER_ADMIN" || currentRole === "D_CEO" || nextRole === "D_CEO") {
    throw new Error("Doar SUPER_ADMIN poate crea sau modifica un cont SUPER_ADMIN sau D-CEO.");
  }
}

export function dashboardPathForRole(role: UserRole) {
  if (role === "FIELD_OPERATOR") return "/admin/operational";
  if (role === "FINANCE_OPERATOR") return "/admin/financiar/incasari";
  return "/admin/dashboard";
}

export function hasGlobalDataAccess(role: UserRole) {
  return (["SUPER_ADMIN", "COO", "D_CEO", "SALES_DIRECTOR"] as const).includes(
    role as "SUPER_ADMIN" | "COO" | "D_CEO" | "SALES_DIRECTOR"
  );
}

export function isBusinessReadOnlyRole(role: UserRole) {
  return role === "D_CEO";
}
