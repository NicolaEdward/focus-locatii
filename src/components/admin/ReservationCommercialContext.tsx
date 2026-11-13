"use client";

import { useId, useState } from "react";

type Client = { id: string; companyName: string };
type Campaign = { id: string; clientId: string; status: string; campaignName: string; companyEntity?: string | null; currency?: string | null };

/** Creates only the missing commercial context; the rental draft stays mounted. */
export function ReservationCommercialContext({ clientId, sellerUserId, companyEntity, currency, onClient, onCampaign }: {
  clientId: string; sellerUserId: string; companyEntity: string; currency: string;
  onClient: (client: Client) => void; onCampaign: (campaign: Campaign) => void;
}) {
  const inputId = useId();
  const [companyName, setCompanyName] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function create(kind: "client" | "campaign") {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (!sellerUserId) throw new Error("Alege mai întâi vânzătorul responsabil.");
      if (kind === "client") {
        // Reuse an already visible exact match, avoiding an upsert that could change its profile.
        const found = await fetch(`/api/admin/clients?limit=50&q=${encodeURIComponent(companyName.trim())}`, { cache: "no-store" });
        if (!found.ok) throw new Error("Verificarea duplicatelor nu a reușit. Reîncearcă înainte de creare.");
        const result = await found.json();
        const key = (value: string) => value.trim().normalize("NFKC").toLocaleLowerCase("ro-RO");
        const existing = (result.clients || []).find((row: Client) => key(row.companyName) === key(companyName));
        if (existing) { onClient(existing); setMessage("Clientul exista deja și a fost selectat. Datele lui au fost păstrate."); return; }
      }
      const response = await fetch(kind === "client" ? "/api/admin/clients" : "/api/admin/campaigns", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "client"
          ? { companyName: companyName.trim(), accountOwnerUserId: sellerUserId }
          : { clientId, campaignName: campaignName.trim(), status: "draft", sellerUserId, accountOwnerUserId: sellerUserId, companyEntity, currency })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Datele comerciale nu au putut fi salvate.");
      if (kind === "client") onClient(result.client); else onCampaign(result.campaign);
      setMessage(kind === "client" ? "Client selectat. Creează sau alege campania, apoi continuă închirierea." : "Campanie creată ca ciornă și selectată. Locațiile și perioada au fost păstrate.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Operația nu a reușit."); }
    finally { setBusy(false); }
  }

  return <details className="rounded-lg border border-focus-line p-3 md:col-span-2">
    <summary className="cursor-pointer text-sm font-bold text-focus-yellow">Lipsește clientul sau campania? Completează aici</summary>
    <p className="mt-2 text-xs text-slate-400">Selecția și perioada închirierii rămân salvate în acest formular. Verificăm clienții existenți înainte de creare.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <div className="grid gap-2 text-sm"><label htmlFor={`${inputId}-client`}>Numele firmei</label><input id={`${inputId}-client`} className="focus-input" value={companyName} maxLength={191} onChange={(event) => setCompanyName(event.target.value)} /><button type="button" className="focus-button secondary" disabled={busy || companyName.trim().length < 2} onClick={() => void create("client")}>Creează / selectează client</button></div>
      <div className="grid gap-2 text-sm"><label htmlFor={`${inputId}-campaign`}>Numele campaniei</label><input id={`${inputId}-campaign`} className="focus-input" value={campaignName} maxLength={191} onChange={(event) => setCampaignName(event.target.value)} /><button type="button" className="focus-button secondary" disabled={busy || !clientId || campaignName.trim().length < 2 || !companyEntity} onClick={() => void create("campaign")}>Creează campanie ciornă</button></div>
    </div>
    {error ? <p role="alert" className="mt-3 text-sm text-red-200">{error}</p> : null}
    {message ? <p role="status" className="mt-3 text-sm text-emerald-200">{message}</p> : null}
  </details>;
}
