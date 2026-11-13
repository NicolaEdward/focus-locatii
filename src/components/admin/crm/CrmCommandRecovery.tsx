"use client";

import { useEffect, useRef, useState } from "react";
import { createCrmCommandIntention, sendCrmCommandIntention, verifyCrmCommandIntention, type CrmCommandIntention, type CrmCommandOutcome } from "@/lib/crm-command-client";

export function useCrmCommandFlow(scope: string) {
  const intent = useRef<CrmCommandIntention | null>(null);
  const [blocked, setBlocked] = useState<CrmCommandIntention | null>(null);
  const [ready, setReady] = useState(false);
  const storageKey = `focus.crm.unresolved.${scope}`;
  function remember(value: CrmCommandIntention | null) {
    try {
      if (!value) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify({ key: value.key, auditRequestId: value.auditRequestId }));
    } catch { /* In-memory protection remains when browser storage is unavailable. */ }
  }
  useEffect(() => {
    intent.current = null; setBlocked(null);
    try {
      const prior = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (typeof prior?.key === "string" && prior.key.length > 0 && prior.key.length <= 191) {
        const recovered: CrmCommandIntention = { key: prior.key, payload: {}, state: "unknown", auditRequestId: prior.auditRequestId };
        intent.current = recovered; setBlocked(recovered);
      }
    } catch { /* Malformed browser state is ignored; server-side intent claims still apply. */ }
    setReady(true);
  }, [storageKey]);

  function resolve() { intent.current = null; setBlocked(null); remember(null); }
  async function run(payload: Record<string, unknown>): Promise<CrmCommandOutcome> {
    if (!ready) return { outcome: "unknown", message: "Se verifică starea intenției anterioare." };
    if (intent.current && ["sending", "unknown", "partial"].includes(intent.current.state)) return { outcome: "unknown", message: "Verifică mai întâi rezultatul intenției anterioare. Comanda nu a fost retrimisă." };
    const { idempotencyKey: _oldKey, ...values } = payload;
    const previousValues = intent.current ? { ...intent.current.payload, idempotencyKey: undefined } : null;
    if (!intent.current || JSON.stringify(previousValues) !== JSON.stringify(values)) intent.current = createCrmCommandIntention(values);
    const current = intent.current;
    // Persist only the opaque key before transport, so a reload after response
    // loss recovers the same intention. Business form data stays in memory.
    remember(current);
    const outcome = await sendCrmCommandIntention(current);
    if (outcome.outcome === "committed") resolve();
    else if (outcome.outcome === "unknown" || outcome.outcome === "partial") { setBlocked({ ...current }); remember(current); }
    else remember(null);
    return outcome;
  }
  async function verify() {
    if (!intent.current) return { outcome: "unknown", message: "Nu există o intenție de verificat." } as CrmCommandOutcome;
    const result = await verifyCrmCommandIntention(intent.current);
    setBlocked({ ...intent.current });
    return result;
  }
  return { ready, blocked, run, verify, resolve };
}

export function CrmCommandRecovery({ flow, onCommitted, onResolved, browseHref }: { flow: ReturnType<typeof useCrmCommandFlow>; onCommitted: () => void | Promise<void>; onResolved: () => void; browseHref: string }) {
  const [checking, setChecking] = useState(false), [checked, setChecked] = useState(false);
  const [evidence, setEvidence] = useState<CrmCommandOutcome | null>(null);
  if (!flow.blocked) return null;
  return <section role="alert" className="space-y-3 rounded-lg border border-amber-400 bg-amber-950/30 p-4 text-sm text-amber-100">
    <p className="font-bold">Rezultatul ultimei salvări trebuie verificat</p>
    <p>Salvarea este blocată pentru a evita o operație repetată. Verificarea de mai jos citește istoricul și nu retrimite comanda.</p>
    <p className="break-all font-mono text-xs">Intenție: {flow.blocked.key}{flow.blocked.auditRequestId ? ` · Cerere: ${flow.blocked.auditRequestId}` : ""}</p>
    {evidence && <p>{evidence.message}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className="focus-button secondary" disabled={checking} onClick={async () => {
      setChecking(true);
      try { const result = await flow.verify(); setEvidence(result); if (result.outcome === "committed") { flow.resolve(); await onCommitted(); } }
      finally { setChecking(false); }
    }}>{checking ? "Se verifică..." : "Verifică rezultatul fără retrimitere"}</button><a className="focus-button secondary" href={browseHref} target="_blank" rel="noopener noreferrer">Deschide registrul pentru verificare</a></div>
    {evidence?.records?.map((r) => <a className="block underline" key={`${r.kind}:${r.id}`} href={`/admin/crm?kind=${encodeURIComponent(r.kind)}&record=${encodeURIComponent(r.id)}`} target="_blank" rel="noopener noreferrer">Deschide dosarul înregistrat</a>)}
    <details><summary className="cursor-pointer font-bold">Închide intenția după verificarea manuală</summary><p className="mt-2">Dacă rezultatul rămâne neclar, cere verificarea unui responsabil. Închiderea nu retrimite comanda. O salvare ulterioară va reprezenta o intenție nouă.</p><label className="my-3 flex gap-2"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />Am verificat dosarul și istoricul; pot închide această intenție fără să repet operația.</label><button className="focus-button secondary" type="button" disabled={!checked || checking} onClick={() => { flow.resolve(); onResolved(); }}>Închide intenția verificată</button></details>
  </section>;
}
