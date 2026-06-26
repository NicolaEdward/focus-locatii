"use client";

import { motion } from "framer-motion";
import { Eye, MapPin, Plus, Ruler, Star } from "lucide-react";
import { monthlyRate, sqm } from "@/lib/format";
import type { LocationDTO } from "@/types/location";
import { StatusBadge } from "@/components/ui/StatusBadge";

export function LocationCard({
  location,
  onOpen,
  onShortlist,
  isShortlisted
}: {
  location: LocationDTO;
  onOpen: () => void;
  onShortlist: () => void;
  isShortlisted: boolean;
}) {
  const showRateCard = location.showPricePublic && Boolean(location.rateCard || location.rateCardValue);

  return (
    <motion.article
      layout
      whileHover={{ y: -4 }}
      className="focus-card overflow-hidden rounded-lg"
      data-location-id={location.id}
    >
      <button type="button" className="relative block w-full overflow-hidden text-left" onClick={onOpen}>
        <img
          src={location.mainPhotoUrl || "/samples/location-placeholder.svg"}
          alt={location.code}
          loading="lazy"
          decoding="async"
          className="h-56 w-full object-cover transition duration-500 hover:scale-[1.03]"
          onError={(event) => {
            event.currentTarget.src = "/samples/location-placeholder.svg";
          }}
        />
        <span className="absolute left-3 top-3 rounded-md border border-focus-yellow bg-focus-navy/92 px-3 py-2 font-display text-lg font-black uppercase text-white shadow-focus">
          {location.code}
        </span>
        {location.isPremium ? (
          <span className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-md bg-focus-yellow px-3 py-2 text-xs font-black uppercase text-focus-navy">
            <Star size={14} />
            Premium
          </span>
        ) : null}
      </button>
      <div className="grid gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">{location.categoryName}</p>
            <h3 className="mt-1 line-clamp-2 font-display text-2xl font-black uppercase leading-none text-white">
              {location.address || location.code}
            </h3>
            <p className="mt-2 flex items-center gap-2 text-sm text-slate-300">
              <MapPin size={16} /> {location.city || "Romania"} {location.county ? `, ${location.county}` : ""}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm text-slate-200">
          <Spec label="Dimensiune" value={location.size || "N/A"} />
          <Spec label="Suprafata" value={sqm(location.sqm)} />
          <Spec label="Tip media" value={location.type || "N/A"} />
          <Spec label="Zona" value={location.city || location.county || "Romania"} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            status={location.status}
            availability={location.availabilityText}
            publicStatus={location.publicStatus}
            label={location.availabilityLabel}
          />
          {location.availabilityDetail ? <span className="text-xs font-bold text-slate-300">{location.availabilityDetail}</span> : null}
          {showRateCard ? (
            <span className="rounded-full border border-focus-line px-3 py-1 text-xs font-black uppercase text-focus-yellow">
              Rate card: {monthlyRate(location.rateCardValue, location.rateCard)}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="focus-button secondary" onClick={onOpen}>
            <Eye size={18} />
            Prezentare
          </button>
          <button type="button" className="focus-button" onClick={onShortlist}>
            <Plus size={18} />
            {isShortlisted ? "In media plan" : "Adauga in plan"}
          </button>
        </div>
      </div>
    </motion.article>
  );
}

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
