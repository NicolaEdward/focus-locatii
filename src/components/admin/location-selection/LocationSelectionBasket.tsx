"use client";

import { ArrowDown, ArrowUp, Copy, Download, FileImage, MoreHorizontal, Trash2, X } from "lucide-react";
import { AvailabilityBadge } from "@/components/admin/location-selection/AvailabilityBadge";
import type {
  LocationSelectionAvailability,
  LocationSelectionItem,
  MediaPlanSeed
} from "@/lib/location-selection-dto";

export function LocationSelectionBasket({
  items,
  warnings,
  mediaPlanSeed,
  periodStart,
  periodEnd,
  exportHref,
  onRemove,
  onClear,
  onMove,
  onCopyCodes
}: {
  items: LocationSelectionItem[];
  locationsById: Map<string, LocationSelectionItem>;
  warnings: string[];
  mediaPlanSeed: MediaPlanSeed;
  periodStart: string;
  periodEnd: string;
  exportHref: string;
  onRemove: (locationId: string) => void;
  onClear: () => void;
  onMove: (locationId: string, direction: -1 | 1) => void;
  onCopyCodes: () => void;
}) {
  const totalSurface = items.reduce((sum, item) => sum + (item.snapshot.surface || 0), 0);
  const estimatedTotal = items.reduce((sum, item) => sum + (item.suggestedBasePrice || 0), 0);
  const warningCount = items.filter((item) => item.availabilityState === "CONFLICT" || item.availabilityWarnings.length).length;
  const conflictCount = items.filter((item) => item.availabilityState === "CONFLICT").length;

  return (
    <aside className="sticky top-24 grid max-h-[calc(100vh-7rem)] min-w-0 content-start overflow-hidden rounded-lg border border-focus-line bg-focus-navy/92 shadow-2xl">
      <header className="border-b border-focus-line p-4">
        <p className="text-xs font-black uppercase text-focus-yellow">Selectia pentru oferta</p>
        <div className="mt-1 flex items-end justify-between gap-3">
          <h2 className="text-3xl font-black text-white">{items.length} locatii</h2>
          <p className="max-w-36 text-right text-xs font-bold text-slate-300">{periodLabel(periodStart, periodEnd)}</p>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <Metric label="Suprafata" value={totalSurface ? `${round(totalSurface)} mp` : "-"} />
          <Metric label="Estimare" value={estimatedTotal ? `${estimatedTotal.toLocaleString("ro-RO")} EUR` : "-"} />
          <Metric label="Avertizari" value={String(warningCount)} />
        </div>
        {conflictCount ? (
          <p className="mt-3 rounded-md border border-red-300/35 bg-red-400/10 px-3 py-2 text-xs font-bold text-red-100">
            {conflictCount} locatii selectate au conflict in perioada aleasa.
          </p>
        ) : null}
      </header>

      <div className="min-h-0 overflow-auto p-3">
        {items.length ? (
          <div className="grid gap-2">
            {items.map((item, index) => (
              <SelectedLocationRow
                key={item.locationId}
                item={item}
                index={index}
                total={items.length}
                onRemove={onRemove}
                onMove={onMove}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-focus-line p-5 text-center text-sm text-slate-300">
            Selectia este goala. Adauga locatii disponibile din lista.
          </div>
        )}
      </div>

      <footer className="grid gap-2 border-t border-focus-line p-4">
        {warnings.length ? (
          <div className="rounded-lg border border-amber-300/35 bg-amber-400/10 p-3 text-xs font-bold text-amber-100">
            {warnings.slice(0, 3).map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        ) : null}
        <button
          className="cursor-not-allowed rounded-lg border border-focus-line bg-focus-ink/80 px-4 py-3 text-center text-sm font-black uppercase text-slate-400"
          type="button"
          disabled
          title="Disponibil dupa activarea modulului Media Plan."
        >
          Continua catre Media Plan - urmatorul pas
        </button>
        <a className="focus-button secondary justify-center" href={exportHref}>
          <Download size={16} />
          Exporta disponibil
        </a>
        <p className="-mt-1 text-xs font-bold text-slate-400">
          Daca nu ai selectie, exportul foloseste rezultatele filtrate.
        </p>
        <button className="focus-button secondary" type="button" onClick={onClear} disabled={!items.length}>
          <Trash2 size={15} />
          Goleste selectia
        </button>
        <details className="rounded-lg border border-focus-line bg-focus-ink/55 p-3 text-xs text-slate-300">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-black text-focus-yellow">
            <MoreHorizontal size={15} />
            Mai multe
          </summary>
          <button className="mt-3 inline-flex items-center gap-2 rounded-md border border-focus-line px-3 py-2 font-bold text-slate-100 disabled:opacity-45" type="button" onClick={onCopyCodes} disabled={!items.length}>
            <Copy size={16} />
            Copiaza coduri selectate
          </button>
        </details>
        {process.env.NODE_ENV !== "production" ? (
          <details className="rounded-lg border border-focus-line bg-focus-ink/55 p-3 text-xs text-slate-300">
            <summary className="cursor-pointer font-black text-focus-yellow">Payload viitor Media Plan</summary>
            <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(mediaPlanSeed, null, 2)}</pre>
          </details>
        ) : null}
      </footer>
    </aside>
  );
}

function SelectedLocationRow({
  item,
  index,
  total,
  onRemove,
  onMove
}: {
  item: LocationSelectionItem;
  index: number;
  total: number;
  onRemove: (locationId: string) => void;
  onMove: (locationId: string, direction: -1 | 1) => void;
}) {
  const availability: LocationSelectionAvailability = {
    locationId: item.locationId,
    state: item.availabilityState,
    label: item.availabilityState === "CONFLICT" ? "Conflict" : item.availabilityState === "AVAILABLE" ? "Disponibil" : item.availabilityState === "PARTIAL" ? "Partial" : "Alege perioada",
    tone: item.availabilityState === "CONFLICT" ? "red" : item.availabilityState === "AVAILABLE" ? "green" : item.availabilityState === "PARTIAL" ? "yellow" : "gray",
    explanation: item.availabilityWarnings[0] || (item.availabilityState === "AVAILABLE" ? "Disponibil pentru contextul selectat." : "Alege perioada pentru verificare exacta."),
    warnings: item.availabilityWarnings,
    conflicts: [],
    blockingIntervals: []
  };

  return (
    <article className="rounded-lg border border-focus-line bg-focus-ink/60 p-3">
      <div className="flex gap-3">
        <img
          src={item.snapshot.mainImage || "/samples/location-placeholder.svg"}
          alt={item.snapshot.code}
          className="h-16 w-20 rounded-md border border-focus-line object-cover"
          loading="lazy"
          decoding="async"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-black text-white">{item.snapshot.code}</p>
              <p className="truncate text-xs font-bold text-slate-300">{item.snapshot.city || "-"} / {item.snapshot.area || "-"}</p>
            </div>
            <button className="rounded-md p-1 text-slate-300 hover:bg-white/10 hover:text-white" type="button" onClick={() => onRemove(item.locationId)} aria-label={`Scoate ${item.snapshot.code}`}>
              <X size={16} />
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {[item.snapshot.mediaType, item.snapshot.dimensions, item.snapshot.surface ? `${item.snapshot.surface} mp` : null].filter(Boolean).join(" / ") || "-"}
          </p>
          {item.snapshot.productionSketchUrl ? (
            <a
              className="mt-2 inline-flex items-center gap-1 rounded-full border border-focus-line px-2 py-1 text-[10px] font-black uppercase text-slate-200 hover:border-focus-yellow hover:text-focus-yellow"
              href={item.snapshot.productionSketchUrl}
              target="_blank"
              rel="noreferrer"
            >
              <FileImage size={12} />
              Schita
            </a>
          ) : null}
          <div className="mt-2">
            <AvailabilityBadge availability={availability} />
          </div>
          {item.availabilityWarnings[0] ? <p className="mt-1 line-clamp-2 text-xs text-amber-100">{item.availabilityWarnings[0]}</p> : null}
          <p className="mt-1 truncate text-xs text-slate-400">{item.snapshot.name || item.snapshot.address || "-"}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-400">#{index + 1}</p>
        <div className="flex gap-1">
          <button className="focus-button secondary !min-h-0 px-2 py-1 text-xs" type="button" onClick={() => onMove(item.locationId, -1)} disabled={index === 0} aria-label={`Muta ${item.snapshot.code} mai sus`}>
            <ArrowUp size={14} />
          </button>
          <button className="focus-button secondary !min-h-0 px-2 py-1 text-xs" type="button" onClick={() => onMove(item.locationId, 1)} disabled={index === total - 1} aria-label={`Muta ${item.snapshot.code} mai jos`}>
            <ArrowDown size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-focus-line bg-focus-ink/55 p-2">
      <span className="block text-[10px] font-black uppercase text-focus-yellow">{label}</span>
      <span className="mt-1 block font-black text-white">{value}</span>
    </span>
  );
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function periodLabel(periodStart: string, periodEnd: string) {
  if (!periodStart || !periodEnd) return "Alege perioada campaniei";
  if (periodStart > periodEnd) return "Perioada invalida";
  return `${formatDate(periodStart)} - ${formatDate(periodEnd)}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}
