"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { CheckCircle2, Copy, LocateFixed, MapPinned, RotateCcw } from "lucide-react";
import type { LocationDTO } from "@/types/location";

const AdminGpsMap = dynamic(() => import("@/components/admin/AdminGpsMap").then((mod) => mod.AdminGpsMap), {
  ssr: false,
  loading: () => <div className="grid h-[520px] place-items-center rounded-lg border border-focus-line">Loading GPS map...</div>
});

export function GpsAuditDashboard({ initialLocations }: { initialLocations: LocationDTO[] }) {
  const [locations, setLocations] = useState(initialLocations);
  const [activeId, setActiveId] = useState<string | null>(initialLocations[0]?.id || null);
  const [filter, setFilter] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return locations.filter((location) => {
      if (!filter) return true;
      return location.gpsAuditStatus === filter;
    });
  }, [filter, locations]);

  async function patch(id: string, patch: Partial<LocationDTO>) {
    const response = await fetch(`/api/locations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
    const data = await response.json();
    if (response.ok) {
      setLocations((current) => current.map((location) => (location.id === id ? data.location : location)));
    }
  }

  async function runAudit() {
    const response = await fetch("/api/gps/audit", { method: "POST" });
    const data = await response.json();
    if (response.ok) {
      setMessage(`Audit complet: ${data.ok} OK, ${data.missing} missing, ${data.suspect} suspect.`);
      window.location.reload();
    }
  }

  async function spread() {
    const response = await fetch("/api/gps/spread-overlapping", { method: "POST" });
    const data = await response.json();
    if (response.ok) {
      setMessage(`Marker-ele au fost raspandite: ${data.updated} locatii procesate.`);
      window.location.reload();
    }
  }

  async function resetDisplay() {
    const confirmed = window.confirm(
      "Resetez toate marker-ele de pe harta la coordonatele reale salvate? Coordonatele reale nu vor fi schimbate."
    );
    if (!confirmed) return;

    const response = await fetch("/api/gps/reset-display", { method: "POST" });
    const data = await response.json();
    if (response.ok) {
      setMessage(`Reset display complet: ${data.updated} locatii actualizate, ${data.skipped} fara schimbari.`);
      window.location.reload();
    }
  }

  async function restoreFromMaps() {
    const confirmed = window.confirm(
      "Atentie: aceasta actiune rescrie coordonatele reale si marker-ele folosind linkurile Google Maps. Continui?"
    );
    if (!confirmed) return;

    const response = await fetch("/api/gps/restore-from-maps", { method: "POST" });
    const data = await response.json();
    if (response.ok) {
      setMessage(`Restaurare din Maps URL completa: ${data.updated} locatii actualizate, ${data.skipped} fara schimbari.`);
      window.location.reload();
    }
  }

  return (
    <main className="focus-shell py-8">
      <section className="focus-container grid gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">GPS audit</p>
            <h1 className="font-display text-4xl font-black uppercase">Coordonate locatii</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="focus-button" type="button" onClick={runAudit}>
              <CheckCircle2 size={18} />
              Run audit
            </button>
            <button className="focus-button secondary" type="button" onClick={spread}>
              <LocateFixed size={18} />
              Auto spread overlapping markers
            </button>
            <button className="focus-button secondary" type="button" onClick={resetDisplay}>
              <RotateCcw size={18} />
              Reset toate display
            </button>
            <button className="focus-button secondary" type="button" onClick={restoreFromMaps}>
              <MapPinned size={18} />
              Restore toate din Maps URL
            </button>
          </div>
        </div>

        {message ? <p className="focus-card rounded-lg p-3 text-focus-yellow">{message}</p> : null}

        <div className="grid gap-5 xl:grid-cols-[1fr_520px]">
          <AdminGpsMap
            locations={filtered}
            activeId={activeId}
            onMove={(id, lat, lng) => patch(id, { latDisplay: lat, lngDisplay: lng })}
          />

          <aside className="focus-card grid max-h-[520px] gap-3 overflow-auto rounded-lg p-4">
            <select aria-label="Filtreaza locatiile dupa statusul GPS" className="focus-input" value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="">Toate statusurile GPS</option>
              <option value="OK">OK</option>
              <option value="CORRECTED">CORRECTED</option>
              <option value="MISSING">MISSING</option>
              <option value="NEEDS_CONFIRMATION">NEEDS_CONFIRMATION</option>
              <option value="SUSPECT">SUSPECT</option>
            </select>

            {filtered.map((location) => (
              <article
                key={location.id}
                className="rounded-lg border border-focus-line p-3"
                onClick={() => setActiveId(location.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-white">{location.code}</p>
                    <p className="text-sm text-slate-300">{location.address || location.categoryName}</p>
                    <p className="mt-1 text-xs font-black uppercase text-focus-yellow">{location.gpsAuditStatus}</p>
                  </div>
                  <span className="text-xs text-slate-400">{location.city || "N/A"}</span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <CoordInput
                    label="latDisplay"
                    value={location.latDisplay}
                    onChange={(value) => patch(location.id, { latDisplay: value })}
                  />
                  <CoordInput
                    label="lngDisplay"
                    value={location.lngDisplay}
                    onChange={(value) => patch(location.id, { lngDisplay: value })}
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="focus-button secondary"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      patch(location.id, {
                        latReal: location.latDisplay,
                        lngReal: location.lngDisplay,
                        gpsAuditStatus: "CORRECTED"
                      });
                    }}
                  >
                    <Copy size={16} />
                    Copy display to real
                  </button>
                  <button
                    className="focus-button secondary"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      patch(location.id, {
                        latDisplay: location.latReal,
                        lngDisplay: location.lngReal
                      });
                    }}
                  >
                    <RotateCcw size={16} />
                    Reset display
                  </button>
                </div>
              </article>
            ))}
          </aside>
        </div>
      </section>
    </main>
  );
}

function CoordInput({
  label,
  value,
  onChange
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-bold text-slate-300">{label}</span>
      <input
        className="focus-input"
        type="number"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
      />
    </label>
  );
}
