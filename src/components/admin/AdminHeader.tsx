"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BriefcaseBusiness, Building2, Download, FileSpreadsheet, Gauge, Map, MapPin, Shield, Truck, UserRoundCheck, Users } from "lucide-react";
import { FocusLogo } from "@/components/brand/FocusLogo";
import { LogoutButton } from "@/components/admin/LogoutButton";
import { NotificationBell } from "@/components/admin/NotificationBell";
import type { AuthSession } from "@/lib/auth";
import { hasAnyPermission, hasPermission, ROLE_LABELS } from "@/lib/rbac";

export function AdminHeader({ session }: { session: AuthSession }) {
  const pathname = usePathname() || "";
  const canManageInventory = hasPermission(session.role, "inventory.manage");
  const canExportAvailability = hasAnyPermission(session.role, ["reports.view", "reports.view.own"]);
  const canExportSales = hasPermission(session.role, "reports.view");
  const canManageUsers = hasPermission(session.role, "users.manage");
  const hasAdminMenu = canManageInventory || canManageUsers || canExportAvailability || canExportSales;

  return (
    <header className="sticky top-0 z-40 border-b border-focus-line bg-focus-navy/95 backdrop-blur">
      <div className="focus-container flex min-h-20 items-center gap-3 py-3">
        <div className="flex shrink-0 items-center gap-4">
          <FocusLogo href="/admin/dashboard" />
          <div className="hidden border-l border-focus-line pl-4 lg:block">
            <p className="text-sm font-bold text-white">{session.name}</p>
            <p className="text-xs text-slate-400">{ROLE_LABELS[session.role]}</p>
          </div>
        </div>
        <nav className="admin-nav flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto pb-1" aria-label="Navigatie administrare">
          <AdminNavLink href="/admin/dashboard" active={isActiveAdminPath(pathname, "/admin/dashboard")}><Gauge size={18} />Dashboard</AdminNavLink>
          <AdminNavLink href="/locatii" active={false} quiet><MapPin size={18} />Vezi portal public</AdminNavLink>
          {hasPermission(session.role, "inventory.view") ? <AdminNavLink href="/admin/locatii" active={isActiveAdminPath(pathname, "/admin/locatii")}><Shield size={18} />Locatii</AdminNavLink> : null}
          {hasAnyPermission(session.role, ["leads.view", "leads.view.own"]) ? <AdminNavLink href="/admin/crm" active={isActiveAdminPath(pathname, "/admin/crm")}><UserRoundCheck size={18} />CRM</AdminNavLink> : null}
          {hasAnyPermission(session.role, ["clients.view", "clients.view.own", "campaigns.view", "campaigns.view.own", "finance.view"]) ? <AdminNavLink href="/admin/clienti" active={isActiveAdminPath(pathname, "/admin/clienti")}><Building2 size={18} />Clienti</AdminNavLink> : null}
          {hasAnyPermission(session.role, ["campaigns.view", "campaigns.view.own", "finance.view"]) ? <AdminNavLink href="/admin/campanii" active={isActiveAdminPath(pathname, "/admin/campanii")}><BriefcaseBusiness size={18} />Campanii</AdminNavLink> : null}
          {hasPermission(session.role, "finance.view") ? <AdminNavLink href="/admin/furnizori" active={isActiveAdminPath(pathname, "/admin/furnizori")}><Truck size={18} />Furnizori</AdminNavLink> : null}
          {hasAdminMenu ? (
            <details className="admin-export-menu relative flex-none">
              <summary className="focus-button secondary cursor-pointer list-none"><Shield size={18} />Admin</summary>
              <div className="absolute right-0 top-full z-50 mt-2 grid min-w-56 gap-2 rounded-lg border border-focus-line bg-focus-navy p-2 shadow-2xl">
                {canManageInventory ? <Link className="focus-button secondary" href="/admin/locatii/import"><FileSpreadsheet size={18} />Import</Link> : null}
                {canManageInventory ? <Link className="focus-button secondary" href="/admin/locatii/gps"><Map size={18} />GPS</Link> : null}
                {canManageUsers ? <Link className="focus-button secondary" href="/admin/utilizatori"><Users size={18} />Utilizatori</Link> : null}
                {canExportAvailability ? <a className="focus-button" href="/api/admin/availability/excel"><Download size={18} />Disponibil</a> : null}
                {canExportSales ? <a className="focus-button secondary" href="/api/admin/sales-report/excel"><Download size={18} />Vanzari</a> : null}
              </div>
            </details>
          ) : null}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <NotificationBell />
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
    >
      {children}
    </Link>
  );
}
