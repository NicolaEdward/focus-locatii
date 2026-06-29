"use client";

import { memo } from "react";
import { AlertTriangle, Check, Plus, X } from "lucide-react";
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
          <p className="text-xs font-black uppercase text-focus-yellow">Rezultate</p>
          <h2 className="text-xl font-black text-white">{locations.length} locatii gasite</h2>
        </div>
        <p className="text-sm font-bold text-slate-300">Lista densa pentru selectie rapida</p>
      </header>
      <div className="max-h-[760px] overflow-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-focus-ink text-xs uppercase text-slate-300">
            <tr>
              <th className="px-3 py-3">Locatie</th>
              <th className="px-3 py-3">Zona</th>
              <th className="px-3 py-3">Format</th>
              <th className="px-3 py-3">Disponibilitate</th>
              <th className="px-3 py-3">Pret</th>
              <th className="px-3 py-3 text-right">Actiune</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-focus-line">
            {locations.map((location) => {
              const selected = selectedIds.has(location.id);
              const availability = availabilityById[location.id];
              return (
                <tr
                  key={location.id}
                  className={selected ? "bg-focus-yellow/8" : "hover:bg-white/[0.03]"}
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
                    {availability?.warnings.length ? <p className="mt-1 max-w-[260px] truncate text-xs text-amber-100">{availability.warnings[0]}</p> : null}
                  </td>
                  <td className="px-3 py-3">
                    <p className="font-black text-white">{price(location)}</p>
                    {location.rateCard ? <p className="text-xs text-slate-400">{location.rateCard}</p> : null}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {selected ? (
                      <button className="focus-button secondary !min-h-0 px-3 py-2 text-xs" type="button" onClick={() => onRemove(location.id)}>
                        <X size={15} />
                        Scoate
                      </button>
                    ) : (
                      <button className="focus-button !min-h-0 px-3 py-2 text-xs" type="button" onClick={() => onAdd(location)}>
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
                  Nu exista locatii pentru filtrele curente.
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
