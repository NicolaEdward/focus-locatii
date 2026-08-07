"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Edit, Eye, LoaderCircle, MoreHorizontal, Search, Trash2 } from "lucide-react";
import type { AdminLocationListItemDTO, AdminLocationPageDTO, CategoryDTO } from "@/types/location";
import { StatusBadge } from "@/components/ui/StatusBadge";

type InventoryFilters = {
  query: string;
  category: string;
  status: string;
};

export function InventoryList({
  initialPage,
  initialFilters,
  categories,
  focusedLocation,
  canManage,
  refreshToken,
  onOpen,
  onEdit
}: {
  initialPage: AdminLocationPageDTO;
  initialFilters: InventoryFilters;
  categories: CategoryDTO[];
  focusedLocation: string | null;
  canManage: boolean;
  refreshToken: number;
  onOpen: (location: AdminLocationListItemDTO) => void;
  onEdit: (location: AdminLocationListItemDTO) => void;
}) {
  const [result, setResult] = useState(initialPage);
  const [query, setQuery] = useState(initialFilters.query);
  const [category, setCategory] = useState(initialFilters.category);
  const [status, setStatus] = useState(initialFilters.status);
  const [page, setPage] = useState(initialPage.page);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);
  const firstRequest = useRef(true);

  useEffect(() => {
    if (firstRequest.current && refreshToken === 0) {
      firstRequest.current = false;
      return;
    }
    firstRequest.current = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ page: String(page), pageSize: String(result.pageSize) });
      if (query.trim()) params.set("q", query.trim());
      if (category) params.set("category", category);
      if (status) params.set("status", status);
      syncInventoryUrl({ query, category, status, page });
      try {
        const response = await fetch(`/api/admin/locations?${params}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Inventarul nu a putut fi incarcat.");
        setResult(payload.locations);
        if (payload.locations.page !== page) setPage(payload.locations.page);
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : "Inventarul nu a putut fi incarcat.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [category, localRefresh, page, query, refreshToken, result.pageSize, status]);

  function changeFilter(update: () => void) {
    setPage(1);
    update();
  }

  async function duplicate(location: AdminLocationListItemDTO) {
    const label = locationLabel(location);
    if (!confirm(`Duplici locatia ${label}? Se va crea o copie ascunsa din portalul public pana la verificare.`)) return;
    const response = await fetch(`/api/locations/${location.id}?action=duplicate`, { method: "POST" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error || "Locatia nu a putut fi duplicata.");
      return;
    }
    setPage(1);
    setLocalRefresh((current) => current + 1);
  }

  async function remove(location: AdminLocationListItemDTO) {
    const label = locationLabel(location);
    if (!confirm(`Stergi locatia ${label}? Actiunea este permanenta si nu se poate aplica daca exista istoric comercial.`)) return;
    const response = await fetch(`/api/locations/${location.id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error || "Locatia nu a putut fi stearsa.");
      return;
    }
    setResult((current) => ({
      ...current,
      total: Math.max(0, current.total - 1),
      items: current.items.filter((item) => item.id !== location.id)
    }));
  }

  return (
    <div className="grid gap-3">
      <div className="focus-card grid min-w-0 gap-3 rounded-lg p-4 md:grid-cols-[minmax(0,1fr)_220px_220px]">
        <label className="relative min-w-0">
          <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400" />
          <input
            className="focus-input min-w-0 pl-10"
            value={query}
            onChange={(event) => changeFilter(() => setQuery(event.target.value))}
            placeholder="Cauta cod, adresa, oras sau format"
          />
        </label>
        <select aria-label="Filtreaza inventarul dupa categorie" className="focus-input min-w-0" value={category} onChange={(event) => changeFilter(() => setCategory(event.target.value))}>
          <option value="">Toate categoriile</option>
          {categories.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}
        </select>
        <select aria-label="Filtreaza inventarul dupa stare" className="focus-input min-w-0" value={status} onChange={(event) => changeFilter(() => setStatus(event.target.value))}>
          <option value="">Toate starile</option>
          <option value="ACTIVE">Active</option>
          <option value="MAINTENANCE">Mentenanta</option>
          <option value="INACTIVE">Inactive</option>
          <option value="ARCHIVED">Arhivate</option>
        </select>
      </div>

      <div className="flex min-h-6 items-center justify-between gap-3 text-sm text-slate-400">
        <p>{result.total} locatii · pagina {result.page} din {result.totalPages}</p>
        {loading ? <span className="inline-flex items-center gap-2"><LoaderCircle className="animate-spin" size={16} /> Se actualizeaza</span> : null}
      </div>
      {error ? <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-100">{error}</p> : null}

      <div className="hidden overflow-x-auto rounded-lg border border-focus-line lg:block">
        <table className="w-full min-w-[960px] border-collapse bg-focus-ink/70 text-sm">
          <thead className="bg-focus-navy text-left text-xs uppercase text-focus-yellow">
            <tr><Th>Cod</Th><Th>Locatie</Th><Th>Vizibilitate</Th><Th>Status calculat</Th><Th>Pret</Th><Th>Actiuni</Th></tr>
          </thead>
          <tbody>{result.items.map((location) => (
            <tr key={location.id} className={`border-t border-focus-line ${isFocused(location, focusedLocation) ? "bg-focus-yellow/10 outline outline-1 outline-focus-yellow/50" : ""}`}>
              <Td><strong className="text-white">{location.code}</strong><p className="text-xs text-slate-400">{location.categoryName}</p></Td>
              <Td><p className="font-bold">{location.address || "Fara adresa"}</p><p className="text-xs text-slate-400">{location.city || "N/A"} | {location.type || "N/A"} | {location.sqm || 0} mp</p></Td>
              <Td><Visibility location={location} /></Td>
              <Td><StatusBadge status={location.publicStatus} publicStatus={location.publicStatus} availability={location.availabilityLabel} /><p className="mt-1 max-w-xs text-xs text-slate-400">{location.availabilityDetail || "Calculata din rezervari si blocaje."}</p></Td>
              <Td><span className="font-bold text-white">{location.rateCard || (location.rateCardValue != null ? `${location.rateCardValue} EUR` : "-")}</span>{location.installationRemoval ? <small className="block text-slate-400">Montaj: {location.installationRemoval}</small> : null}</Td>
              <Td><LocationActions location={location} canManage={canManage} onOpen={() => onOpen(location)} onEdit={() => onEdit(location)} onDuplicate={() => duplicate(location)} onDelete={() => remove(location)} /></Td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div className="grid gap-3 lg:hidden">
        {result.items.map((location) => (
          <article key={location.id} className={`rounded-lg border bg-focus-ink/70 p-4 ${isFocused(location, focusedLocation) ? "border-focus-yellow" : "border-focus-line"}`}>
            <div className="flex items-start justify-between gap-3"><div><strong className="text-white">{location.code}</strong><p className="text-xs text-slate-400">{location.categoryName}</p></div><StatusBadge status={location.publicStatus} publicStatus={location.publicStatus} availability={location.availabilityLabel} /></div>
            <p className="mt-3 font-bold text-slate-100">{location.address || location.city || "Fara adresa"}</p>
            <p className="mt-1 text-xs text-slate-400">{[location.city, location.type, location.sqm ? `${location.sqm} mp` : null].filter(Boolean).join(" · ")}</p>
            <div className="mt-4"><LocationActions location={location} canManage={canManage} onOpen={() => onOpen(location)} onEdit={() => onEdit(location)} onDuplicate={() => duplicate(location)} onDelete={() => remove(location)} /></div>
          </article>
        ))}
      </div>

      {!result.items.length && !loading ? <p className="rounded-lg border border-focus-line bg-focus-ink/55 p-6 text-center text-sm text-slate-400">Nu exista locatii pentru filtrele selectate.</p> : null}
      <div className="flex items-center justify-between gap-3">
        <button className="focus-button secondary" type="button" disabled={!result.hasPreviousPage || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Inapoi</button>
        <span className="text-sm font-bold text-slate-300">Pagina {result.page} / {result.totalPages}</span>
        <button className="focus-button secondary" type="button" disabled={!result.hasNextPage || loading} onClick={() => setPage((current) => current + 1)}>Inainte</button>
      </div>
    </div>
  );
}

function LocationActions({ location, canManage, onOpen, onEdit, onDuplicate, onDelete }: { location: AdminLocationListItemDTO; canManage: boolean; onOpen: () => void; onEdit: () => void; onDuplicate: () => void; onDelete: () => void }) {
  return <div className="flex flex-wrap gap-2">
    <button className="focus-button secondary" type="button" onClick={onOpen}><Eye size={16} /> Detalii</button>
    {canManage ? <details className="relative"><summary className="focus-button secondary cursor-pointer list-none"><MoreHorizontal size={16} /> Actiuni</summary><div className="absolute right-0 z-20 mt-2 grid min-w-56 gap-1 rounded-lg border border-focus-line bg-focus-navy p-2 shadow-2xl">
      <button className="rounded-md px-3 py-2 text-left text-sm font-bold text-slate-100 hover:bg-focus-yellow/10" type="button" onClick={onEdit}><Edit className="mr-2 inline h-4 w-4" /> Editare completa</button>
      <button className="rounded-md px-3 py-2 text-left text-sm font-bold text-slate-100 hover:bg-focus-yellow/10" type="button" onClick={onDuplicate}><Copy className="mr-2 inline h-4 w-4" /> Duplica locatia</button>
      <button className="rounded-md px-3 py-2 text-left text-sm font-bold text-red-100 hover:bg-red-500/10" type="button" onClick={onDelete}><Trash2 className="mr-2 inline h-4 w-4" /> Sterge / arhiveaza</button>
    </div></details> : null}
  </div>;
}

function Visibility({ location }: { location: AdminLocationListItemDTO }) {
  return <div className="grid gap-1"><span className={`text-xs font-black uppercase ${location.showInPublic ? "text-emerald-200" : "text-slate-500"}`}>{location.showInPublic ? "Publica" : "Ascunsa public"}</span><span className="text-xs text-slate-400">Pret {location.showPricePublic ? "public" : "ascuns"}</span></div>;
}

function Th({ children }: { children: ReactNode }) { return <th className="px-4 py-3 font-black">{children}</th>; }
function Td({ children }: { children: ReactNode }) { return <td className="align-top px-4 py-3">{children}</td>; }
function isFocused(location: AdminLocationListItemDTO, focused: string | null) { return Boolean(focused && (location.id === focused || location.code === focused)); }
function locationLabel(location: AdminLocationListItemDTO) { return [location.code, location.address || location.city].filter(Boolean).join(" - ") || location.id; }

function syncInventoryUrl(filters: InventoryFilters & { page: number }) {
  const params = new URLSearchParams(window.location.search);
  setOrDelete(params, "q", filters.query.trim());
  setOrDelete(params, "category", filters.category);
  setOrDelete(params, "status", filters.status);
  if (filters.page > 1) params.set("page", String(filters.page)); else params.delete("page");
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
}

function setOrDelete(params: URLSearchParams, key: string, value: string) { if (value) params.set(key, value); else params.delete(key); }
