"use client";

import { motion } from "framer-motion";
import {
  CalendarDays,
  CheckCircle2,
  Eye,
  Megaphone,
  MapPin,
  Star,
  Target,
  Users
} from "lucide-react";
import { monthlyRate, oneTimeRate, sqm } from "@/lib/format";
import { mapsHref } from "@/lib/gps";
import type { LocationDTO } from "@/types/location";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ContactButtons } from "@/components/public/ContactButtons";

export function LocationPresentation({
  location,
  onShortlist,
  isShortlisted = false
}: {
  location: LocationDTO;
  onShortlist?: () => void;
  isShortlisted?: boolean;
}) {
  const images = imageSet(location);
  const mapsUrl = mapsHref(location.mapsUrl, location.latDisplay, location.lngDisplay);
  const showRateCard = location.showPricePublic && Boolean(location.rateCard || location.rateCardValue);
  const showInstallationCost = location.showInstallationCostPublic && Boolean(location.installationRemoval || location.installationRemovalValue);
  const message = `Buna ziua, sunt interesat de locatia ${location.address || location.code} (${location.code}) - ${location.categoryName}.`;
  const subject = `Cerere locatie ${location.code}`;

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="print-surface overflow-hidden rounded-lg bg-focus-navy text-white shadow-focus"
    >
      <div className="grid gap-8 p-5 md:p-8 xl:grid-cols-[1.15fr_0.85fr]">
        <section>
          <p className="font-display text-3xl font-black uppercase leading-none text-white md:text-5xl">
            {location.categoryName}
          </p>
          <p className="mt-2 font-display text-xl font-black uppercase text-focus-yellow md:text-3xl">
            {location.address || location.city || "Premium outdoor location"}
          </p>
          <h1 className="mt-3 font-display text-4xl font-black uppercase leading-none text-white md:text-6xl">
            Vizibilitate maxima. <span className="text-focus-yellow">Impact garantat.</span>
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-100 md:text-lg">
            Locatie Focus Media cu expunere puternica, context comercial clar si datele necesare pentru
            planificarea rapida a unei campanii OOH.
          </p>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-4">
          <BenefitIcon icon={<Eye />} label="Vizibilitate ridicata" />
          <BenefitIcon icon={<Users />} label="Trafic constant" />
          <BenefitIcon icon={<MapPin />} label="Pozitie premium" />
          <BenefitIcon icon={<Target />} label="Impact de brand" />
        </section>
      </div>

      <div className="grid gap-4 px-5 md:px-8 xl:grid-cols-[1.35fr_0.85fr]">
        <div className="relative overflow-hidden rounded-lg border border-white/60">
          <img
            src={images[0]}
            alt={location.code}
            decoding="async"
            className="h-full min-h-[360px] w-full object-cover"
            onError={(event) => {
              event.currentTarget.src = "/samples/location-placeholder.svg";
            }}
          />
          <div className="absolute left-1/2 top-4 w-[min(620px,86%)] -translate-x-1/2 rounded-2xl bg-white/92 px-5 py-3 text-center text-focus-navy shadow-xl">
            <p className="font-display text-2xl font-black uppercase">Disponibilitate campanie</p>
            <p className="font-bold uppercase">
              {location.availabilityLabel} {location.availabilityDetail ? `| ${location.availabilityDetail}` : ""} | Dimensiune - {location.size || "N/A"} | Suprafata - {sqm(location.sqm)} | Tip media - {location.type || "OOH"}
            </p>
          </div>
          <div className="absolute bottom-5 left-5 grid gap-3">
            <InfoPill icon={<MapPin size={24} />} text={location.city || "Romania"} />
            <InfoPill icon={<Megaphone size={24} />} text={location.type || "Outdoor"} />
            <InfoPill icon={<Star size={24} />} text={`Code: ${location.code}`} />
          </div>
        </div>

        <div className="grid gap-4">
          {images.slice(1, 4).map((image, index) => (
            <img
              key={`${image}-${index}`}
              src={image}
              alt={`${location.code} view ${index + 2}`}
              loading="lazy"
              decoding="async"
              className="h-[180px] w-full rounded-lg border border-white/60 object-cover"
              onError={(event) => {
                event.currentTarget.src = "/samples/location-placeholder.svg";
              }}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-4 p-5 md:p-8 xl:grid-cols-[1fr_1fr_1.15fr]">
        <DetailPanel icon={<MapPin />} title="Avantaje locatie" items={location.benefits} />
        <DetailPanel icon={<CheckCircle2 />} title="Detalii media" items={location.mediaDetails} />
        <div className="grid content-center gap-4 border-t border-focus-line pt-5 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
          <div className="flex items-center gap-4">
            <span className="grid h-20 w-20 place-items-center rounded-full bg-focus-yellow text-focus-navy">
              <Megaphone size={42} />
            </span>
            <div>
              <p className="font-display text-3xl font-black uppercase">Be seen. Be first. Be remembered.</p>
              <p className="font-black uppercase text-focus-yellow">O locatie clara pentru campanii cu vizibilitate puternica.</p>
            </div>
          </div>
          <div className="grid gap-3">
            <ContactButtons message={message} subject={subject} />
            <a className="focus-button secondary" href={mapsUrl} target="_blank" rel="noreferrer">
              <MapPin size={20} />
              Deschide in Maps
            </a>
            {onShortlist ? (
              <button className="focus-button secondary" type="button" onClick={onShortlist}>
                <Star size={20} />
                {isShortlisted ? "In media plan" : "Adauga in media plan"}
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-lg">
            <StatusBadge
              status={location.status}
              availability={location.availabilityText}
              publicStatus={location.publicStatus}
              label={location.availabilityLabel}
            />
            {location.availabilityDetail ? <span className="font-bold text-slate-100">{location.availabilityDetail}</span> : null}
            {showRateCard ? (
              <span className="font-bold text-focus-yellow">
                Rate card: {monthlyRate(location.rateCardValue, location.rateCard)}
              </span>
            ) : null}
            {showInstallationCost ? (
              <span className="font-bold text-slate-100">
                Montare/neutralizare: {oneTimeRate(location.installationRemovalValue, location.installationRemoval)}
              </span>
            ) : null}
          </div>
          <DetailPanel icon={<CalendarDays />} title="Detalii campanie" items={location.campaignDetails} compact />
        </div>
      </div>
    </motion.article>
  );
}

function BenefitIcon({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="grid place-items-center border-r border-focus-line px-3 text-center last:border-r-0">
      <span className="text-focus-yellow [&>svg]:h-12 [&>svg]:w-12">{icon}</span>
      <span className="mt-2 font-display text-xl font-black uppercase leading-tight">{label}</span>
    </div>
  );
}

function InfoPill({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-3 rounded-lg border border-focus-yellow bg-focus-navy/90 px-4 py-3 font-display text-xl font-black uppercase text-white">
      <span className="text-focus-yellow">{icon}</span>
      {text}
    </span>
  );
}

function DetailPanel({
  icon,
  title,
  items,
  compact = false
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  compact?: boolean;
}) {
  return (
    <section className="focus-card rounded-lg p-5">
      <div className="flex gap-4">
        <span className="text-focus-yellow [&>svg]:h-12 [&>svg]:w-12">{icon}</span>
        <div>
          <h2 className="font-display text-2xl font-black uppercase text-focus-yellow">{title}</h2>
          <ul className={compact ? "mt-2 space-y-1" : "mt-4 space-y-2"}>
            {items.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-6 text-slate-100 md:text-base">
                <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-focus-yellow" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function imageSet(location: LocationDTO) {
  const images = [location.mainPhotoUrl, ...location.images.map((image) => image.url)].filter(Boolean) as string[];

  const unique = [...new Set(images)].slice(0, 4);
  return unique.length ? unique : ["/samples/location-placeholder.svg"];
}
