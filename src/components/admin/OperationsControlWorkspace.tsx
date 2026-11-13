"use client";

import { useState, type FormEvent } from "react";
import type { getOperationsControls } from "@/lib/operations-controls";

type State = Awaited<ReturnType<typeof getOperationsControls>>;
const date = (v: string | null) => v ? new Date(v).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" }) : "Neverificat";
export function OperationsControlWorkspace({ initialState, role }: { initialState: State; role: string }) {
  const [state, setState] = useState(initialState), [policy, setPolicy] = useState(initialState.policy);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState(""), [receiptType, setReceiptType] = useState("register_backup");
  const [preview, setPreview] = useState<{ counts: { sessions: number; tokens: number; limits: number }; previewToken: string; expiresAt: string; excludes: string[] } | null>(null);
  const canManage = ["COO", "SUPER_ADMIN"].includes(role);
  async function command(body: Record<string, unknown>) {
    setBusy(true); setError(""); setMessage("");
    try {
      const r = await fetch("/api/admin/operations-control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error || "Actiunea nu a reusit.");
      setState(data.state); setPolicy(data.state.policy); return data.result;
    } catch (e) { setError(e instanceof Error ? e.message : "Actiunea nu a reusit."); return null; }
    finally { setBusy(false); }
  }
  async function savePolicy(e: FormEvent) {
    e.preventDefault(); const { version, configured: _configured, ...values } = policy;
    if (await command({ action: "update_policy", input: { expectedVersion: version, policy: values } })) { setPreview(null); setMessage("Politica a fost salvata si jurnalizata."); }
  }
  return <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 text-white">
    <section className="focus-panel p-5"><p className="focus-kicker">CONTINUITATE SI TRASABILITATE</p><h1 className="text-2xl font-black">Control operațional</h1><p className="mt-2 text-sm text-slate-300">Dovezi pentru backup, restaurare, audit și retenție. Verificările din mediul de test rămân separate de producție.</p>
      <p className="mt-3 text-sm">Mediu: <strong>{state.environment === "production" ? "Producție" : "Test"}</strong> · Politică: {state.policy.configured ? `versiunea ${state.policy.version}` : "neaprobată — valorile de mai jos sunt propuneri"}</p></section>
    {error && <p role="alert" className="rounded-xl border border-red-400 p-4 text-red-200">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-emerald-400 p-4 text-emerald-200">{message}</p>}
    <section className="grid gap-4 md:grid-cols-3">
      <div className="focus-panel min-w-0 p-5"><h2 className="font-bold">Backup criptat</h2><p className="my-2 text-lg font-bold">{state.backup.status === "verified" ? "Dovezi în limitele politicii" : state.backup.status === "unverified" ? "Neverificat" : "Necesită atenție"}</p><p className="text-sm">Ultimul backup: {date(state.backup.backupCreatedAt)}</p><p className="text-sm">Ultima restaurare: {date(state.backup.verifiedAt)}</p><p className="mt-2 text-xs text-slate-300">{state.backup.explanation}</p></div>
      <div className="focus-panel min-w-0 p-5"><h2 className="font-bold">Audit în ultimele 24 ore</h2><p className="my-2 text-xl font-bold">{state.audit.last24hEvents} evenimente</p><p className="text-sm">{state.audit.transactionEvents} în tranzacția de business · {state.audit.acceptedMutationRequests} intenții acceptate</p><p className="mt-2 text-xs text-slate-300">{state.audit.explanation}</p></div>
      <div className="focus-panel min-w-0 p-5"><h2 className="font-bold">Configurare și alerte</h2><p className="mt-2 text-sm">Cheie dedicată backup: {state.backup.keyConfigured ? "configurată" : "neconfigurată"}</p><p className="text-sm">Monitorizare externă: {state.monitoring.externalDrainConfigured ? "declarată configurată" : "neconfirmată"}</p><p className="mt-2 text-xs text-slate-300">{state.monitoring.explanation}</p>{canManage && <button type="button" className="focus-button mt-3" disabled={busy} onClick={async () => { if (await command({ action: "sync_alerts" })) setMessage("Verificarea a fost înregistrată; problemele nerezolvate rămân deschise."); }}>Verifică alertele interne</button>}</div>
    </section>
    <form onSubmit={savePolicy} className="focus-panel space-y-4 p-5"><h2 className="text-xl font-bold">Politica de continuitate și retenție</h2><p className="text-sm text-slate-300">RPO este vechimea maximă țintită a backupului. RTO este durata țintită a recuperării. Salvarea nu activează ștergerea datelor comerciale.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{([
        ["rpoHours", "RPO ore", 1, 720], ["rtoMinutes", "RTO minute", 1, 10080], ["restoreDrillDays", "Exercițiu restore la zile", 1, 365],
        ["sessionRetentionDays", "Păstrare sesiuni expirate zile", 30, 3650], ["tokenRetentionDays", "Păstrare tokenuri expirate zile", 7, 365], ["rateLimitRetentionDays", "Păstrare ferestre rate limit expirate zile", 1, 90]
      ] as const).map(([key, label, min, max]) => <label key={key} className="block text-sm">{label}<input className="focus-input mt-1 w-full" type="number" min={min} max={max} required value={policy[key]} disabled={!canManage || busy} onChange={(e) => setPolicy({ ...policy, [key]: Number(e.target.value) })} /></label>)}</div>
      <label className="block text-sm">Politica pentru date comerciale și fiscale<textarea className="focus-input mt-1 min-h-24 w-full" value={policy.businessRetentionNote} maxLength={2000} minLength={10} required disabled={!canManage || busy} onChange={(e) => setPolicy({ ...policy, businessRetentionNote: e.target.value })} /></label>
      {canManage && <button className="focus-button" disabled={busy} type="submit">Aprobă și salvează politica</button>}
    </form>
    {canManage && <section className="focus-panel space-y-4 p-5"><h2 className="text-xl font-bold">Dovadă semnată de backup sau restaurare</h2><p className="text-sm text-slate-300">Încarcă numai JSON-ul semnat generat de instrumentul de backup, fără datele bazei și fără chei. Semnătura, baza sursă, checksum-urile și mediul sunt verificate înainte de înregistrare. Cheia de recuperare se configurează și se păstrează separat, într-un seif autorizat.</p>
      <label className="block text-sm">Tip dovadă<select className="focus-input ml-2" value={receiptType} onChange={(e) => setReceiptType(e.target.value)}><option value="register_backup">Backup creat</option><option value="register_restore">Restaurare verificată</option></select></label>
      <label className="block text-sm">Chitanță JSON<textarea className="focus-input mt-1 min-h-32 w-full font-mono text-xs" value={receipt} maxLength={100000} onChange={(e) => setReceipt(e.target.value)} /></label>
      <button className="focus-button" disabled={busy || !state.backup.keyConfigured || !receipt.trim()} type="button" onClick={async () => { let value; try { value = JSON.parse(receipt); } catch { setError("JSON invalid."); return; } if (await command({ action: receiptType, receipt: value })) { setReceipt(""); setMessage("Dovada semnată a fost verificată și înregistrată."); } }}>Verifică și înregistrează</button>
    </section>}
    {role === "SUPER_ADMIN" && <section className="focus-panel space-y-4 p-5"><h2 className="text-xl font-bold">Curățare controlată a datelor tehnice expirate</h2><p className="text-sm">Previzualizează un lot de cel mult 500 de înregistrări pentru fiecare categorie. Nu sunt incluse clienți, contacte, facturi, plăți, documente, audit sau sesiuni valabile.</p><button className="focus-button-secondary" disabled={busy || !state.policy.configured} type="button" onClick={async () => { const r = await command({ action: "preview_retention" }); if (r) setPreview(r); }}>Previzualizează lotul</button>
      {preview && <div role="status" className="space-y-3 rounded-lg border border-yellow-400 p-4"><p>Sesiuni expirate: {preview.counts.sessions} · Tokenuri expirate: {preview.counts.tokens} · Ferestre expirate: {preview.counts.limits}</p><p className="text-sm">Confirmarea expiră la {date(preview.expiresAt)}. Se aplică doar lotului previzualizat.</p><button className="focus-button" disabled={busy} type="button" onClick={async () => { if (await command({ action: "confirm_retention", previewToken: preview.previewToken })) { setPreview(null); setMessage("Lotul previzualizat a fost curățat și jurnalizat."); } }}>Confirmă acest lot de date tehnice expirate</button><button className="focus-button-secondary ml-2" type="button" onClick={() => setPreview(null)}>Renunță</button></div>}
    </section>}
    <section className="focus-panel p-5"><h2 className="mb-3 text-xl font-bold">Evenimente de control</h2>{state.recentEvents.length ? <ul className="space-y-2 text-sm">{state.recentEvents.map((e) => <li key={e.id} className="flex flex-wrap justify-between gap-2 border-b border-slate-600 py-2"><span className="break-all">{e.action}</span><time>{date(e.createdAt)}</time></li>)}</ul> : <p>Nu există încă dovezi sau politici înregistrate. Această stare nu înseamnă că backupurile furnizorului lipsesc.</p>}</section>
  </main>;
}
