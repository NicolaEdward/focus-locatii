"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Database, Download, RefreshCcw, ShieldCheck } from "lucide-react";
import type { SagaIntegrationStatus } from "@/lib/integrations/saga/config";
import type { SagaShadowReport } from "@/lib/integrations/saga/shadow-reconciliation";

export function SagaIntegrationWorkspace({ initialStatus, canRun }: { initialStatus: SagaIntegrationStatus; canRun: boolean }) {
  const [report, setReport] = useState<SagaShadowReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function runShadow() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/integrations/saga/shadow", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Reconcilierea shadow nu a putut fi rulata.");
      setReport(payload.report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reconcilierea shadow nu a putut fi rulata.");
    } finally {
      setBusy(false);
    }
  }

  function downloadReport() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `saga-shadow-${report.summary.generatedAt.slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <main className="focus-container grid min-w-0 gap-5 py-6">
    <section className="rounded-lg border border-focus-line bg-focus-ink/75 p-5 shadow-[0_16px_45px_rgba(0,0,0,0.16)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-black uppercase text-focus-yellow">Setari / Integrari</p><h1 className="font-display text-3xl font-black uppercase text-white">SAGA</h1><p className="mt-1 max-w-3xl text-sm text-slate-400">Reconciliere controlata cu registrul Facturi clienti. Shadow mode nu modifica facturi sau incasari.</p></div>
        <div className="flex flex-wrap gap-2"><button className="focus-button" type="button" disabled={busy || !canRun || !initialStatus.canRunShadow} onClick={runShadow}><RefreshCcw className={busy ? "animate-spin" : ""} size={17} /> {busy ? "Se verifica..." : "Ruleaza shadow"}</button>{report ? <button className="focus-button secondary" type="button" onClick={downloadReport}><Download size={17} /> Export raport</button> : null}</div>
      </div>
    </section>

    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Metric label="Conector" value={initialStatus.connectorStatus} icon={<Database size={18} />} />
      <Metric label="Mediu" value={initialStatus.environment} icon={<ShieldCheck size={18} />} />
      <Metric label="Write-back" value="Dezactivat" icon={<AlertTriangle size={18} />} />
      <Metric label="Sursa canonică" value="Focus Media" icon={<CheckCircle2 size={18} />} />
    </section>

    {!initialStatus.canRunShadow ? <Notice tone="warning">Shadow sync este dezactivat aici. Se poate rula numai in Preview/Development cu SAGA_SHADOW_MODE=fixture. Productia nu foloseste fixture-uri si nu face write-back.</Notice> : null}
    {error ? <Notice tone="error">{error}</Notice> : null}

    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
      <div className="min-w-0 rounded-lg border border-focus-line bg-focus-ink/70 p-4">
        <h2 className="text-sm font-black uppercase text-white">Contract si entitati</h2>
        <p className="mt-2 text-sm text-slate-300">{initialStatus.officialContract}. Produs configurat: {initialStatus.product}.</p>
        <div className="mt-4 grid gap-2">{initialStatus.legalEntities.map((entity) => <article className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-focus-line bg-focus-navy/30 p-3" key={entity.code}><div><strong className="text-white">{entity.name}</strong><p className="text-xs text-slate-400">{entity.code}</p></div><span className="text-xs font-black uppercase text-focus-yellow">{entity.configured ? `Configurat ${entity.source}` : "Neconfigurat"}</span></article>)}</div>
      </div>
      <div className="min-w-0 rounded-lg border border-focus-line bg-focus-ink/70 p-4">
        <h2 className="text-sm font-black uppercase text-white">Reguli de siguranta</h2>
        <ul className="mt-3 grid gap-2 text-sm text-slate-300"><li>Registrul manual de incasari ramane autoritativ.</li><li>Nicio factura sau plata nu este creata de shadow.</li><li>RON si EUR sunt raportate separat.</li><li>Potrivirile slabe raman conflicte pentru verificare umana.</li><li>Payloadul brut si credentialele nu ajung in browser.</li></ul>
      </div>
    </section>

    {report ? <Report report={report} /> : <section className="rounded-lg border border-dashed border-focus-line bg-focus-navy/25 p-8 text-center text-sm text-slate-400">Nu exista inca un raport in sesiunea curenta.</section>}
  </main>;
}

function Report({ report }: { report: SagaShadowReport }) {
  return <section className="grid min-w-0 gap-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Citite" value={report.summary.recordsRead} /><Metric label="Facturi exacte" value={report.summary.exactMatches} /><Metric label="Facturi noi" value={report.summary.newInvoices} /><Metric label="Incasari exacte" value={report.summary.exactPaymentMatches} /><Metric label="Incasari noi" value={report.summary.newPayments} /><Metric label="Incasari inversate" value={report.summary.reversedPayments} /><Metric label="Conflicte" value={report.summary.conflicts} /><Metric label="Plati manuale de reconciliat" value={report.summary.manualPaymentsPendingReconciliation} /></div>
    <div className="overflow-x-auto rounded-lg border border-focus-line"><table className="min-w-[760px] w-full text-left text-sm"><thead className="bg-focus-navy text-xs uppercase text-slate-300"><tr><th className="p-3">Entitate</th><th className="p-3">Moneda</th><th className="p-3">Facturi</th><th className="p-3">Net</th><th className="p-3">TVA</th><th className="p-3">Brut</th><th className="p-3">Sold SAGA</th><th className="p-3">Incasari</th></tr></thead><tbody>{report.totals.map((row) => <tr className="border-t border-focus-line text-slate-200" key={`${row.legalEntityCode}-${row.currency}`}><td className="p-3 font-bold">{row.legalEntityCode}</td><td className="p-3">{row.currency}</td><td className="p-3">{row.invoiceCount}</td><td className="p-3">{row.net}</td><td className="p-3">{row.vat}</td><td className="p-3">{row.gross}</td><td className="p-3">{row.outstanding}</td><td className="p-3">{row.collections}</td></tr>)}</tbody></table></div>
    <div className="rounded-lg border border-focus-line bg-focus-ink/70 p-4"><h2 className="text-sm font-black uppercase text-white">Exceptii de verificat</h2><div className="mt-3 grid gap-2">{report.issues.length ? report.issues.map((issue, index) => <article className="rounded-md border border-focus-line bg-focus-navy/30 p-3" key={`${issue.category}-${issue.reference}-${index}`}><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-white">{issue.reference}</strong><span className="text-xs font-black uppercase text-focus-yellow">{issue.category}</span></div><p className="mt-1 text-sm text-slate-300">{issue.message}</p><p className="mt-1 text-xs text-slate-500">{issue.legalEntityCode}</p></article>) : <p className="text-sm text-slate-400">Nu exista exceptii in fixture-ul curent.</p>}</div></div>
  </section>;
}

function Metric({ label, value, icon }: { label: string; value: string | number; icon?: React.ReactNode }) {
  return <article className="min-w-0 rounded-lg border border-focus-line bg-focus-ink/70 p-4"><div className="flex items-center justify-between gap-2 text-focus-yellow">{icon}<span className="text-xs font-black uppercase text-slate-400">{label}</span></div><p className="mt-2 break-words text-xl font-black text-white">{value}</p></article>;
}

function Notice({ tone, children }: { tone: "warning" | "error"; children: React.ReactNode }) {
  return <p className={`rounded-lg border p-4 text-sm font-bold ${tone === "error" ? "border-red-300/30 bg-red-400/10 text-red-100" : "border-amber-300/30 bg-amber-400/10 text-amber-100"}`}>{children}</p>;
}
