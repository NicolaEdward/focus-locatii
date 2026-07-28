"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  CircleDollarSign,
  Cable,
  Download,
  FileSpreadsheet,
  Gauge,
  ListChecks,
  Map,
  MapPin,
  ReceiptText,
  Settings,
  Shield,
  ShieldCheck,
  KeyRound,
  Truck,
  UserRoundCheck,
  Users
} from "lucide-react";
import { FocusLogo } from "@/components/brand/FocusLogo";
import { LogoutButton } from "@/components/admin/LogoutButton";
import { NotificationBell } from "@/components/admin/NotificationBell";
import { SalesReportExportButton } from "@/components/admin/SalesReportExportButton";
import type { AuthSession } from "@/lib/auth";
import { hasAnyPermission, hasPermission, ROLE_LABELS } from "@/lib/rbac";

export function AdminHeader({ session }: { session: AuthSession }) {
  const pathname = usePathname() || "";
  const isFieldOperator = session.role === "FIELD_OPERATOR";
  const isDceo = session.role === "D_CEO";
  const canViewInventory = hasPermission(session.role, "inventory.view");
  const canManageInventory = hasPermission(session.role, "inventory.manage");
  const canExportSales = hasPermission(session.role, "reports.view");
  const canViewUsers = hasAnyPermission(session.role, ["users.view", "users.manage"]);
  const canManageUsers = hasPermission(session.role, "users.manage");
  const canViewCrm = hasAnyPermission(session.role, ["leads.view", "leads.view.own"]);
  const canViewClients = hasAnyPermission(session.role, ["clients.view", "clients.view.own", "campaigns.view", "campaigns.view.own", "finance.view"]);
  const canViewCampaigns = hasAnyPermission(session.role, ["campaigns.view", "campaigns.view.own", "finance.view"]);
  const canViewFinance = hasPermission(session.role, "finance.view");
  const canViewSaga = hasPermission(session.role, "finance.integrations.saga.view");
  const canViewOperational = hasAnyPermission(session.role, ["dashboard.operations.view", "campaigns.operate", "reservations.view", "reservations.view.own", "inventory.view"]);
  const hasCommercialMenu = canViewInventory || canViewCrm || canViewClients || canViewCampaigns;
  const hasFinanceMenu = canViewFinance || canExportSales;
  const hasSettingsMenu = canManageInventory || canViewUsers || canViewSaga;

  return (
    <header className="sticky top-0 z-40 border-b border-focus-line bg-focus-navy/95 backdrop-blur">
      <div className="focus-container grid min-h-16 min-w-0 grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 py-2 xl:flex">
        <div className="flex min-w-0 shrink-0 items-center gap-4">
          <FocusLogo href="/admin/dashboard" prefetch={false} />
          <div className="hidden border-l border-focus-line pl-4 2xl:block">
            <p className="text-sm font-bold text-white">{session.name}</p>
            <p className="text-xs text-slate-400">{ROLE_LABELS[session.role]}</p>
          </div>
        </div>
        <nav className="admin-nav order-3 col-span-3 flex w-full min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-1 xl:order-none xl:col-span-1 xl:flex-1 xl:flex-wrap xl:overflow-visible xl:pb-0" aria-label="Navigatie administrare">
          {!isFieldOperator ? <AdminNavLink href="/admin/dashboard" active={isActiveAdminPath(pathname, "/admin/dashboard")}><Gauge size={18} />Dashboard</AdminNavLink> : null}
          {hasCommercialMenu ? (
            <AdminNavMenu
              active={isActiveAnyAdminPath(pathname, ["/admin/selectie-locatii", "/admin/crm", "/admin/clienti", "/admin/campanii"])}
              icon={<BriefcaseBusiness size={18} />}
              label="Comercial"
            >
              {canViewInventory ? <AdminMenuLink href="/admin/selectie-locatii" active={isActiveAdminPath(pathname, "/admin/selectie-locatii")} icon={<ListChecks size={17} />} label="Selector oferta" /> : null}
              {canViewCrm ? <AdminMenuLink href="/admin/crm" active={isActiveAdminPath(pathname, "/admin/crm")} icon={<UserRoundCheck size={17} />} label="CRM" /> : null}
              {canViewClients ? <AdminMenuLink href="/admin/clienti" active={isActiveAdminPath(pathname, "/admin/clienti")} icon={<Building2 size={17} />} label="Clienti" /> : null}
              {canViewCampaigns ? <AdminMenuLink href="/admin/campanii" active={isActiveAdminPath(pathname, "/admin/campanii")} icon={<BriefcaseBusiness size={17} />} label="Campanii in Clienti" /> : null}
            </AdminNavMenu>
          ) : null}
          {canViewInventory ? <AdminNavLink href="/admin/locatii" active={isActiveAdminPath(pathname, "/admin/locatii")}><Shield size={18} />Locatii</AdminNavLink> : null}
          {canViewOperational ? <AdminNavLink href="/admin/operational" active={isActiveAdminPath(pathname, "/admin/operational")}><Truck size={18} />Operational</AdminNavLink> : null}
          {hasFinanceMenu ? (
            <AdminNavMenu
              active={isActiveAnyAdminPath(pathname, ["/admin/furnizori", "/admin/financiar"])}
              icon={<CircleDollarSign size={18} />}
              label="Financiar"
            >
              {canViewFinance ? <AdminMenuLink href="/admin/financiar/incasari" active={isActiveAdminPath(pathname, "/admin/financiar/incasari")} icon={<ReceiptText size={17} />} label="Facturi clienți" /> : null}
              {canViewFinance ? <AdminMenuLink href="/admin/furnizori" active={isActiveAdminPath(pathname, "/admin/furnizori")} icon={<Truck size={17} />} label="Furnizori" /> : null}
              {canExportSales ? <SalesReportExportButton variant="menu" icon={<Download size={17} />} label="Export vanzari" /> : null}
            </AdminNavMenu>
          ) : null}
          {hasSettingsMenu ? (
            <AdminNavMenu
              active={isActiveAnyAdminPath(pathname, ["/admin/utilizatori", "/admin/integritate-date", "/admin/integrari/saga", "/admin/locatii/import", "/admin/locatii/gps"])}
              icon={<Settings size={18} />}
              label="Setari"
            >
              {canManageInventory ? <AdminMenuLink href="/admin/locatii/import" active={isActiveAdminPath(pathname, "/admin/locatii/import")} icon={<FileSpreadsheet size={17} />} label="Import / actualizare" /> : null}
              {canManageInventory ? <AdminMenuLink href="/admin/locatii/gps" active={isActiveAdminPath(pathname, "/admin/locatii/gps")} icon={<Map size={17} />} label="Audit GPS" /> : null}
              {canViewUsers ? <AdminMenuLink href="/admin/utilizatori" active={isActiveAdminPath(pathname, "/admin/utilizatori")} icon={<Users size={17} />} label="Utilizatori" /> : null}
              {canManageUsers && ["COO", "SUPER_ADMIN"].includes(session.role) ? <AdminMenuLink href="/admin/integritate-date" active={isActiveAdminPath(pathname, "/admin/integritate-date")} icon={<ShieldCheck size={17} />} label="Integritate date" /> : null}
              {canViewSaga ? <AdminMenuLink href="/admin/integrari/saga" active={isActiveAdminPath(pathname, "/admin/integrari/saga")} icon={<Cable size={17} />} label="Integrari / SAGA" /> : null}
            </AdminNavMenu>
          ) : null}
          {!isFieldOperator ? <AdminNavLink href="/locatii" active={false} quiet><MapPin size={18} />Portal public</AdminNavLink> : null}
        </nav>
        <div className="col-start-3 row-start-1 flex shrink-0 items-center gap-2">
          {!isFieldOperator && !isDceo ? <NotificationBell /> : null}
          <Link className="focus-button secondary px-3" href="/admin/securitate" prefetch={false} aria-label="Securitatea contului" title="Securitatea contului"><KeyRound size={18} /></Link>
          <div className="relative z-50">
            <LogoutButton />
          </div>
        </div>
      </div>
    </header>
  );
}
export function isActiveAdminPath(pathname: string, href: string) {
  if (href === "/admin/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isActiveAnyAdminPath(pathname: string, hrefs: string[]) {
  return hrefs.some((href) => isActiveAdminPath(pathname, href));
}

function AdminNavLink({
  href,
  active,
  quiet = false,
  children
}: {
  href: string;
  active: boolean;
  quiet?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      className={`focus-button ${active ? "" : "secondary"} ${quiet ? "opacity-80" : ""}`}
      aria-current={active ? "page" : undefined}
      href={href}
      prefetch={false}
    >
      {children}
    </Link>
  );
}

function AdminNavMenu({
  active,
  icon,
  label,
  children
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <details className="group relative flex-none">
      <summary
        className={`focus-button cursor-pointer list-none ${active ? "" : "secondary"}`}
        aria-current={active ? "page" : undefined}
      >
        {icon}
        {label}
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute left-0 top-full z-50 mt-2 grid min-w-64 gap-1 rounded-lg border border-focus-line bg-focus-navy p-2 shadow-2xl">
        {children}
      </div>
    </details>
  );
}

function AdminMenuLink({
  href,
  active,
  icon,
  label
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Link
      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-black ${active ? "bg-focus-yellow text-focus-ink" : "text-slate-100 hover:bg-focus-yellow/10 hover:text-white"}`}
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      {label}
    </Link>
  );
}
