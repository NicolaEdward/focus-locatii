"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Download, FileSpreadsheet, ListChecks, LoaderCircle, Map, MoreHorizontal, Plus } from "lucide-react";
import type { AuthSession } from "@/lib/auth";
import { hasAnyPermission, hasPermission } from "@/lib/rbac";
import type {
  AdminLocationListItemDTO,
  AdminLocationPageDTO,
  CategoryDTO,
  LocationDTO,
  OccupancySummaryDTO,
  ReservationPageDTO
} from "@/types/location";
import { InventoryList } from "@/components/admin/inventory/InventoryList";
import { ReservationList } from "@/components/admin/inventory/ReservationList";
import { LazyReservationWorkspace, type ReservationWorkspaceRequest } from "@/components/admin/inventory/LazyReservationWorkspace";

const LocationEditor = dynamic(() => import("@/components/admin/LocationEditor").then((module) => module.LocationEditor), {
  ssr: false,
  loading: () => <OverlayLoading label="Se incarca editorul locatiei..." />
});
const LocationDetailDrawer = dynamic(() => import("@/components/admin/LocationDetailDrawer").then((module) => module.LocationDetailDrawer), {
  ssr: false,
  loading: () => <OverlayLoading label="Se incarca detaliile locatiei..." />
});

type DashboardFilters = {
  inventory: { query: string; category: string; status: string };
  reservations: { query: string; status: string; scope: "active" | "history" };
};

export function AdminDashboard({
  initialLocations,
  categories,
  initialReservations,
  initialOccupancySummary,
  initialFocusedLocation,
  initialWorkspaceRequest,
  initialFilters,
  session
}: {
  initialLocations: AdminLocationPageDTO;
  categories: CategoryDTO[];
  initialReservations: ReservationPageDTO;
  initialOccupancySummary: OccupancySummaryDTO;
  initialFocusedLocation: AdminLocationListItemDTO | null;
  initialWorkspaceRequest: Omit<ReservationWorkspaceRequest, "key"> | null;
  initialFilters: DashboardFilters;
  session: AuthSession;
}) {
  const [detailLocation, setDetailLocation] = useState<AdminLocationListItemDTO | null>(initialFocusedLocation);
  const [editing, setEditing] = useState<LocationDTO | null | undefined>(undefined);
  const [workspaceRequest, setWorkspaceRequest] = useState<ReservationWorkspaceRequest | null>(
    initialWorkspaceRequest ? { ...initialWorkspaceRequest, key: 1 } : null
  );
  const [refreshToken, setRefreshToken] = useState(0);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [loadingEditor, setLoadingEditor] = useState(false);
  const canManageLocations = hasPermission(session.role, "inventory.manage");
  const canManageReservations = hasAnyPermission(session.role, ["reservations.manage", "reservations.manage.own"]);

  useEffect(() => {
    if (initialFocusedLocation) syncFocusedLocation(initialFocusedLocation.id);
  }, [initialFocusedLocation]);

  function openLocation(location: AdminLocationListItemDTO) {
    setDetailLocation(location);
    syncFocusedLocation(location.id);
  }

  async function editLocation(location: AdminLocationListItemDTO) {
    setLoadingEditor(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/locations/${encodeURIComponent(location.id)}?scope=admin`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Detaliile complete nu au putut fi incarcate.");
      setEditing(payload.location);
      setDetailLocation(null);
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "Detaliile complete nu au putut fi incarcate." });
    } finally {
      setLoadingEditor(false);
    }
  }

  function openReservationWorkspace(options: { reservationId?: string; newReservation?: boolean } = {}) {
    setWorkspaceRequest((current) => ({ ...options, key: (current?.key || 0) + 1 }));
  }

  function dataChanged(message?: string) {
    setRefreshToken((current) => current + 1);
    if (message) setFeedback({ tone: "ok", text: message });
  }

  return (
    <main className="focus-shell py-8">
      <section className="focus-container grid min-w-0 gap-6">
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-focus-yellow">Inventar OOH</p>
            <h1 className="font-display text-4xl font-black uppercase">Locatii</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">Gestioneaza inventarul, ocuparea si detaliile locatiilor. Selectia comerciala si exportul de disponibilitate se fac din Selector oferta.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManageLocations ? <button className="focus-button" type="button" onClick={() => setEditing(null)}><Plus size={18} /> Adauga locatie</button> : null}
            <Link className="focus-button secondary" href="/admin/selectie-locatii" prefetch={false}><ListChecks size={18} /> Deschide Selector oferta</Link>
            {canManageLocations ? <LocationToolsMenu /> : null}
          </div>
        </div>

        {feedback ? <p className={`rounded-lg border px-4 py-3 text-sm font-bold ${feedback.tone === "ok" ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100" : "border-red-400/40 bg-red-400/10 text-red-100"}`}>{feedback.text}</p> : null}

        <section id="rezervari" className="grid scroll-mt-28 gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-focus-line pb-3">
            <div><p className="text-xs font-black uppercase text-focus-yellow">Ocupare locatii</p><h2 className="font-display text-2xl font-black uppercase text-white">Rezervari si HOLD-uri</h2></div>
            <p className="max-w-2xl text-sm text-slate-400">Prima lista arata numai ocuparea relevanta. Istoricul si editorul complet se incarca atunci cand le deschizi.</p>
          </div>
          <ReservationList
            initialPage={initialReservations}
            initialSummary={initialOccupancySummary}
            initialFilters={initialFilters.reservations}
            canManage={canManageReservations}
            refreshToken={refreshToken}
            onOpenWorkspace={openReservationWorkspace}
          />
        </section>

        <section id="locatii" className="grid scroll-mt-28 gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-focus-line pb-3">
            <div><p className="text-xs font-black uppercase text-focus-yellow">Administrare inventar</p><h2 className="font-display text-2xl font-black uppercase text-white">Inventar locatii</h2></div>
            <p className="text-sm text-slate-400">Lista este paginata; pozele, istoricul si campurile private se incarca numai la deschidere.</p>
          </div>
          <InventoryList
            initialPage={initialLocations}
            initialFilters={initialFilters.inventory}
            categories={categories}
            focusedLocation={detailLocation?.id || initialFocusedLocation?.id || null}
            canManage={canManageLocations}
            refreshToken={refreshToken}
            onOpen={openLocation}
            onEdit={editLocation}
          />
        </section>
      </section>

      {loadingEditor ? <OverlayLoading label="Se incarca detaliile complete..." /> : null}
      {canManageLocations && editing !== undefined ? (
        <LocationEditor
          location={editing}
          categories={categories}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            dataChanged("Locatia a fost salvata. Lista a fost actualizata.");
          }}
        />
      ) : null}

      {detailLocation ? (
        <LocationDetailDrawer
          location={detailLocation}
          session={session}
          canEdit={canManageLocations}
          onClose={() => {
            setDetailLocation(null);
            syncFocusedLocation(null);
          }}
          onEdit={() => editLocation(detailLocation)}
        />
      ) : null}

      <LazyReservationWorkspace
        request={workspaceRequest}
        session={session}
        onClose={() => {
          setWorkspaceRequest(null);
          dataChanged();
        }}
        onChanged={() => dataChanged()}
      />
    </main>
  );
}

function LocationToolsMenu() {
  return <details className="relative"><summary className="focus-button secondary cursor-pointer list-none"><MoreHorizontal size={18} /> Mai multe</summary><div className="absolute right-0 z-20 mt-2 grid min-w-60 gap-1 rounded-lg border border-focus-line bg-focus-navy p-2 shadow-2xl">
    <a className="rounded-md px-3 py-2 text-left text-sm font-bold text-slate-100 hover:bg-focus-yellow/10" href="/api/export/json"><Download className="mr-2 inline h-4 w-4" /> Export inventar JSON</a>
    <Link className="rounded-md px-3 py-2 text-left text-sm font-bold text-slate-100 hover:bg-focus-yellow/10" href="/admin/locatii/import" prefetch={false}><FileSpreadsheet className="mr-2 inline h-4 w-4" /> Import / actualizare</Link>
    <Link className="rounded-md px-3 py-2 text-left text-sm font-bold text-slate-100 hover:bg-focus-yellow/10" href="/admin/locatii/gps" prefetch={false}><Map className="mr-2 inline h-4 w-4" /> Audit GPS</Link>
  </div></details>;
}

function OverlayLoading({ label }: { label: string }) {
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"><div className="inline-flex items-center gap-3 rounded-lg border border-focus-line bg-focus-navy p-5 text-sm font-bold text-white shadow-2xl"><LoaderCircle className="animate-spin text-focus-yellow" size={20} /> {label}</div></div>;
}

function syncFocusedLocation(id: string | null) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (id) params.set("locationId", id); else params.delete("locationId");
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
}
