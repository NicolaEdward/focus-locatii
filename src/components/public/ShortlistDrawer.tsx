"use client";

import { motion } from "framer-motion";
import { CalendarDays, FileSpreadsheet, Lock, Printer, Send, ShoppingBag, Sparkles, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { monthlyRate, sqm } from "@/lib/format";
import { downloadMediaPlanExcel } from "@/lib/media-plan-download";
import { mediaPlanMessage, selectedSqm } from "@/lib/media-plan";
import { ContactButtons } from "@/components/public/ContactButtons";
import type { LocationDTO } from "@/types/location";

export function ShortlistDrawer({
  locations,
  open,
  onClose,
  onRemove
}: {
  locations: LocationDTO[];
  open: boolean;
  onClose: () => void;
  onRemove: (id: string) => void;
}) {
  const totalSqm = selectedSqm(locations);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [offerName, setOfferName] = useState("");
  const [offerCompany, setOfferCompany] = useState("");
  const [offerEmail, setOfferEmail] = useState("");
  const [offerPhone, setOfferPhone] = useState("");
  const [offerMessage, setOfferMessage] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [sendingOffer, setSendingOffer] = useState(false);
  const [offerFeedback, setOfferFeedback] = useState<string | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);
  const publicRateLocations = locations.filter((location) => location.rateCard || location.rateCardValue);
  const totalRate = publicRateLocations.reduce((sum, location) => sum + (location.rateCardValue || 0), 0);
  const showPublicRates = publicRateLocations.length > 0;
  const periodSummary = useMemo(() => {
    if (!periodStart && !periodEnd) return "";
    if (periodStart && periodEnd) return `Perioada dorita: ${periodStart} - ${periodEnd}`;
    return `Perioada dorita: ${periodStart || periodEnd}`;
  }, [periodEnd, periodStart]);
  const message = [mediaPlanMessage(locations), periodSummary].filter(Boolean).join("\n\n");
  const subject = "Cerere media plan Focus Media";

  if (!open) return null;

  async function exportExcel() {
    if (!locations.length || exporting) return;

    setExporting(true);
    setExportError(null);
    try {
      await downloadMediaPlanExcel(locations.map((location) => location.id));
    } catch {
      setExportError("Exportul nu a pornit. Te rugam sa incerci din nou.");
    } finally {
      setExporting(false);
    }
  }

  async function submitOfferRequest() {
    if (!locations.length || sendingOffer) return;

    setSendingOffer(true);
    setOfferError(null);
    setOfferFeedback(null);
    try {
      const response = await fetch("/api/offer-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientName: offerName,
          company: offerCompany,
          email: offerEmail,
          phone: offerPhone,
          message: [offerMessage, periodSummary].filter(Boolean).join("\n\n"),
          selectedLocationIds: locations.map((location) => location.id),
          source: "portal-client"
        })
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Solicitarea nu a putut fi trimisa.");
      }

      setOfferFeedback("Cererea a fost trimisa. Echipa Focus Media o vede in admin.");
      setOfferName("");
      setOfferCompany("");
      setOfferEmail("");
      setOfferPhone("");
      setOfferMessage("");
    } catch (error) {
      setOfferError(error instanceof Error ? error.message : "Solicitarea nu a putut fi trimisa.");
    } finally {
      setSendingOffer(false);
    }
  }

  return (
    <motion.aside
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 240, damping: 28 }}
      className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-2xl min-w-0 flex-col overflow-hidden border-l border-focus-line bg-focus-navy shadow-focus"
      role="dialog"
      aria-modal="true"
      aria-label="Media plan selectat"
    >
      <header className="flex items-center justify-between gap-3 border-b border-focus-line p-5">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase text-focus-yellow">Media plan client</p>
          <h2 className="font-display text-3xl font-black uppercase leading-none text-white">Selectia ta</h2>
          <p className="mt-1 text-sm font-bold text-slate-300">Locatii salvate pentru oferta si export.</p>
        </div>
        <button className="focus-button secondary shrink-0" type="button" onClick={onClose} aria-label="Inchide media plan">
          <X size={18} />
        </button>
      </header>

      <section className="grid gap-3 border-b border-focus-line p-5">
        <div className={showPublicRates ? "grid grid-cols-3 gap-3" : "grid grid-cols-2 gap-3"}>
          <Stat label="Locatii" value={locations.length.toString()} />
          <Stat label="Suprafata" value={sqm(totalSqm)} />
          {showPublicRates ? <Stat label="Rate public" value={totalRate ? monthlyRate(totalRate) : `${publicRateLocations.length} locatii`} /> : null}
        </div>

        <div className="grid gap-3 rounded-lg border border-focus-line bg-focus-ink/45 p-3">
          <div className="flex items-center gap-2 text-xs font-black uppercase text-focus-yellow">
            <CalendarDays size={16} />
            Perioada dorita
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="focus-input"
              type="date"
              aria-label="Data inceput campanie"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
            />
            <input
              className="focus-input"
              type="date"
              aria-label="Data final campanie"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
            />
          </div>
        </div>
      </section>

      <div className="flex-1 overflow-auto px-5 py-4">
        {locations.length ? (
          <div className="grid gap-3">
            {locations.map((location) => (
              <article key={location.id} className="focus-card grid min-w-0 grid-cols-[92px_1fr_auto] gap-3 rounded-lg p-3">
                <img
                  src={location.mainPhotoUrl || location.images[0]?.url || "/samples/location-placeholder.svg"}
                  alt={location.code}
                  loading="lazy"
                  decoding="async"
                  className="h-24 w-full rounded-md object-cover"
                  onError={(event) => {
                    event.currentTarget.src = "/samples/location-placeholder.svg";
                  }}
                />
                <div className="min-w-0">
                  <p className="font-display text-xl font-black uppercase leading-none text-white">{location.code}</p>
                  <p className="mt-1 line-clamp-2 text-sm font-bold text-slate-200">{location.address || location.city || location.categoryName}</p>
                  <p className="mt-2 text-xs font-black uppercase text-slate-400">
                    {[location.city, location.type, location.size, sqm(location.sqm)].filter(Boolean).join(" / ")}
                  </p>
                  {location.rateCard || location.rateCardValue ? (
                    <p className="mt-2 text-sm font-black text-focus-yellow">
                      {monthlyRate(location.rateCardValue, location.rateCard)}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs font-bold text-slate-400">Pret la cerere</p>
                  )}
                </div>
                <button
                  className="rounded-md p-2 text-slate-300 transition hover:bg-red-500/15 hover:text-red-100"
                  type="button"
                  onClick={() => onRemove(location.id)}
                  aria-label={`Elimina ${location.code} din media plan`}
                >
                  <Trash2 size={18} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="focus-card grid min-h-[260px] place-items-center rounded-lg p-8 text-center">
            <div>
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-lg bg-focus-yellow text-focus-navy">
                <ShoppingBag size={26} />
              </span>
              <h3 className="mt-4 font-display text-3xl font-black uppercase text-white">Media plan gol</h3>
              <p className="mt-2 text-sm font-bold leading-6 text-slate-300">
                Alege locatiile potrivite si le poti exporta intr-un Excel pregatit pentru planificare.
              </p>
            </div>
          </div>
        )}

        <section className="mt-4 grid gap-3 rounded-lg border border-focus-line bg-focus-ink/45 p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-focus-yellow text-focus-navy">
              <Send size={18} />
            </span>
            <div>
              <p className="text-xs font-black uppercase text-focus-yellow">Cere oferta pentru selectie</p>
              <p className="mt-1 text-sm font-bold text-slate-300">
                Trimite selectia catre Focus Media. Echipa verifica disponibilitatea finala inainte de oferta.
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="focus-input"
              aria-label="Nume"
              value={offerName}
              onChange={(event) => setOfferName(event.target.value)}
              placeholder="Nume"
            />
            <input
              className="focus-input"
              aria-label="Companie"
              value={offerCompany}
              onChange={(event) => setOfferCompany(event.target.value)}
              placeholder="Companie"
            />
            <input
              className="focus-input"
              aria-label="Email"
              value={offerEmail}
              onChange={(event) => setOfferEmail(event.target.value)}
              placeholder="Email"
            />
            <input
              className="focus-input"
              aria-label="Telefon"
              value={offerPhone}
              onChange={(event) => setOfferPhone(event.target.value)}
              placeholder="Telefon"
            />
            <textarea
              className="focus-input min-h-20 sm:col-span-2"
              aria-label="Mesaj optional"
              value={offerMessage}
              onChange={(event) => setOfferMessage(event.target.value)}
              placeholder="Mesaj optional"
            />
          </div>
          <button
            className="focus-button w-full"
            type="button"
            onClick={submitOfferRequest}
            disabled={!locations.length || sendingOffer}
          >
            <Send size={18} />
            {sendingOffer ? "Se trimite..." : "Trimite cerere"}
          </button>
          {offerFeedback ? <p className="text-sm font-bold text-emerald-200">{offerFeedback}</p> : null}
          {offerError ? <p className="text-sm font-bold text-red-200">{offerError}</p> : null}
        </section>
      </div>

      <footer className="grid gap-3 border-t border-focus-line p-5">
        <button className="focus-button" type="button" onClick={exportExcel} disabled={!locations.length || exporting}>
          <FileSpreadsheet size={20} />
          {exporting ? "Se exporta..." : "Exporta Excel media plan"}
        </button>
        {exportError ? <p className="text-sm font-bold text-red-200">{exportError}</p> : null}
        <button className="focus-button secondary" type="button" disabled>
          <Lock size={18} />
          Salveaza ca media plan - in curand
        </button>
        <ContactButtons message={message} subject={subject} className="grid gap-2" buttonClassName="focus-button secondary" />
        <button className="focus-button secondary" type="button" onClick={() => window.print()}>
          <Printer size={20} />
          Printeaza / salveaza PDF
        </button>
      </footer>
    </motion.aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="focus-card rounded-lg p-3">
      <p className="text-xs font-black uppercase text-focus-yellow">{label}</p>
      <p className="mt-1 flex items-center gap-2 font-display text-2xl font-black uppercase text-white">
        <Sparkles size={18} /> {value}
      </p>
    </div>
  );
}
