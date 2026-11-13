"use client";

import { useState } from "react";
import { CheckCircle2, FileSpreadsheet, Search, Upload } from "lucide-react";
import type { ImportSummary } from "@/types/location";
import type { previewInventoryImport } from "@/lib/inventory-import";

type Preview = Awaited<ReturnType<typeof previewInventoryImport>>;
const fieldLabels: Record<string, string> = {
  code: "Cod", nr: "Număr", categoryName: "Categorie", city: "Oraș", county: "Județ", address: "Adresă", type: "Tip suport",
  size: "Dimensiune", sqm: "Suprafață", illum: "Iluminat", rateCard: "Tarif", rateCardValue: "Valoare tarif",
  installationRemoval: "Montaj și neutralizare", installationRemovalValue: "Valoare montaj", availabilityText: "Disponibilitate informativă",
  latReal: "Latitudine internă", lngReal: "Longitudine internă", latDisplay: "Latitudine afișată", lngDisplay: "Longitudine afișată",
  mapsUrl: "Link hartă", mainPhotoUrl: "Fotografie principală", photoOriginalUrl: "Sursă fotografie", showInPublic: "Vizibil în catalog",
  showPricePublic: "Tarif public", showInstallationCostPublic: "Montaj public", isPremium: "Premium", isFeatured: "Promovat",
  internalNotes: "Note interne", coordinateSource: "Sursă coordonate", gpsAuditStatus: "Verificare coordonate"
};

export function ImportExcelPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [publishNew, setPublishNew] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetPreview() { setPreview(null); setSummary(null); setAcknowledged(false); setError(null); }

  async function upload(action: "preview" | "confirm") {
    if (!file || (action === "confirm" && (!preview || !acknowledged))) return;
    setLoading(true); setError(null);
    try {
      const form = new FormData();
      form.append("file", file); form.append("action", action); form.append("publishNewLocations", String(publishNew));
      if (action === "confirm" && preview) form.append("previewToken", preview.previewToken);
      const response = await fetch("/api/import/excel", { method: "POST", body: form });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 409) { setPreview(null); setAcknowledged(false); }
        throw new Error(data?.error || "Fișierul nu a putut fi procesat.");
      }
      if (action === "preview") { setPreview(data.preview); setAcknowledged(false); setSummary(null); }
      else { setSummary(data.summary); setPreview(null); setAcknowledged(false); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Importul nu a putut fi procesat. Reîncearcă verificarea."); }
    finally { setLoading(false); }
  }

  async function recoverResult() {
    if (!preview) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/import/batches/${encodeURIComponent(preview.intentId)}`, { cache: "no-store" });
      const data = await response.json();
      if (data.status === "completed" && data.summary) { setSummary(data.summary); setPreview(null); setError(null); }
      else setError("Nu există încă un rezultat final confirmat. Poți reîncerca aceeași confirmare; nu genera un lot nou pentru aceeași încercare.");
    } catch { setError("Rezultatul nu a putut fi verificat. Reîncearcă verificarea fără un import nou."); }
    finally { setLoading(false); }
  }

  return (
    <section className="focus-card grid min-w-0 gap-5 rounded-lg p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-focus-yellow text-focus-navy"><FileSpreadsheet size={24} /></span>
        <div><p className="text-xs font-black uppercase text-focus-yellow">Inventar</p><h1 className="font-display text-3xl font-black uppercase sm:text-4xl">Import locații</h1></div>
      </div>
      <p className="text-sm text-slate-300">Verifică diferențele, apoi confirmă. Locațiile existente își păstrează setările de publicare, coordonatele corectate și notele. Maximum 250 de locații per lot; dacă apare o eroare, lotul nu se aplică parțial.</p>
      <label className="grid gap-2"><span className="text-sm font-bold">Fișier Excel</span>
        <input className="focus-input" type="file" accept=".xlsx,.xls" disabled={loading} onChange={(event) => { setFile(event.target.files?.[0] || null); resetPreview(); }} />
      </label>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={publishNew} disabled={loading} onChange={(event) => { setPublishNew(event.target.checked); resetPreview(); }} className="mt-1" />
        <span>Publică locațiile noi în catalog după import. Tarifele și costurile de montaj rămân private până la o editare explicită. Dacă nu bifezi, locațiile noi rămân ascunse.</span>
      </label>
      <button className="focus-button w-fit" type="button" onClick={() => upload("preview")} disabled={!file || loading}><Search size={18} />{loading ? "Se verifică..." : "Verifică fișierul"}</button>
      {error ? <p role="alert" className="rounded-lg border border-red-400/50 bg-red-500/10 p-3 text-sm text-red-100">{error}</p> : null}
      {error && preview ? <button className="focus-button-secondary w-fit" type="button" disabled={loading} onClick={recoverResult}>Verifică rezultatul confirmării</button> : null}
      {preview ? <div className="grid min-w-0 gap-4">
        <div className="grid gap-3 sm:grid-cols-3"><Stat label="De verificat" value={preview.totalRows} /><Stat label="Locații noi" value={preview.createdCount} /><Stat label="Actualizări" value={preview.updatedCount} /></div>
        <div className="max-h-[28rem] min-w-0 overflow-y-auto rounded-lg border border-focus-line p-3" aria-label="Diferențele importului">
          {preview.rows.map((row) => <details key={row.code} className="border-b border-focus-line py-3 last:border-0">
            <summary className="cursor-pointer break-words font-bold">{row.code} · {row.action === "create" ? "Locație nouă" : "Actualizare"} · {row.changes.length} diferențe</summary>
            <ul className="mt-3 grid gap-2 text-sm">{row.changes.map((change) => <li key={change.field} className="min-w-0 break-words"><strong>{fieldLabels[change.field] || change.field}:</strong> {displayValue(change.before)} → {displayValue(change.after)}</li>)}</ul>
            {row.preservedFields.length ? <p className="mt-3 text-xs text-slate-300">Publicarea, GPS-ul și câmpurile administrate manual se păstrează.</p> : null}
          </details>)}
        </div>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={loading} className="mt-1" /><span>Am verificat diferențele și confirm aplicarea întregului lot.</span></label>
        <button className="focus-button w-fit" type="button" disabled={!acknowledged || loading} onClick={() => upload("confirm")}><Upload size={18} />{loading ? "Se aplică lotul..." : "Confirmă importul"}</button>
      </div> : null}
      {summary ? <div role="status" className="grid gap-3"><p className="flex items-center gap-2 font-bold"><CheckCircle2 size={18} />Lotul a fost aplicat integral.</p><div className="grid gap-3 sm:grid-cols-5"><Stat label="Total" value={summary.totalRows} /><Stat label="Create" value={summary.createdCount} /><Stat label="Actualizate" value={summary.updatedCount} /><Stat label="Fără GPS" value={summary.missingGpsCount} /><Stat label="De verificat" value={summary.suspectGpsCount} /></div></div> : null}
    </section>
  );
}

function displayValue(value: unknown) { if (value === null || value === undefined || value === "") return "necompletat"; if (typeof value === "boolean") return value ? "Da" : "Nu"; return typeof value === "object" ? JSON.stringify(value) : String(value); }
function Stat({ label, value }: { label: string; value: number }) { return <div className="min-w-0 rounded-lg border border-focus-line p-4"><p className="text-xs font-black uppercase text-focus-yellow">{label}</p><p className="font-display text-3xl font-black">{value}</p></div>; }
