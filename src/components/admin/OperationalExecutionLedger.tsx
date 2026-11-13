"use client";

import { useEffect, useState } from "react";
import type { ExecutionHistoryPage } from "@/lib/operational-execution-history";

export function OperationalExecutionLedger({ month }: { month: string }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<ExecutionHistoryPage | null>(null);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const cursor = cursors.at(-1) || null;
  useEffect(() => { setCursors([null]); setPage(null); }, [month]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError(""); setPage(null);
    const params = new URLSearchParams({ month });
    if (cursor) params.set("after", cursor);
    fetch(`/api/admin/operational/execution-history?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Registrul execuțiilor nu poate fi citit.");
        if (!controller.signal.aborted) setPage(payload);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Registrul execuțiilor nu poate fi citit."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, month, cursor, retry]);

  return <section className="mb-4 min-w-0 rounded-lg border border-focus-line p-4">
    <button className="focus-button secondary min-h-11" type="button" aria-expanded={open} aria-controls="operational-execution-ledger" onClick={() => setOpen((value) => !value)}>{open ? "Ascunde istoricul execuțiilor" : "Vezi istoricul execuțiilor, inclusiv anulările"}</button>
    {open ? <div id="operational-execution-ledger" className="mt-3 grid min-w-0 gap-3">
      <p className="text-sm text-slate-300">Execuții înregistrate în {month}. Anularea închirierii păstrează dovada lucrării. Acest registru nu aprobă o factură sau o plată către furnizor.</p>
      {loading ? <p role="status" className="text-sm text-slate-300">Se încarcă istoricul execuțiilor…</p> : null}
      {error ? <div role="alert" className="text-sm text-red-200"><p>{error}</p><button className="focus-button secondary mt-2 min-h-11" type="button" onClick={() => setRetry((value) => value + 1)}>Reîncearcă registrul</button></div> : null}
      {page ? <>
        <p className="text-xs text-slate-300">{page.rows.length} execuții în această pagină; {page.scannedReservations} închirieri verificate. {page.nextCursor ? "Mai există înregistrări de parcurs." : "Ai ajuns la finalul înregistrărilor accesibile."}</p>
        {page.limitedTaskGroups ? <p role="alert" className="text-sm text-amber-200">{page.limitedTaskGroups} închirieri depășesc limita de 100 de sarcini pe pagină. Istoricul lor trebuie verificat separat; această listă nu este completă.</p> : null}
        <div className="grid min-w-0 gap-2">{page.rows.map((row) => <article key={row.key} className="min-w-0 rounded border border-focus-line p-3 text-sm">
          <p className="break-words font-bold text-white">{row.location} · {row.client}</p><p className="break-words text-slate-300">{row.campaign} · {row.finalizationDate.slice(0, 10)} · {row.taskType === "redecoration" ? "Redecorare" : "Montaj inițial"}</p>
          <p className="mt-1 text-slate-300">Cost înregistrat: {row.cost == null ? "necunoscut" : row.cost.toFixed(2)} {row.currency || (row.sourceCurrency ? `${row.sourceCurrency} — monedă de verificat` : "— monedă necunoscută")}</p>
          <p className={row.billingReview === "rental_status_review" ? "mt-1 font-bold text-amber-200" : "mt-1 text-slate-300"}>Închiriere {row.reservationStatus}. {row.billingReview === "rental_status_review" ? "Execuție păstrată; verifică separat facturabilitatea după anulare/închidere." : "Facturabilitatea și documentele financiare necesită verificare."}</p>
          {row.completionDateSource !== "completed" ? <p className="mt-1 text-amber-200">Data finalizării lipsește; este afișată data programată, care necesită verificare.</p> : null}
        </article>)}</div>
        {!page.rows.length ? <p className="text-sm text-slate-300">Nicio execuție în luna aleasă pe această pagină.{page.nextCursor ? " Continuă pentru a verifica următoarele înregistrări istorice." : ""}</p> : null}
        <div className="flex flex-wrap gap-2"><button className="focus-button secondary min-h-11" type="button" disabled={loading || cursors.length <= 1} onClick={() => setCursors((values) => values.slice(0, -1))}>Pagina anterioară de execuții</button><button className="focus-button secondary min-h-11" type="button" disabled={loading || !page.nextCursor} onClick={() => setCursors((values) => [...values, page.nextCursor])}>Pagina următoare de execuții</button></div>
      </> : null}
    </div> : null}
  </section>;
}
