"use client";

import { motion } from "framer-motion";
import { FileSpreadsheet, Printer, Send, ShoppingBag, Trash2, X } from "lucide-react";
import { useState } from "react";
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
  const [sendingOffer, setSendingOffer] = useState(false);
  const [offerFeedback, setOfferFeedback] = useState<string | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);
  const publicRateLocations = locations.filter((location) => location.showPricePublic && (location.rateCard || location.rateCardValue));
  const totalRate = publicRateLocations.reduce((sum, location) => sum + (location.rateCardValue || 0), 0);
  const showPublicRates = publicRateLocations.length > 0;
  const message = mediaPlanMessage(locations);
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
          message: offerMessage,
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
      className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-xl flex-col border-l border-focus-line bg-focus-navy shadow-focus"
    >
      <header className="flex items-center justify-between border-b border-focus-line p-5">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Media plan client</p>
          <h2 className="font-display text-3xl font-black uppercase">Selectia ta</h2>
        </div>
        <button className="focus-button secondary" type="button" onClick={onClose} aria-label="Inchide media plan">
          <X size={18} />
        </button>
      </header>

      <div className={showPublicRates ? "grid grid-cols-3 gap-3 p-5" : "grid grid-cols-2 gap-3 p-5"}>
        <Stat label="Locatii" value={locations.length.toString()} />
        <Stat label="Total SQM" value={sqm(totalSqm)} />
        {showPublicRates ? <Stat label="Rate public" value={totalRate ? monthlyRate(totalRate) : "N/A"} /> : null}
      </div>

      <div className="flex-1 overflow-auto px-5">
        {locations.length ? (
          <div className="grid gap-3">
            {locations.map((location) => (
              <article key={location.id} className="focus-card grid grid-cols-[92px_1fr_auto] gap-3 rounded-lg p-3">
                <img
                  src={location.mainPhotoUrl || "/samples/location-placeholder.svg"}
                  alt={location.code}
                  className="h-20 w-full rounded-md object-cover"
                  onError={(event) => {
                    event.currentTarget.src = "/samples/location-placeholder.svg";
                  }}
                />
                <div>
                  <p className="font-black text-white">{location.address || location.code}</p>
                  <p className="text-sm text-slate-300">
                    {location.code} | {location.categoryName} | {sqm(location.sqm)}
                  </p>
                  {location.showPricePublic && (location.rateCard || location.rateCardValue) ? (
                    <p className="text-sm font-bold text-focus-yellow">
                      Rate card: {monthlyRate(location.rateCardValue, location.rateCard)}
                    </p>
                  ) : null}
                </div>
                <button className="text-slate-300 hover:text-red-200" type="button" onClick={() => onRemove(location.id)}>
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
      </div>

      <footer className="grid gap-3 border-t border-focus-line p-5">
        <button className="focus-button" type="button" onClick={exportExcel} disabled={!locations.length || exporting}>
          <FileSpreadsheet size={20} />
          {exporting ? "Se exporta..." : "Exporta Excel media plan"}
        </button>
        {exportError ? <p className="text-sm font-bold text-red-200">{exportError}</p> : null}

        <div className="rounded-lg border border-focus-line bg-focus-ink/45 p-3">
          <p className="text-xs font-black uppercase text-focus-yellow">Solicitare oferta</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
            className="focus-button mt-3 w-full"
            type="button"
            onClick={submitOfferRequest}
            disabled={!locations.length || sendingOffer}
          >
            <Send size={18} />
            {sendingOffer ? "Se trimite..." : "Trimite cerere"}
          </button>
          {offerFeedback ? <p className="mt-2 text-sm font-bold text-emerald-200">{offerFeedback}</p> : null}
          {offerError ? <p className="mt-2 text-sm font-bold text-red-200">{offerError}</p> : null}
        </div>

        <ContactButtons message={message} subject={subject} className="grid gap-2" buttonClassName="focus-button" />
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
      <p className="mt-1 font-display text-2xl font-black uppercase">{value}</p>
    </div>
  );
}
