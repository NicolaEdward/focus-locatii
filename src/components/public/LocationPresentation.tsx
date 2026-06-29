"use client";

import { motion } from "framer-motion";
import {
  CalendarDays,
  CheckCircle2,
  Image as ImageIcon,
  Layers,
  MapPin,
  Maximize2,
  Megaphone,
  Navigation,
  Ruler,
  Star,
  Target
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
  const mapsUrl = mapsHref(null, location.latDisplay, location.lngDisplay);
  const hasMap = mapsUrl !== "#";
  const showRateCard = Boolean(location.rateCard || location.rateCardValue);
  const showInstallationCost = Boolean(location.installationRemoval || location.installationRemovalValue);
  const area = [location.city, location.county].filter(Boolean).join(", ") || "Romania";
  const title = location.address || location.code;
  const message = `Buna ziua, sunt interesat de locatia ${title} (${location.code}) - ${location.categoryName}.`;
  const subject = `Cerere locatie ${location.code}`;

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="print-surface overflow-hidden rounded-lg bg-focus-navy text-white shadow-focus"
    >
      <section className="grid gap-0 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
        <div className="relative min-h-[420px] overflow-hidden bg-focus-ink md:min-h-[620px]">
          <img
            src={images[0]}
            alt={location.code}
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
            onError={(event) => {
              event.currentTarget.src = "/samples/location-placeholder.svg";
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-focus-ink via-focus-ink/26 to-transparent" />
          <div className="absolute left-4 top-4 flex flex-wrap gap-2 md:left-6 md:top-6">
            <span className="rounded-md border border-focus-yellow bg-focus-navy/92 px-4 py-2 font-display text-2xl font-black uppercase text-white shadow-focus">
              {location.code}
            </span>
            {location.isPremium ? (
              <span className="inline-flex items-center gap-2 rounded-md bg-focus-yellow px-4 py-2 text-xs font-black uppercase text-focus-navy">
                <Star size={16} />
                Premium
              </span>
            ) : null}
          </div>
          <div className="absolute bottom-0 left-0 right-0 grid gap-4 p-5 md:p-8">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-focus-yellow">{location.categoryName}</p>
            <h1 className="max-w-4xl font-display text-4xl font-black uppercase leading-none text-white md:text-6xl">
              {title}
            </h1>
            <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-100 md:text-base">
              <MapPin size={18} className="text-focus-yellow" />
              {area}
              {location.type ? <span className="text-slate-400">/ {location.type}</span> : null}
            </p>
            <div className="flex flex-wrap items-center gap-2">
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
          </div>
        </div>

        <aside className="grid content-between gap-6 border-l border-focus-line bg-focus-ink/76 p-5 md:p-8">
          <div className="grid gap-5">
            <div>
              <p className="text-xs font-black uppercase text-focus-yellow">Prezentare comerciala</p>
              <h2 className="mt-2 font-display text-3xl font-black uppercase leading-none text-white md:text-4xl">
                OOH cu vizibilitate clara pentru campanii memorabile.
              </h2>
              <p className="mt-4 text-sm font-bold leading-7 text-slate-300">
                Selectie Focus Media pregatita pentru planificare rapida: imagini, specificatii, zona si disponibilitate publica intr-o singura prezentare.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <SpecCard icon={<Ruler />} label="Dimensiune" value={location.size || "N/A"} />
              <SpecCard icon={<Maximize2 />} label="Suprafata" value={sqm(location.sqm)} />
              <SpecCard icon={<Layers />} label="Tip media" value={location.type || "OOH"} />
              <SpecCard icon={<MapPin />} label="Zona" value={area} />
            </div>

            <div className="grid gap-2">
              {showRateCard ? (
                <InfoLine label="Rate card public" value={monthlyRate(location.rateCardValue, location.rateCard)} tone="yellow" />
              ) : (
                <InfoLine label="Pret" value="Oferta personalizata la cerere" />
              )}
              {showInstallationCost ? (
                <InfoLine label="Montaj / neutralizare" value={oneTimeRate(location.installationRemovalValue, location.installationRemoval)} />
              ) : null}
            </div>
          </div>

          <div className="grid gap-3">
            {onShortlist ? (
              <button className="focus-button" type="button" onClick={onShortlist}>
                <Star size={20} />
                {isShortlisted ? "In media plan" : "Adauga in media plan"}
              </button>
            ) : null}
            <ContactButtons
              message={message}
              subject={subject}
              emailLabel="Cere oferta"
              className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1"
              buttonClassName="focus-button secondary"
            />
          </div>
        </aside>
      </section>

      <section className="grid gap-4 p-5 md:p-8 xl:grid-cols-[1.05fr_0.95fr]">
        <Panel title="Galerie" icon={<ImageIcon />}>
          <div className="grid gap-3 sm:grid-cols-3">
            {images.slice(0, 4).map((image, index) => (
              <img
                key={`${image}-${index}`}
                src={image}
                alt={`${location.code} imagine ${index + 1}`}
                loading={index === 0 ? "eager" : "lazy"}
                decoding="async"
                className={index === 0 ? "h-72 w-full rounded-lg border border-focus-line object-cover sm:col-span-3" : "h-36 w-full rounded-lg border border-focus-line object-cover"}
                onError={(event) => {
                  event.currentTarget.src = "/samples/location-placeholder.svg";
                }}
              />
            ))}
          </div>
        </Panel>

        <Panel title="Harta / zona" icon={<Navigation />}>
          <div className="grid h-full gap-4">
            <div className="rounded-lg border border-focus-line bg-focus-ink/68 p-5">
              <p className="text-xs font-black uppercase text-focus-yellow">Zona publica</p>
              <h3 className="mt-2 font-display text-3xl font-black uppercase text-white">{area}</h3>
              <p className="mt-3 text-sm font-bold leading-7 text-slate-300">
                Pozitionarea foloseste coordonate publice/de afisare. Coordonatele reale interne nu sunt incluse in prezentarea publica.
              </p>
            </div>
            {hasMap ? (
              <a className="focus-button secondary" href={mapsUrl} target="_blank" rel="noreferrer">
                <MapPin size={20} />
                Deschide zona in Maps
              </a>
            ) : (
              <div className="rounded-lg border border-focus-line bg-focus-ink/60 p-4 text-sm font-bold text-slate-300">
                Harta exacta este disponibila la cerere pentru aceasta locatie.
              </div>
            )}
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 px-5 pb-5 md:px-8 md:pb-8 xl:grid-cols-3">
        <DetailPanel icon={<Target />} title="Avantaje comerciale" items={location.benefits} />
        <DetailPanel icon={<Megaphone />} title="Detalii media" items={location.mediaDetails} />
        <DetailPanel icon={<CalendarDays />} title="Planificare campanie" items={location.campaignDetails} />
      </section>

      <section className="border-t border-focus-line bg-focus-ink/65 p-5 md:p-8">
        <div className="grid gap-4 xl:grid-cols-[1fr_auto] xl:items-center">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Urmatorul pas</p>
            <h2 className="font-display text-3xl font-black uppercase text-white">Adauga locatia in selectie sau cere oferta.</h2>
            <p className="mt-2 text-sm font-bold text-slate-300">
              Echipa Focus Media poate verifica disponibilitatea finala si poate pregati oferta comerciala pentru perioada dorita.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[420px]">
            {onShortlist ? (
              <button className="focus-button" type="button" onClick={onShortlist}>
                <Star size={20} />
                {isShortlisted ? "In media plan" : "Adauga in media plan"}
              </button>
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
      </section>
    </motion.article>
  );
}

function SpecCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-focus-line bg-focus-navy/48 p-3">
      <span className="flex items-center gap-2 text-[10px] font-black uppercase text-focus-yellow [&>svg]:h-4 [&>svg]:w-4">
        {icon}
        {label}
      </span>
      <span className="mt-2 block text-sm font-black text-white">{value}</span>
    </div>
  );
}

function InfoLine({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "yellow" }) {
  return (
    <div className="rounded-lg border border-focus-line bg-focus-navy/48 p-3">
      <p className="text-[10px] font-black uppercase text-slate-400">{label}</p>
      <p className={tone === "yellow" ? "mt-1 font-black text-focus-yellow" : "mt-1 font-bold text-white"}>{value}</p>
    </div>
  );
}

function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-focus-line bg-focus-ink/50 p-4">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-focus-yellow text-focus-navy [&>svg]:h-5 [&>svg]:w-5">
          {icon}
        </span>
        <h2 className="font-display text-2xl font-black uppercase text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function DetailPanel({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  const safeItems = items.length ? items : ["Detalii disponibile la cerere."];
  return (
    <section className="rounded-lg border border-focus-line bg-focus-ink/50 p-5">
      <div className="flex gap-4">
        <span className="text-focus-yellow [&>svg]:h-10 [&>svg]:w-10">{icon}</span>
        <div>
          <h2 className="font-display text-2xl font-black uppercase text-focus-yellow">{title}</h2>
          <ul className="mt-4 space-y-2">
            {safeItems.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-6 text-slate-100">
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
