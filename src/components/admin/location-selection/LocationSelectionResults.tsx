"use client";

import { memo } from "react";
import { AlertTriangle, FileImage, Plus, X } from "lucide-react";
import { AvailabilityBadge } from "@/components/admin/location-selection/AvailabilityBadge";
import type { LocationSelectionAvailability, LocationSelectionLocationDTO } from "@/lib/location-selection-dto";

export const LocationSelectionResults = memo(function LocationSelectionResults({
  locations,
  availabilityById,
  selectedIds,
  onAdd,
  onRemove,
  onHover
}: {
  locations: LocationSelectionLocationDTO[];
  availabilityById: Record<string, LocationSelectionAvailability>;
  selectedIds: Set<string>;
  onAdd: (location: LocationSelectionLocationDTO) => void;
  onRemove: (locationId: string) => void;
  onHover: (locationId: string | null) => void;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-focus-line bg-focus-navy/80">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-focus-line p-4">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Locatii propunibile</p>
          <h2 className="text-xl font-black text-white">{locations.length} rezultate</h2>
        </div>
        <p className="text-sm font-bold text-slate-300">Selectie rapida pentru oferta OOH</p>
      </header>
      <div className="max-h-[760px] overflow-auto">
        <table className="w-full min-w-[820px] table-fixed text-left text-sm">
          <thead className="sticky top-0 z-10 bg-focus-ink text-xs uppercase text-slate-300">
            <tr>
              <th className="w-[32%] px-3 py-3">Locatie</th>
              <th className="w-[15%] px-3 py-3">Zona</th>
              <th className="w-[16%] px-3 py-3">Format</th>
              <th className="w-[22%] px-3 py-3">Disponibilitate</th>
              <th className="w-[9%] px-3 py-3">Pret</th>
              <th className="w-[116px] px-3 py-3 text-right">Actiune</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-focus-line">
            {locations.map((location) => {
              const selected = selectedIds.has(location.id);
              const availability = availabilityById[location.id];
              const unavailable = availability?.state === "CONFLICT";
              return (
                <tr
                  key={location.id}
                  className={selected ? "bg-focus-yellow/8" : unavailable ? "bg-red-950/15" : "hover:bg-white/[0.03]"}
                  onMouseEnter={() => onHover(location.id)}
                  onMouseLeave={() => onHover(null)}
                >
                  <td className="px-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <img
                        src={location.thumbnail || "/samples/location-placeholder.svg"}
                        alt={location.code}
                        className="h-14 w-20 rounded-md border border-focus-line object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-black text-white">{location.code}</span>
                          {selected ? <span className="rounded-full bg-focus-yellow px-2 py-0.5 text-[10px] font-black uppercase text-focus-black">Selectata</span> : null}
                          {!location.hasImage ? <span title="Fara poza principala"><AlertTriangle className="h-4 w-4 text-amber-200" /></span> : null}
                          {location.productionSketchUrl ? (
                            <a
                              className="inline-flex items-center gap-1 rounded-full border border-focus-line px-2 py-0.5 text-[10px] font-black uppercase text-slate-200 hover:border-focus-yellow hover:text-focus-yellow"
                              href={location.productionSketchUrl}
                              target="_blank"
                              rel="noreferrer"
                              title="Deschide schita de productie"
                            >
                              <FileImage size={12} />
                              Schita
                            </a>
                          ) : null}
                        </div>
                        <p className="max-w-[300px] truncate text-xs font-bold text-slate-300">{location.name || location.address || "-"}</p>
                        <p className="text-xs text-slate-500">{location.visibility === "PUBLIC" ? "Publica" : "Ascunsa public"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <p className="font-bold text-white">{location.city || "-"}</p>
                    <p className="text-xs text-slate-400">{location.area || "-"}</p>
                  </td>
                  <td className="px-3 py-3">
                    <p className="font-bold text-white">{location.mediaType || location.category || "OOH"}</p>
                    <p className="text-xs text-slate-400">{[location.dimensions, sqm(location.surface)].filter(Boolean).join(" / ") || "-"}</p>
                  </td>
                  <td className="px-3 py-3">
                    <AvailabilityBadge availability={availability} />
                    <p className={`mt-1 max-w-[260px] truncate text-xs ${availability?.state === "CONFLICT" ? "text-red-100" : availability?.tone === "yellow" ? "text-amber-100" : "text-slate-400"}`}>
                      {availability?.explanation || "Alege perioada pentru verificare exacta."}
                    </p>
                    {availability?.blockingIntervals.length ? (
                      <p className="mt-1 max-w-[260px] truncate text-[11px] font-bold text-slate-400">
                        {blockingText(availability)}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <p className="font-black text-white">{price(location)}</p>
                    {rateCardLabel(location) ? <p className="text-xs text-slate-400">{rateCardLabel(location)}</p> : null}
                  </td>
                  <td className="px-3 py-3 text-right align-middle">
                    {selected ? (
                      <button className="focus-button secondary !min-h-0 w-[104px] justify-center px-3 py-2 text-xs" type="button" onClick={() => onRemove(location.id)}>
                        <X size={15} />
                        Scoate
                      </button>
                    ) : (
                      <button
                        className="focus-button !min-h-0 w-[104px] justify-center px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-45"
                        type="button"
                        onClick={() => onAdd(location)}
                        disabled={unavailable}
                        title={unavailable ? "Locatia este indisponibila in perioada selectata." : undefined}
                      >
                        <Plus size={15} />
                        Adauga
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!locations.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm font-bold text-slate-300">
                  Nu exista locatii propunibile pentru filtrele curente.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
});

function sqm(value: number | null) {
  return value == null ? null : `${value} mp`;
}

function price(location: LocationSelectionLocationDTO) {
  if (location.suggestedBasePrice == null) return "-";
  return `${location.suggestedBasePrice.toLocaleString("ro-RO")} ${location.currency || "EUR"}`;
}

function rateCardLabel(location: LocationSelectionLocationDTO) {
  const value = location.rateCard?.trim();
  if (!value || /^[\d\s.,]+$/.test(value)) return null;
  return value;
}

function blockingText(availability: LocationSelectionAvailability) {
  const first = availability.blockingIntervals[0];
  if (!first) return "";
  return `${blockingStatusLabel(first.status)}: ${formatDate(first.start)}${first.openEnded ? "" : ` - ${formatDate(first.end)}`}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function blockingStatusLabel(status: string) {
  if (status === "COMMERCIAL_BLOCK") return "Blocaj comercial";
  if (status === "MAINTENANCE") return "Mentenanta";
  if (status === "INTERNAL_HOLD") return "Hold intern";
  return status;
}
