"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, History, LoaderCircle, Search, Settings2 } from "lucide-react";
import type { OccupancySummaryDTO, ReservationListItemDTO, ReservationPageDTO } from "@/types/location";
import { OccupancySummary } from "@/components/admin/inventory/OccupancySummary";

type ReservationFilters = {
  query: string;
  status: string;
  scope: "active" | "history";
};

export function ReservationList({
  initialPage,
  initialSummary,
  initialFilters,
  canManage,
  refreshToken,
  onOpenWorkspace
}: {
  initialPage: ReservationPageDTO;
  initialSummary: OccupancySummaryDTO;
  initialFilters: ReservationFilters;
  canManage: boolean;
  refreshToken: number;
  onOpenWorkspace: (options?: { reservationId?: string; newReservation?: boolean }) => void;
}) {
  const [result, setResult] = useState(initialPage);
  const [summary, setSummary] = useState(initialSummary);
  const [query, setQuery] = useState(initialFilters.query);
  const [status, setStatus] = useState(initialFilters.status);
  const [scope, setScope] = useState<"active" | "history">(initialFilters.scope);
  const [page, setPage] = useState(initialPage.page);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const params = new URLSearchParams({ scope, page: String(page), pageSize: String(result.pageSize) });
      if (query.trim()) params.set("q", query.trim());
      if (status) params.set("status", status);
      syncReservationUrl({ query, status, scope, page });
      try {
        const response = await fetch(`/api/admin/reservations?${params}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Rezervarile nu au putut fi incarcate.");
        setResult(payload.page);
        setSummary(payload.summary);
        if (payload.page.page !== page) setPage(payload.page.page);
      } catch (requestError) {
        if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : "Rezervarile nu au putut fi incarcate.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [page, query, refreshToken, result.pageSize, scope, status]);

  function changeFilter(update: () => void) {
    setPage(1);
    update();
  }

  return (
    <div className="grid gap-4">
      <OccupancySummary summary={summary} />
      <div className="focus-card grid gap-4 rounded-lg p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-black uppercase text-focus-yellow">Ocupare curenta si viitoare</p><h3 className="font-display text-2xl font-black uppercase text-white">Rezervari si HOLD-uri</h3></div>
          <div className="flex flex-wrap gap-2">
            {canManage ? <button className="focus-button" type="button" onClick={() => onOpenWorkspace({ newReservation: true })}><CalendarDays size={17} /> Rezervare noua</button> : null}
            <button className="focus-button secondary" type="button" onClick={() => onOpenWorkspace()}><Settings2 size={17} /> Gestionare completa</button>
          </div>
        </div>

        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_190px_auto]">
          <label className="relative min-w-0"><Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400" /><input className="focus-input min-w-0 pl-10" value={query} onChange={(event) => changeFilter(() => setQuery(event.target.value))} placeholder="Client, campanie, locatie, contract" /></label>
          <select className="focus-input min-w-0" value={status} onChange={(event) => changeFilter(() => setStatus(event.target.value))}>
            <option value="">Toate statusurile</option><option value="HOLD">HOLD</option><option value="RESERVED">RESERVED</option><option value="BOOKED">BOOKED</option><option value="CANCELLED">CANCELLED</option><option value="EXPIRED">EXPIRED</option>
          </select>
          <div className="inline-flex rounded-lg border border-focus-line bg-focus-navy p-1" aria-label="Perioada rezervarilor">
            <button className={`rounded-md px-3 py-2 text-sm font-black ${scope === "active" ? "bg-focus-yellow text-focus-navy" : "text-slate-200"}`} type="button" onClick={() => changeFilter(() => setScope("active"))}>Active</button>
            <button className={`rounded-md px-3 py-2 text-sm font-black ${scope === "history" ? "bg-focus-yellow text-focus-navy" : "text-slate-200"}`} type="button" onClick={() => changeFilter(() => setScope("history"))}><History className="mr-1 inline" size={15} /> Istoric</button>
          </div>
        </div>

        <div className="flex min-h-6 items-center justify-between gap-3 text-sm text-slate-400"><p>{result.total} rezultate · pagina {result.page} din {result.totalPages}</p>{loading ? <span className="inline-flex items-center gap-2"><LoaderCircle className="animate-spin" size={16} /> Se actualizeaza</span> : null}</div>
        {error ? <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-100">{error}</p> : null}

        <div className="hidden overflow-x-auto rounded-lg border border-focus-line lg:block">
          <table className="w-full min-w-[900px] border-collapse bg-focus-ink/55 text-sm"><thead className="bg-focus-navy text-left text-xs uppercase text-focus-yellow"><tr><Th>Locatie</Th><Th>Client / campanie</Th><Th>Status</Th><Th>Perioada</Th><Th>Responsabil</Th><Th>Actiune</Th></tr></thead><tbody>{result.items.map((item) => <ReservationRow key={item.id} item={item} onOpen={() => onOpenWorkspace({ reservationId: item.id })} />)}</tbody></table>
        </div>
        <div className="grid gap-3 lg:hidden">{result.items.map((item) => <ReservationCard key={item.id} item={item} onOpen={() => onOpenWorkspace({ reservationId: item.id })} />)}</div>
        {!result.items.length && !loading ? <p className="rounded-lg border border-focus-line bg-focus-navy/35 p-6 text-center text-sm text-slate-400">{scope === "history" ? "Nu exista istoric pentru filtrele selectate." : "Nu exista rezervari active sau viitoare pentru filtrele selectate."}</p> : null}
        <div className="flex items-center justify-between gap-3"><button className="focus-button secondary" type="button" disabled={!result.hasPreviousPage || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Inapoi</button><span className="text-sm font-bold text-slate-300">Pagina {result.page} / {result.totalPages}</span><button className="focus-button secondary" type="button" disabled={!result.hasNextPage || loading} onClick={() => setPage((current) => current + 1)}>Inainte</button></div>
      </div>
    </div>
  );
}

function ReservationRow({ item, onOpen }: { item: ReservationListItemDTO; onOpen: () => void }) {
  return <tr className="border-t border-focus-line"><Td><strong className="text-white">{item.locationCode}</strong><p className="max-w-56 text-xs text-slate-400">{item.locationName || "-"}</p></Td><Td><strong className="text-slate-100">{item.clientName}</strong><p className="text-xs text-slate-400">{item.campaignName || item.contractNumber || "Fara campanie"}</p></Td><Td><ReservationStatus status={item.status} holdExpiresAt={item.holdExpiresAt} /></Td><Td>{formatDate(item.periodStart)} - {formatDate(item.periodEnd)}</Td><Td>{item.salesperson || "Nealocat"}</Td><Td><button className="focus-button secondary" type="button" onClick={onOpen}>Deschide</button></Td></tr>;
}

function ReservationCard({ item, onOpen }: { item: ReservationListItemDTO; onOpen: () => void }) {
  return <article className="rounded-lg border border-focus-line bg-focus-ink/60 p-4"><div className="flex items-start justify-between gap-3"><div><strong className="text-white">{item.locationCode}</strong><p className="text-xs text-slate-400">{item.clientName}</p></div><ReservationStatus status={item.status} holdExpiresAt={item.holdExpiresAt} /></div><p className="mt-3 text-sm font-bold text-slate-200">{item.campaignName || item.contractNumber || "Fara campanie"}</p><p className="mt-1 text-xs text-slate-400">{formatDate(item.periodStart)} - {formatDate(item.periodEnd)} · {item.salesperson || "Nealocat"}</p><button className="focus-button secondary mt-4 w-full" type="button" onClick={onOpen}>Deschide rezervarea</button></article>;
}

function ReservationStatus({ status, holdExpiresAt }: { status: ReservationListItemDTO["status"]; holdExpiresAt: string | null }) {
  const tone = status === "BOOKED" ? "border-red-400/40 bg-red-400/10 text-red-100" : status === "HOLD" || status === "RESERVED" ? "border-amber-400/40 bg-amber-400/10 text-amber-100" : "border-slate-500/40 bg-slate-500/10 text-slate-200";
  return <div><span className={`inline-flex rounded-full border px-2 py-1 text-xs font-black ${tone}`}>{status}</span>{holdExpiresAt && (status === "HOLD" || status === "RESERVED") ? <p className="mt-1 text-[11px] text-slate-400">Expira {formatDateTime(holdExpiresAt)}</p> : null}</div>;
}

function Th({ children }: { children: ReactNode }) { return <th className="px-4 py-3 font-black">{children}</th>; }
function Td({ children }: { children: ReactNode }) { return <td className="align-top px-4 py-3">{children}</td>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" }).format(new Date(value)); }

function syncReservationUrl(filters: ReservationFilters & { page: number }) {
  const params = new URLSearchParams(window.location.search);
  setOrDelete(params, "rq", filters.query.trim());
  setOrDelete(params, "rstatus", filters.status);
  if (filters.scope === "history") params.set("rscope", "history"); else params.delete("rscope");
  if (filters.page > 1) params.set("rpage", String(filters.page)); else params.delete("rpage");
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
}

function setOrDelete(params: URLSearchParams, key: string, value: string) { if (value) params.set(key, value); else params.delete(key); }
