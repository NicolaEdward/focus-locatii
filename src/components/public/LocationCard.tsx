"use client";

import { ArrowRight, Eye, MapPin, Plus, Ruler, Sparkles, Star } from "lucide-react";
import { memo } from "react";
import { monthlyRate, sqm } from "@/lib/format";
import type { LocationDTO } from "@/types/location";
import { StatusBadge } from "@/components/ui/StatusBadge";

function LocationCardComponent({
  location,
  onOpen,
  onShortlist,
  isShortlisted
}: {
  location: LocationDTO;
  onOpen: (location: LocationDTO) => void;
  onShortlist: (id: string) => void;
  isShortlisted: boolean;
}) {
  const showRateCard = Boolean(location.rateCard || location.rateCardValue);
  const title = location.address || location.code;
  const area = [location.city, location.county].filter(Boolean).join(", ") || "Romania";
  const image = location.mainPhotoUrl || location.images[0]?.url || "/samples/location-placeholder.svg";

  return (
    <article
      className="focus-card group flex min-w-0 flex-col overflow-hidden rounded-lg transition-transform duration-150 ease-out hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      data-location-id={location.id}
    >
      <button type="button" className="relative block aspect-[4/3] w-full overflow-hidden bg-focus-ink text-left" onClick={() => onOpen(location)}>
        <img
          src={image}
          alt={location.code}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          onError={(event) => {
            event.currentTarget.src = "/samples/location-placeholder.svg";
          }}
        />
        <span className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-focus-ink/95 via-focus-ink/30 to-transparent" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          <span className="rounded-md border border-focus-yellow bg-focus-navy/92 px-3 py-2 font-display text-lg font-black uppercase text-white shadow-focus">
            {location.code}
          </span>
          <span className="rounded-md border border-white/25 bg-focus-navy/82 px-3 py-2 text-xs font-black uppercase text-white">
            {location.categoryName}
          </span>
        </div>
        {location.isPremium ? (
          <span className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-md bg-focus-yellow px-3 py-2 text-xs font-black uppercase text-focus-navy">
            <Star size={14} />
            Premium
          </span>
        ) : null}
        <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-2">
          <StatusBadge
            status={location.status}
            availability={location.availabilityText}
            publicStatus={location.publicStatus}
            label={location.availabilityLabel}
          />
          {location.availabilityDetail ? (
            <span className="rounded-full border border-white/20 bg-focus-navy/80 px-3 py-1 text-xs font-bold text-slate-100">
              {location.availabilityDetail}
            </span>
          ) : null}
        </div>
      </button>

      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-black uppercase text-focus-yellow">
            <MapPin size={14} />
            {area}
          </p>
          <h3 className="mt-2 line-clamp-2 font-display text-2xl font-black uppercase leading-none text-white">
            {title}
          </h3>
          <p className="mt-2 line-clamp-2 text-sm font-bold leading-6 text-slate-300">
            {location.type || "OOH"} pentru campanii cu vizibilitate in zona {location.city || location.county || "selectata"}.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm text-slate-200">
          <Spec label="Dimensiune" value={location.size || "N/A"} />
          <Spec label="Suprafata" value={sqm(location.sqm)} />
          <Spec label="Tip media" value={location.type || "N/A"} />
          <Spec label="Zona" value={location.city || location.county || "Romania"} />
        </div>

        <div className="mt-auto grid gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-xs font-black uppercase text-slate-300">
              <Sparkles size={14} className="text-focus-yellow" />
              Selectie comerciala
            </span>
            <span className="text-xs font-bold text-slate-400">Cod {location.code}</span>
          </div>
          {showRateCard ? (
            <span className="rounded-md border border-focus-yellow/45 bg-focus-yellow/10 px-3 py-2 text-sm font-black uppercase text-focus-yellow">
              Rate card public: {monthlyRate(location.rateCardValue, location.rateCard)}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="focus-button secondary" onClick={() => onOpen(location)}>
            <Eye size={18} />
            Prezentare
          </button>
          <button type="button" className="focus-button" onClick={() => onShortlist(location.id)}>
            {isShortlisted ? <Star size={18} /> : <Plus size={18} />}
            {isShortlisted ? "In media plan" : "Adauga in media plan"}
          </button>
        </div>
        {isShortlisted ? (
          <p className="flex items-center gap-2 text-xs font-black uppercase text-focus-yellow">
            <ArrowRight size={14} />
            Locatie inclusa in selectia curenta.
          </p>
        ) : null}
      </div>
    </article>
  );
}

export const LocationCard = memo(LocationCardComponent);

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-white/10 bg-white/[0.03] p-2">
      <span className="flex items-center gap-1 text-[10px] font-black uppercase text-focus-yellow">
        <Ruler size={12} />
        {label}
      </span>
      <span className="mt-1 block font-bold text-white">{value}</span>
    </span>
  );
}
