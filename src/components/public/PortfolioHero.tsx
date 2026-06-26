"use client";

import { motion } from "framer-motion";
import { ArrowRight, MapPinned, Send, Target } from "lucide-react";
import { ContactInlineLinks } from "@/components/public/ContactButtons";
import { GENERAL_CONTACT_MESSAGE } from "@/lib/contact";
import type { LocationDTO } from "@/types/location";

export function PortfolioHero({
  locations,
  onOpenShortlist
}: {
  locations: LocationDTO[];
  onOpenShortlist: () => void;
}) {
  const available = locations.filter((location) => location.publicStatus === "AVAILABLE").length;
  const rented = locations.filter((location) => location.publicStatus === "BOOKED").length;
  const contactSubject = "Cerere portofoliu Focus Media";

  return (
    <section className="relative isolate overflow-hidden border-b border-focus-line bg-focus-ink">
      <div className="absolute inset-0 -z-20 bg-[url('/graphics/location-network.svg')] bg-cover bg-center opacity-35" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(115deg,rgba(2,8,20,0.98)_0%,rgba(3,19,34,0.95)_48%,rgba(255,184,0,0.16)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-focus-ink to-transparent" />

      <div className="focus-container grid content-center gap-6 py-7 md:min-h-[560px] md:gap-8 md:py-10">
        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="max-w-4xl"
        >
          <div className="mb-5 inline-flex rounded-md bg-white p-1 shadow-focus md:mb-8">
            <img src="/brand/focus-logo.jpg" alt="Focus Media" className="h-12 w-auto object-contain md:h-16" />
          </div>
          <p className="font-display text-lg font-black uppercase tracking-normal text-focus-yellow md:text-2xl">
            Inventar disponibil pentru campanii OOH
          </p>
          <h1 className="mt-3 max-w-4xl font-display text-4xl font-black uppercase leading-[0.95] text-white md:text-7xl md:leading-[0.92]">
            Portofoliu Focus Media
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-100 md:mt-5 md:text-xl md:leading-8">
            Alege locatii dupa zona, format si disponibilitate. Fiecare pozitie include fotografie, harta
            si detalii relevante pentru o selectie rapida de campanie.
          </p>

          <div className="hero-actions mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3 md:mt-8">
            <a className="focus-button" href="#portfolio-map">
              <MapPinned size={20} />
              Vezi harta
              <ArrowRight size={20} />
            </a>
            <button className="focus-button secondary" type="button" onClick={onOpenShortlist}>
              <Target size={20} />
              Media plan
            </button>
            <ContactInlineLinks message={GENERAL_CONTACT_MESSAGE} subject={contactSubject} compact />
          </div>
        </motion.div>

        <div className="hidden gap-3 md:grid md:grid-cols-[1fr_1fr_1fr_auto]">
          <HeroStat label="Locatii" value={locations.length.toString()} />
          <HeroStat label="Disponibile" value={available.toString()} />
          <HeroStat label="Inchiriate" value={rented.toString()} />
          <a
            className="focus-card flex min-h-[84px] items-center justify-center gap-3 rounded-lg px-5 font-black uppercase text-focus-yellow"
            href="#portfolio-list"
          >
            <Send size={20} />
            Selectie client
          </a>
        </div>
      </div>
    </section>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="focus-card rounded-lg p-4">
      <p className="text-xs font-black uppercase text-focus-yellow">{label}</p>
      <p className="mt-1 font-display text-3xl font-black uppercase text-white">{value}</p>
    </div>
  );
}
