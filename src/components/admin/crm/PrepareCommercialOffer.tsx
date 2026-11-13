"use client";

import { ArrowRight, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type PrepareIntent = {
  action: "prepare";
  version: number;
  currency: "RON" | "EUR";
  companyEntity: string;
  idempotencyKey: string;
};

const fieldClass = "focus-input w-full";

export function PrepareCommercialOffer({ opportunity, sessionUserId, onReload }: {
  opportunity: { id: string; version: number; currency?: string | null };
  sessionUserId: string;
  onReload: () => void;
}) {
  const [currency, setCurrency] = useState(opportunity.currency === "RON" || opportunity.currency === "EUR" ? opportunity.currency : "");
  const [companyEntity, setCompanyEntity] = useState("");
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const intentRef = useRef<PrepareIntent | null>(null);
  const storageKey = `focus:prepare-commercial:${sessionUserId}:${opportunity.id}`;

  useEffect(() => {
    try {
      const text = window.sessionStorage.getItem(storageKey);
      if (text && text.length <= 2048) {
        const value = JSON.parse(text) as PrepareIntent;
        if (value.action === "prepare" && ["RON", "EUR"].includes(value.currency) && typeof value.companyEntity === "string" && typeof value.idempotencyKey === "string" && Number.isInteger(value.version)) {
          intentRef.current = value;
          setCurrency(value.currency);
          setCompanyEntity(value.companyEntity);
          setUncertain(true);
        }
      }
    } catch { /* Server-side idempotency and deduplication remain authoritative. */ }
    setReady(true);
  }, [storageKey]);

  async function prepare() {
    if (pending || !ready || !["RON", "EUR"].includes(currency) || !companyEntity) return;
    const intent = intentRef.current || {
      action: "prepare" as const,
      version: opportunity.version,
      currency: currency as "RON" | "EUR",
      companyEntity,
      idempotencyKey: crypto.randomUUID(),
    };
    intentRef.current = intent;
    try { window.sessionStorage.setItem(storageKey, JSON.stringify(intent)); } catch { /* Keep this intent in memory when browser storage is unavailable. */ }
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/admin/crm/opportunities/${encodeURIComponent(opportunity.id)}/handoff`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(intent) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status < 500) {
          intentRef.current = null;
          try { window.sessionStorage.removeItem(storageKey); } catch { /* No stored intent. */ }
          setUncertain(false);
        } else setUncertain(true);
        throw new Error(data.error || "Pregătirea nu a fost confirmată.");
      }
      const href = data.result?.href;
      // Follow only the application-owned destination returned by this command.
      if (typeof href !== "string" || !href.startsWith("/admin/commercial-quotes?") || href.includes("\\")) throw new Error("Dosarul a fost pregătit, dar destinația nu a putut fi verificată. Actualizează dosarul.");
      try { window.sessionStorage.removeItem(storageKey); } catch { /* Command is already durably recorded. */ }
      window.location.assign(href);
    } catch (cause) {
      if (intentRef.current) setUncertain(true);
      setError(cause instanceof Error ? cause.message : "Conexiunea s-a întrerupt. Reia aceeași pregătire pentru a verifica rezultatul, fără a crea un dosar duplicat.");
    } finally { setPending(false); }
  }

  return <section className="rounded-lg border border-focus-yellow/40 bg-focus-navy/55 p-4">
    <h3 className="font-black text-white">Pregătește oferta</h3>
    <p className="mt-2 text-sm leading-6 text-slate-300">Asociază sau pregătește clientul și campania, apoi continuă direct în ofertă. Oportunitatea își păstrează etapa; această acțiune nu confirmă vânzarea și nu blochează locații.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm font-bold text-slate-300">Moneda propunerii<select className={`${fieldClass} mt-1`} value={currency} disabled={pending || uncertain || !ready} onChange={(event) => setCurrency(event.target.value)}><option value="">Alege moneda</option><option value="RON">RON</option><option value="EUR">EUR</option></select></label>
      <label className="min-w-0 text-sm font-bold text-slate-300">Firma contractantă<select className={`${fieldClass} mt-1`} value={companyEntity} disabled={pending || uncertain || !ready} onChange={(event) => setCompanyEntity(event.target.value)}><option value="">Alege firma</option><option>Focus Media</option><option>Excellence Media</option><option>Focus BG / Focus Media LLC EOOD</option></select></label>
    </div>
    {uncertain ? <p role="status" className="mt-3 text-sm leading-6 text-amber-100">Există o pregătire al cărei rezultat trebuie verificat. Reia aceeași cerere; aplicația va reutiliza rezultatul salvat, fără a crea un dosar nou.</p> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-red-100">{error}</p> : null}
    <div className="mt-4 flex flex-wrap gap-3"><button className="focus-button" type="button" disabled={pending || !ready || !currency || !companyEntity} onClick={() => void prepare()}>{pending ? <Loader2 className="animate-spin" size={17} /> : <ArrowRight size={17} />}{uncertain ? "Verifică și continuă aceeași pregătire" : "Continuă în ofertă"}</button><button className="focus-button secondary" type="button" disabled={pending} onClick={onReload}><RotateCcw size={16} /> Actualizează dosarul</button></div>
  </section>;
}
