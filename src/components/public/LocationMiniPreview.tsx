"use client";

import { motion } from "framer-motion";
import { ExternalLink, MapPin, Presentation, Star, X } from "lucide-react";
import { useEffect } from "react";
import { monthlyRate, oneTimeRate, sqm } from "@/lib/format";
import { mapsHref } from "@/lib/gps";
import type { LocationDTO } from "@/types/location";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ContactButtons } from "@/components/public/ContactButtons";

export function LocationMiniPreview({
  location,
  isShortlisted,
  onClose,
  onShortlist,
  onOpenPresentation
}: {
  location: LocationDTO;
  isShortlisted: boolean;
  onClose: () => void;
  onShortlist: () => void;
  onOpenPresentation: () => void;
}) {
  const image = location.mainPhotoUrl || location.images[0]?.url || "/samples/location-placeholder.svg";
  const mapsUrl = mapsHref(null, location.latDisplay, location.lngDisplay);
  const hasMap = mapsUrl !== "#";
  const showRateCard = Boolean(location.rateCard || location.rateCardValue);
  const showInstallationCost = Boolean(location.installationRemoval || location.installationRemovalValue);
  const area = [location.city, location.county].filter(Boolean).join(", ") || "Romania";
  const subject = `Cerere locatie ${location.code}`;
  const message = `Buna ziua, sunt interesat de locatia ${location.address || location.code} (${location.code}) - ${location.categoryName}.`;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isEscapeKey(event)) return;
      event.preventDefault();
      onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-black/72 p-4 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label="Prezentare rapida locatie"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.article
        className="focus-card relative grid w-full max-w-5xl overflow-hidden rounded-lg md:grid-cols-[0.82fr_1.18fr]"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.24 }}
      >
        <button
          className="focus-button secondary absolute right-4 top-4 z-10 !min-h-0 px-3 py-2"
          type="button"
          onClick={onClose}
          aria-label="Inchide mini prezentarea"
        >
          <X size={18} />
        </button>

        <div className="relative min-h-[260px] bg-focus-ink md:min-h-[420px]">
          <img
            src={image}
            alt={location.code}
            decoding="async"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            onError={(event) => {
              event.currentTarget.src = "/samples/location-placeholder.svg";
            }}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-focus-ink/86 via-focus-ink/28 to-transparent" />
          <span className="absolute left-4 top-4 rounded-md border border-focus-yellow bg-focus-navy/92 px-3 py-2 font-display text-xl font-black uppercase text-white">
            {location.code}
          </span>
          {location.isPremium ? (
            <span className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-md bg-focus-yellow px-3 py-2 text-xs font-black uppercase text-focus-navy">
              <Star size={14} />
              Premium
            </span>
          ) : null}
        </div>

        <div className="grid content-between gap-5 p-5 md:p-7">
          <div className="grid gap-4">
            <div>
              <p className="text-xs font-black uppercase text-focus-yellow">Prezentare rapida / {location.categoryName}</p>
              <h2 className="mt-2 font-display text-4xl font-black uppercase leading-none text-white">
                {location.address || location.code}
              </h2>
              <p className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-300">
                <MapPin size={16} />
                {area}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                status={location.status}
                availability={location.availabilityText}
                publicStatus={location.publicStatus}
                label={location.availabilityLabel}
              />
              {location.availabilityDetail ? <span className="text-sm font-bold text-slate-300">{location.availabilityDetail}</span> : null}
              {showRateCard ? (
                <span className="rounded-full border border-focus-line px-3 py-1 text-xs font-black uppercase text-focus-yellow">
                  Rate card: {monthlyRate(location.rateCardValue, location.rateCard)}
                </span>
              ) : (
                <span className="rounded-full border border-focus-line px-3 py-1 text-xs font-black uppercase text-slate-300">
                  Pret la cerere
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm text-slate-100">
              <MiniSpec label="Dimensiune" value={location.size || "N/A"} />
              <MiniSpec label="Suprafata" value={sqm(location.sqm)} />
              <MiniSpec label="Tip media" value={location.type || "N/A"} />
              {showInstallationCost ? (
                <MiniSpec label="Montare/neutralizare" value={oneTimeRate(location.installationRemovalValue, location.installationRemoval)} />
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button className="focus-button" type="button" onClick={onOpenPresentation}>
              <Presentation size={20} />
              Deschide prezentarea
            </button>
            <button className="focus-button secondary" type="button" onClick={onShortlist}>
              <Star size={20} />
              {isShortlisted ? "In media plan" : "Adauga in media plan"}
            </button>
            {hasMap ? (
              <a className="focus-button secondary sm:col-span-2" href={mapsUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={20} />
                Deschide zona in Google Maps
              </a>
            ) : null}
            <ContactButtons
              message={message}
              subject={subject}
              emailLabel="Cere oferta"
              className="grid gap-2 sm:col-span-2 sm:grid-cols-3"
              buttonClassName="focus-button secondary"
            />
          </div>
        </div>
      </motion.article>
    </motion.div>
  );
}

function isEscapeKey(event: KeyboardEvent) {
  return event.key === "Escape" || event.key === "Esc" || event.code === "Escape";
}

function MiniSpec({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-white/10 bg-white/[0.04] p-3">
      <span className="block text-[10px] font-black uppercase text-focus-yellow">{label}</span>
      <span className="mt-1 block font-bold text-white">{value}</span>
    </span>
  );
}
