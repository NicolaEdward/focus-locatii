"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BriefcaseBusiness,
  ArrowRightLeft,
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
import { ThemeToggle } from "@/components/admin/ThemeToggle";
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
  const canViewCommercialTools = hasAnyPermission(session.role, ["reservations.view", "reservations.view.own"]);
  const canManageOperationsControl = ["COO", "SUPER_ADMIN"].includes(session.role);
  const canViewDocumentAudit = ["COO", "SUPER_ADMIN", "D_CEO"].includes(session.role);
  const canViewFinance = hasPermission(session.role, "finance.view");
  const canViewSaga = hasPermission(session.role, "finance.integrations.saga.view");
  const canViewOperational = hasAnyPermission(session.role, ["dashboard.operations.view", "campaigns.operate", "reservations.view", "reservations.view.own", "inventory.view"]);
  const hasCommercialMenu = canViewInventory || canViewCrm || canViewClients || canViewCampaigns || canViewCommercialTools;
  const hasFinanceMenu = canViewFinance || canExportSales;
  const hasSettingsMenu = canManageInventory || canViewUsers || canViewSaga || !isFieldOperator;

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
              active={isActiveAnyAdminPath(pathname, ["/admin/selectie-locatii", "/admin/crm", "/admin/clienti", "/admin/campanii", "/admin/commercial-quotes", "/admin/dooh", "/admin/ai"])}
              icon={<BriefcaseBusiness size={18} />}
              label="Comercial"
            >
              {canViewInventory ? <AdminMenuLink href="/admin/selectie-locatii" active={isActiveAdminPath(pathname, "/admin/selectie-locatii")} icon={<ListChecks size={17} />} label="Selector oferta" /> : null}
              {canViewCrm ? <AdminMenuLink href="/admin/crm" active={isActiveAdminPath(pathname, "/admin/crm")} icon={<UserRoundCheck size={17} />} label="CRM" /> : null}
              {canViewClients ? <AdminMenuLink href="/admin/clienti" active={isActiveAdminPath(pathname, "/admin/clienti")} icon={<Building2 size={17} />} label="Clienti" /> : null}
              {canViewCampaigns ? <AdminMenuLink href="/admin/campanii" active={isActiveAdminPath(pathname, "/admin/campanii")} icon={<BriefcaseBusiness size={17} />} label="Campanii in Clienti" /> : null}
              {canViewCommercialTools ? <AdminMenuLink href="/admin/commercial-quotes" active={isActiveAdminPath(pathname, "/admin/commercial-quotes")} icon={<FileSpreadsheet size={17} />} label="Oferte comerciale" /> : null}
              {canViewCommercialTools && process.env.NEXT_PUBLIC_DOOH_ENABLED === "true" ? <AdminMenuLink href="/admin/dooh" active={isActiveAdminPath(pathname, "/admin/dooh")} icon={<MapPin size={17} />} label="DOOH" /> : null}
              {canViewCommercialTools ? <AdminMenuLink href="/admin/ai" active={isActiveAdminPath(pathname, "/admin/ai")} icon={<Users size={17} />} label="Copilot și pilot AI" /> : null}
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
              {canViewFinance ? <AdminMenuLink href="/admin/financiar/facturi-de-emis" active={isActiveAdminPath(pathname, "/admin/financiar/facturi-de-emis")} icon={<ListChecks size={17} />} label="Facturi de emis" /> : null}
              {canViewFinance ? <AdminMenuLink href="/admin/financiar/alocari" active={isActiveAdminPath(pathname, "/admin/financiar/alocari")} icon={<ArrowRightLeft size={17} />} label="Alocări pe campanii" /> : null}
              {canViewFinance ? <AdminMenuLink href="/admin/financiar/reconciliere" active={isActiveAdminPath(pathname, "/admin/financiar/reconciliere")} icon={<ArrowRightLeft size={17} />} label="Import și reconciliere" /> : null}
              {canViewFinance ? <AdminMenuLink href="/admin/furnizori" active={isActiveAdminPath(pathname, "/admin/furnizori")} icon={<Truck size={17} />} label="Furnizori" /> : null}
              {canExportSales ? <SalesReportExportButton variant="menu" icon={<Download size={17} />} label="Export vanzari" /> : null}
            </AdminNavMenu>
          ) : null}
          {hasSettingsMenu ? (
            <AdminNavMenu
              active={isActiveAnyAdminPath(pathname, ["/admin/utilizatori", "/admin/integritate-date", "/admin/integrari/saga", "/admin/locatii/import", "/admin/locatii/gps", "/admin/operations-control", "/admin/assistant-connections", "/admin/document-audit"])}
              icon={<Settings size={18} />}
              label="Setari"
            >
              {canManageInventory ? <AdminMenuLink href="/admin/locatii/import" active={isActiveAdminPath(pathname, "/admin/locatii/import")} icon={<FileSpreadsheet size={17} />} label="Import / actualizare" /> : null}
              {canManageInventory ? <AdminMenuLink href="/admin/locatii/gps" active={isActiveAdminPath(pathname, "/admin/locatii/gps")} icon={<Map size={17} />} label="Audit GPS" /> : null}
              {canViewUsers ? <AdminMenuLink href="/admin/utilizatori" active={isActiveAdminPath(pathname, "/admin/utilizatori")} icon={<Users size={17} />} label="Utilizatori" /> : null}
              {canManageUsers && ["COO", "SUPER_ADMIN"].includes(session.role) ? <AdminMenuLink href="/admin/integritate-date" active={isActiveAdminPath(pathname, "/admin/integritate-date")} icon={<ShieldCheck size={17} />} label="Integritate date" /> : null}
              {canViewSaga ? <AdminMenuLink href="/admin/integrari/saga" active={isActiveAdminPath(pathname, "/admin/integrari/saga")} icon={<Cable size={17} />} label="Integrari / SAGA" /> : null}
              {canManageOperationsControl ? <AdminMenuLink href="/admin/operations-control" active={isActiveAdminPath(pathname, "/admin/operations-control")} icon={<ShieldCheck size={17} />} label="Control operațional" /> : null}
              {!isFieldOperator ? <AdminMenuLink href="/admin/assistant-connections" active={isActiveAdminPath(pathname, "/admin/assistant-connections")} icon={<KeyRound size={17} />} label="Conexiunea ChatGPT" /> : null}
              {canViewDocumentAudit ? <AdminMenuLink href="/admin/document-audit" active={isActiveAdminPath(pathname, "/admin/document-audit")} icon={<FileSpreadsheet size={17} />} label="Audit documente NAS" /> : null}
            </AdminNavMenu>
          ) : null}
          {!isFieldOperator ? <AdminNavLink href="/locatii" active={false} quiet><MapPin size={18} />Portal public</AdminNavLink> : null}
        </nav>
        <div className="col-start-3 row-start-1 flex shrink-0 items-center gap-2">
          {!isFieldOperator && !isDceo ? <NotificationBell /> : null}
          <ThemeToggle />
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
  const pathname = usePathname();
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const keyboardOpenRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);

  useEffect(() => { setOpen(false); }, [pathname]);

  useLayoutEffect(() => {
    if (!open) return;
    function positionMenu() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(288, window.innerWidth - 16);
      const top = Math.min(rect.bottom + 8, window.innerHeight - 80);
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top, width, maxHeight: Math.max(64, window.innerHeight - top - 8) });
    }
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (keyboardOpenRef.current) menuRef.current?.querySelector<HTMLElement>("a[href],button:not([disabled])")?.focus();
    });
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    }
    function keyboard(event: KeyboardEvent) {
      // A dialog launched by an export button owns Escape while it is open.
      if ((event.target as Element)?.closest?.('[role="dialog"]')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyboard);
    };
  }, [open]);

  return (
    <div className="relative flex-none">
      <button
        ref={triggerRef}
        type="button"
        data-admin-menu-trigger={label}
        className={`focus-button cursor-pointer list-none ${active ? "" : "secondary"}`}
        aria-current={active ? "page" : undefined}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(event) => { keyboardOpenRef.current = event.detail === 0; setOpen((value) => !value); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            keyboardOpenRef.current = true;
            setOpen(true);
          }
        }}
      >
        {icon}
        {label}
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? createPortal(
        <div
          ref={menuRef}
          id={id}
          data-admin-menu={label}
          role="group"
          aria-label={label}
          className="admin-nav-popup fixed z-[60] grid gap-1 overflow-y-auto rounded-lg border border-focus-line bg-focus-navy p-2 shadow-2xl"
          style={{ ...position, visibility: position ? "visible" : "hidden" }}
          onClick={(event) => { if ((event.target as Element).closest("a[href]")) setOpen(false); }}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (next instanceof Node && !event.currentTarget.contains(next) && !triggerRef.current?.contains(next)) setOpen(false);
          }}
        >{children}</div>, document.body
      ) : null}
    </div>
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
