"use client";

import { ArrowRight, Mail, MapPinned, MessageCircle, Send, Sparkles, Target } from "lucide-react";
import { emailHref, GENERAL_CONTACT_MESSAGE, WHATSAPP_CONTACTS, whatsappHref } from "@/lib/contact";
import type { LocationDTO } from "@/types/location";

export function PortfolioHero({
  locations,
  selectedCount,
  onOpenShortlist
}: {
  locations: LocationDTO[];
  selectedCount: number;
  onOpenShortlist: () => void;
}) {
  const available = locations.filter((location) => location.publicStatus === "AVAILABLE").length;
  const rented = locations.filter((location) => location.publicStatus === "BOOKED").length;
  const contactSubject = "Cerere portofoliu Focus Media";
  const stats = [
    { label: "Locatii", value: locations.length.toString() },
    { label: "Disponibile", value: available.toString() },
    { label: "Inchiriate", value: rented.toString() },
    { label: "Selectie client", value: selectedCount.toString() }
  ];

  return (
    <section className="portfolio-hero-premium relative isolate overflow-hidden border-b border-focus-line bg-focus-ink">
      <div className="portfolio-hero-network absolute inset-0 -z-20" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-32 bg-gradient-to-t from-focus-ink to-transparent" />

      <div className="focus-container grid gap-7 py-7 md:py-10 lg:min-h-[560px] lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)] lg:items-center lg:gap-10">
        <div className="relative z-10 min-w-0">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-focus-yellow/40 bg-focus-yellow/10 px-3 py-1.5 text-xs font-black uppercase text-focus-yellow">
            <Sparkles size={15} />
            Inventar disponibil pentru campanii OOH
          </div>
          <h1 className="max-w-4xl font-display text-4xl font-black uppercase leading-[0.96] text-white sm:text-5xl md:text-7xl md:leading-[0.92]">
            Portofoliu Focus Media Outdoor
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-100 md:mt-5 md:text-xl md:leading-8">
            Locatii outdoor vizibile. Alege rapid panourile potrivite pentru campania ta.
          </p>

          <div className="hero-actions mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3 md:mt-7">
            <a className="focus-button" href="#portfolio-list">
              <MapPinned size={20} />
              Vezi locatiile
              <ArrowRight size={20} />
            </a>
            <button className="focus-button secondary" type="button" onClick={onOpenShortlist}>
              <Target size={20} />
              Selectie client
            </button>
          </div>

          <div className="portfolio-hero-contact no-print mt-3 flex flex-wrap items-center gap-2 text-xs font-black uppercase text-slate-300 md:mt-4">
            <span className="mr-1 text-focus-yellow/90">Contact rapid</span>
            <a className="portfolio-contact-pill" href={emailHref(contactSubject, GENERAL_CONTACT_MESSAGE)}>
              <Mail size={15} />
              Email
            </a>
            {WHATSAPP_CONTACTS.map((contact) => (
              <a
                key={contact.phone}
                className="portfolio-contact-pill"
                href={whatsappHref(contact.phone, GENERAL_CONTACT_MESSAGE)}
                target="_blank"
                rel="noreferrer"
                title={`${contact.label}: ${contact.display}`}
              >
                <MessageCircle size={15} />
                {contact.label}
              </a>
            ))}
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 md:mt-8">
            {stats.map((stat) => (
              <HeroStat key={stat.label} label={stat.label} value={stat.value} />
            ))}
          </div>
        </div>

        <div className="portfolio-hero-visual relative min-h-[280px] overflow-hidden rounded-lg border border-focus-yellow/35 bg-focus-navy/70 lg:min-h-[420px]">
          <div className="portfolio-hero-orbit" />
          <div className="portfolio-hero-mapdots" />
          <div className="absolute left-4 top-4 z-10 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3 py-1.5 text-[11px] font-black uppercase text-white">
            <span className="h-2 w-2 rounded-full bg-focus-yellow" />
            OOH network
          </div>
          <div className="portfolio-billboard" aria-hidden="true">
            <div className="portfolio-billboard-lights">
              <span />
              <span />
              <span />
            </div>
            <div className="portfolio-billboard-screen">
              <p>We put</p>
              <strong>brands</strong>
              <span>in focus</span>
            </div>
            <div className="portfolio-billboard-leg" />
          </div>
          <div className="portfolio-hero-mini-card">
            <p className="text-[10px] font-black uppercase text-focus-yellow">Portofoliu activ</p>
            <p className="mt-1 font-display text-3xl font-black uppercase text-white">{locations.length}</p>
            <p className="text-xs font-bold text-slate-300">locatii disponibile in catalog</p>
          </div>
          <div className="portfolio-road-lines" />
          <div className="portfolio-skyline" aria-hidden="true">
            <span className="h-14 w-7" />
            <span className="h-24 w-8" />
            <span className="h-16 w-6" />
            <span className="h-32 w-10" />
            <span className="h-20 w-7" />
            <span className="h-28 w-9" />
            <span className="h-12 w-8" />
          </div>
          <a className="portfolio-visual-link no-print" href={emailHref(contactSubject, GENERAL_CONTACT_MESSAGE)}>
            <Send size={16} />
            Cere oferta
          </a>
        </div>
      </div>
    </section>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="portfolio-hero-stat rounded-lg border border-focus-yellow/30 bg-white/[0.055] px-3 py-3">
      <p className="text-[10px] font-black uppercase text-focus-yellow">{label}</p>
      <p className="mt-1 font-display text-2xl font-black uppercase text-white md:text-3xl">{value}</p>
    </div>
  );
}
