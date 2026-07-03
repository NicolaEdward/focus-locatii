"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  CircleDollarSign,
  Download,
  FileSpreadsheet,
  Gauge,
  ListChecks,
  Map,
  MapPin,
  Settings,
  Shield,
  Truck,
  UserRoundCheck,
  Users
} from "lucide-react";
import { FocusLogo } from "@/components/brand/FocusLogo";
import { LogoutButton } from "@/components/admin/LogoutButton";
import { NotificationBell } from "@/components/admin/NotificationBell";
import type { AuthSession } from "@/lib/auth";
import { hasAnyPermission, hasPermission, ROLE_LABELS } from "@/lib/rbac";

export function AdminHeader({ session }: { session: AuthSession }) {
  const pathname = usePathname() || "";
  const isFieldOperator = session.role === "FIELD_OPERATOR";
  const canViewInventory = hasPermission(session.role, "inventory.view");
  const canManageInventory = hasPermission(session.role, "inventory.manage");
  const canExportSales = hasPermission(session.role, "reports.view");
  const canManageUsers = hasPermission(session.role, "users.manage");
  const canViewCrm = hasAnyPermission(session.role, ["leads.view", "leads.view.own"]);
  const canViewClients = hasAnyPermission(session.role, ["clients.view", "clients.view.own", "campaigns.view", "campaigns.view.own", "finance.view"]);
  const canViewCampaigns = hasAnyPermission(session.role, ["campaigns.view", "campaigns.view.own", "finance.view"]);
  const canViewFinance = hasPermission(session.role, "finance.view");
  const canViewOperational = hasAnyPermission(session.role, ["dashboard.operations.view", "campaigns.operate", "reservations.view", "reservations.view.own", "inventory.view"]);
  const hasCommercialMenu = canViewInventory || canViewCrm || canViewClients || canViewCampaigns;
  const hasFinanceMenu = canViewFinance || canExportSales;
  const hasSettingsMenu = canManageInventory || canManageUsers;

  return (
    <header className="sticky top-0 z-40 border-b border-focus-line bg-focus-navy/95 backdrop-blur">
      <div className="focus-container flex min-h-20 items-center gap-3 py-3">
        <div className="flex shrink-0 items-center gap-4">
          <FocusLogo href="/admin/dashboard" prefetch={false} />
          <div className="hidden border-l border-focus-line pl-4 lg:block">
            <p className="text-sm font-bold text-white">{session.name}</p>
            <p className="text-xs text-slate-400">{ROLE_LABELS[session.role]}</p>
          </div>
        </div>
        <nav className="admin-nav flex min-w-0 flex-1 flex-wrap items-center gap-2" aria-label="Navigatie administrare">
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
              active={isActiveAnyAdminPath(pathname, ["/admin/furnizori"])}
              icon={<CircleDollarSign size={18} />}
              label="Financiar"
            >
              {canViewFinance ? <AdminMenuLink href="/admin/dashboard" active={false} icon={<CircleDollarSign size={17} />} label="SmartBill / rapoarte" /> : null}
              {canViewFinance ? <AdminMenuLink href="/admin/furnizori" active={isActiveAdminPath(pathname, "/admin/furnizori")} icon={<Truck size={17} />} label="Furnizori" /> : null}
              {canExportSales ? <AdminMenuAction href="/api/admin/sales-report/excel" icon={<Download size={17} />} label="Export vanzari" /> : null}
            </AdminNavMenu>
          ) : null}
          {hasSettingsMenu ? (
            <AdminNavMenu
              active={isActiveAnyAdminPath(pathname, ["/admin/utilizatori", "/admin/locatii/import", "/admin/locatii/gps"])}
              icon={<Settings size={18} />}
              label="Setari"
            >
              {canManageInventory ? <AdminMenuLink href="/admin/locatii/import" active={isActiveAdminPath(pathname, "/admin/locatii/import")} icon={<FileSpreadsheet size={17} />} label="Import / actualizare" /> : null}
              {canManageInventory ? <AdminMenuLink href="/admin/locatii/gps" active={isActiveAdminPath(pathname, "/admin/locatii/gps")} icon={<Map size={17} />} label="Audit GPS" /> : null}
              {canManageUsers ? <AdminMenuLink href="/admin/utilizatori" active={isActiveAdminPath(pathname, "/admin/utilizatori")} icon={<Users size={17} />} label="Utilizatori" /> : null}
            </AdminNavMenu>
          ) : null}
          {!isFieldOperator ? <AdminNavLink href="/locatii" active={false} quiet><MapPin size={18} />Portal public</AdminNavLink> : null}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          {!isFieldOperator ? <NotificationBell /> : null}
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

function AdminMenuAction({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <a className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-black text-slate-100 hover:bg-focus-yellow/10 hover:text-white" href={href}>
      {icon}
      {label}
    </a>
  );
}
