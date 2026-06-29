"use client";

import { motion } from "framer-motion";
import { FileSpreadsheet, Lock, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { monthlyRate, sqm } from "@/lib/format";
import { downloadMediaPlanExcel } from "@/lib/media-plan-download";
import { selectedSqm } from "@/lib/media-plan";
import type { LocationDTO } from "@/types/location";

export function MediaPlanBar({
  locations,
  onOpen
}: {
  locations: LocationDTO[];
  onOpen: () => void;
}) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const publicRateLocations = locations.filter((location) => location.rateCard || location.rateCardValue);
  const totalRate = publicRateLocations.reduce((sum, location) => sum + (location.rateCardValue || 0), 0);

  if (!locations.length) return null;

  async function exportExcel() {
    if (exporting) return;

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-focus-yellow/40 bg-focus-ink/98 px-4 py-3 shadow-lg"
      role="region"
      aria-label="Selectie de locatii"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          className="flex min-w-0 items-center gap-3 text-left"
          onClick={onOpen}
          aria-label="Deschide selectia de locatii"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-focus-yellow text-focus-navy">
            <ShoppingBag size={21} />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-black uppercase text-focus-yellow">Selectia ta</span>
            <span className="block truncate font-display text-2xl font-black uppercase text-white">
              {locations.length} {locations.length === 1 ? "locatie selectata" : "locatii selectate"}
            </span>
            <span className="block text-sm font-bold text-slate-300">
              Total suprafata: {sqm(selectedSqm(locations))}
              {publicRateLocations.length ? ` / rate publice: ${totalRate ? monthlyRate(totalRate) : `${publicRateLocations.length} locatii`}` : ""}
            </span>
          </span>
        </button>

        <div className="grid gap-2 sm:grid-cols-3">
          <button type="button" className="focus-button secondary" onClick={onOpen}>
            Vezi selectia
          </button>
          <button type="button" className="focus-button secondary" disabled>
            <Lock size={18} />
            Media Plan intern
          </button>
          <button type="button" className="focus-button" onClick={exportExcel} disabled={exporting}>
            <FileSpreadsheet size={20} />
            {exporting ? "Se exporta..." : "Export Excel"}
          </button>
        </div>
        {exportError ? <p className="text-sm font-bold text-red-200 sm:text-right">{exportError}</p> : null}
      </div>
    </motion.div>
  );
}
