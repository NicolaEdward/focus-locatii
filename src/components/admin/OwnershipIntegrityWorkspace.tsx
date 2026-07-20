"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Search, ShieldCheck, UsersRound } from "lucide-react";
import type { OwnershipClassification, OwnershipIntegrityReport, OwnershipRemediationDryRun } from "@/lib/ownership-integrity";

type UserOption = { id: string; name: string; role: string; active: boolean };
type ReassignDryRun = {
  batchId: string;
  source: UserOption;
  target: UserOption;
  dependencies: Record<string, number>;
  total: number;
};

const reasonLabels: Record<string, string> = {
  MISSING_RESERVATION_SELLER: "Rezervare fara seller",
  INACTIVE_RESERVATION_SELLER: "Seller rezervare inactiv",
  MISSING_RESERVATION_CAMPAIGN: "Rezervare fara campanie",
  MISSING_BOOKED_CLIENT: "BOOKED fara client",
  MISSING_CLIENT_OWNER: "Client fara owner",
  INACTIVE_CLIENT_OWNER: "Owner client inactiv",
  MISSING_CAMPAIGN_SELLER: "Campanie fara seller",
  INACTIVE_CAMPAIGN_SELLER: "Seller campanie inactiv",
  MISSING_CAMPAIGN_OWNER: "Campanie fara owner",
  INACTIVE_CAMPAIGN_OWNER: "Owner campanie inactiv"
};

const classificationLabels: Record<OwnershipClassification, string> = {
  SAFE_AUTOFILL: "Completare sigura",
  NEEDS_REVIEW: "Necesita verificare",
  UNRESOLVED: "Fara dovada"
};

export function OwnershipIntegrityWorkspace({ initialReport, users }: { initialReport: OwnershipIntegrityReport; users: UserOption[] }) {
  const [report, setReport] = useState(initialReport);
  const [classification, setClassification] = useState<OwnershipClassification | "ALL">("ALL");
  const [reason, setReason] = useState("ALL");
  const [entity, setEntity] = useState("ALL");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState<OwnershipRemediationDryRun | null>(null);
  const [sourceUserId, setSourceUserId] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [reassignDryRun, setReassignDryRun] = useState<ReassignDryRun | null>(null);

  const rows = useMemo(() => report.items.filter((item) => {
    if (classification !== "ALL" && item.classification !== classification) return false;
    if (reason !== "ALL" && item.reasonCode !== reason) return false;
    if (entity !== "ALL" && item.entityType !== entity) return false;
    const needle = query.trim().toLowerCase();
    return !needle || item.label.toLowerCase().includes(needle) || item.entityId.toLowerCase().includes(needle);
  }), [classification, entity, query, reason, report.items]);

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/data-integrity/ownership", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Raportul nu a putut fi actualizat.");
      setReport(payload.report);
      setDryRun(null);
      setMessage("Raportul read-only a fost actualizat.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Raportul nu a putut fi actualizat.");
    } finally {
      setBusy(false);
    }
  }

  async function generateDryRun() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/data-integrity/ownership", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: "dry-run" })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Dry-run indisponibil.");
      setDryRun(payload.dryRun);
      setMessage("Dry-run generat. Nu a fost modificata nicio inregistrare.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Dry-run indisponibil.");
    } finally {
      setBusy(false);
    }
  }

  async function generateReassignDryRun() {
    if (!sourceUserId || !targetUserId) return setMessage("Alege utilizatorul sursa si destinatarul.");
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/data-integrity/ownership", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "reassign-dry-run", sourceUserId, targetUserId })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Dry-run-ul de realocare a esuat.");
      setReassignDryRun(payload.dryRun);
      setMessage("Planul de realocare a fost calculat fara modificari in baza de date.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Dry-run-ul de realocare a esuat.");
    } finally {
      setBusy(false);
    }
  }

  const activeSellers = users.filter((user) => user.active && ["SALES_AGENT", "SALES_DIRECTOR"].includes(user.role));
  const sourceUsers = users.filter((user) => !user.active || ["SALES_AGENT", "SALES_DIRECTOR"].includes(user.role));

  return (
    <main className="focus-container space-y-6 py-8">
      <section className="flex flex-col gap-4 border-b border-slate-700 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Guvernanta date</p>
          <h1 className="text-3xl font-black text-white">Integritate ownership</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">Raport read-only pentru seller, owner si legaturile istorice. Nicio sugestie nu este aplicata automat.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="focus-button secondary" type="button" onClick={refresh} disabled={busy} aria-busy={busy}><RefreshCw size={17} />Actualizeaza</button>
          <button className="focus-button" type="button" onClick={generateDryRun} disabled={busy} aria-busy={busy}><ShieldCheck size={17} />Genereaza dry-run</button>
        </div>
      </section>

      {message ? <p role="status" aria-live="polite" className="rounded-md border border-focus-line bg-focus-navy px-4 py-3 text-sm text-white">{message}</p> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Rezervari fara seller" value={report.counts.reservationsWithoutSeller} tone="warning" />
        <Metric label="Rezervari fara campanie" value={report.counts.reservationsWithoutCampaign} tone="warning" />
        <Metric label="BOOKED incomplete" value={report.counts.bookedWithoutClientOrCampaign} tone={report.counts.bookedWithoutClientOrCampaign ? "danger" : "ok"} />
        <Metric label="Clienti activi fara owner" value={report.counts.clientsWithoutOwner} tone={report.counts.clientsWithoutOwner ? "danger" : "ok"} />
        <Metric label="Completari sigure" value={report.classifications.SAFE_AUTOFILL} tone="ok" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 rounded-lg border border-slate-700 bg-focus-navy p-4">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div><h2 className="text-xl font-black text-white">Inregistrari de clasificat</h2><p className="text-sm text-slate-400">{rows.length} rezultate din {report.items.length}</p></div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input aria-label="Cauta dupa cod sau ID" className="focus-input pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cod sau ID" /></label>
              <select aria-label="Filtreaza dupa clasificare" className="focus-input" value={classification} onChange={(event) => setClassification(event.target.value as OwnershipClassification | "ALL")}><option value="ALL">Toate clasele</option>{Object.entries(classificationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <select aria-label="Filtreaza dupa motiv" className="focus-input" value={reason} onChange={(event) => setReason(event.target.value)}><option value="ALL">Toate motivele</option>{Object.entries(reasonLabels).filter(([value]) => report.causes[value]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <select aria-label="Filtreaza dupa entitate" className="focus-input" value={entity} onChange={(event) => setEntity(event.target.value)}><option value="ALL">Toate entitatile</option><option value="reservation">Rezervari</option><option value="client">Clienti</option><option value="campaign">Campanii</option></select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-y border-slate-700 text-xs uppercase text-slate-400"><tr><th className="px-3 py-3">Inregistrare</th><th className="px-3 py-3">Problema</th><th className="px-3 py-3">Clasificare</th><th className="px-3 py-3">Dovezi</th><th className="px-3 py-3">Propunere</th></tr></thead>
              <tbody>{rows.slice(0, 150).map((item) => <tr key={item.id} className="border-b border-slate-800 align-top"><td className="px-3 py-3"><strong className="text-white">{item.label}</strong><span className="mt-1 block text-xs text-slate-500">{item.entityType} · {item.entityId}</span></td><td className="px-3 py-3 text-slate-200">{reasonLabels[item.reasonCode]}<span className="mt-1 block text-xs text-slate-500">{item.status}</span></td><td className="px-3 py-3"><StatusBadge value={item.classification} /></td><td className="px-3 py-3 text-xs text-slate-300">{item.evidence.length ? item.evidence.map((entry) => <span className="block" key={`${entry.source}-${entry.candidateId}`}>{entry.label}: {entry.candidateId}</span>) : "Nicio dovada determinista"}</td><td className="px-3 py-3 text-xs text-slate-300">{item.suggestedPatch ? Object.entries(item.suggestedPatch).map(([field, value]) => <span className="block" key={field}>{field}: {value}</span>) : "Revizuire manuala"}</td></tr>)}</tbody>
            </table>
          </div>
          {rows.length > 150 ? <p className="mt-3 text-xs text-slate-400">Sunt afisate primele 150 rezultate. Foloseste filtrele pentru restul.</p> : null}
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-focus-line bg-focus-navy p-4">
            <h2 className="flex items-center gap-2 text-lg font-black text-white"><CheckCircle2 className="text-focus-yellow" size={19} />Batch sigur propus</h2>
            {dryRun ? <div className="mt-3 space-y-2 text-sm text-slate-300"><p><strong className="text-white">{dryRun.applicableCount}</strong> aplicabile, <strong className="text-white">{dryRun.blockedCount}</strong> blocate</p><p className="break-all font-mono text-xs">{dryRun.batchId}</p></div> : <p className="mt-2 text-sm text-slate-400">Genereaza dry-run pentru un batch reproductibil.</p>}
            <p className="mt-4 rounded-md bg-amber-950/40 p-3 text-xs text-amber-100">Aplicarea in productie este blocata pana la aprobarea explicita si activarea controlata a release-ului.</p>
          </section>

          <section className="rounded-lg border border-slate-700 bg-focus-navy p-4">
            <h2 className="flex items-center gap-2 text-lg font-black text-white"><UsersRound size={19} />Realocare utilizator</h2>
            <div className="mt-3 grid gap-2">
              <select aria-label="Utilizator sursa pentru realocare" className="focus-input" value={sourceUserId} onChange={(event) => { setSourceUserId(event.target.value); setReassignDryRun(null); }}><option value="">Utilizator sursa</option>{sourceUsers.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.active ? "activ" : "inactiv"}</option>)}</select>
              <select aria-label="Responsabil nou pentru realocare" className="focus-input" value={targetUserId} onChange={(event) => { setTargetUserId(event.target.value); setReassignDryRun(null); }}><option value="">Responsabil nou</option>{activeSellers.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}</select>
              <button className="focus-button secondary" type="button" disabled={busy} onClick={generateReassignDryRun}>Verifica impactul</button>
            </div>
            {reassignDryRun ? <div className="mt-3 rounded-md bg-slate-900 p-3 text-xs text-slate-300"><p className="font-bold text-white">{reassignDryRun.total} dependente active</p>{Object.entries(reassignDryRun.dependencies).filter(([, count]) => count).map(([label, count]) => <p key={label}>{label}: {count}</p>)}<p className="mt-2 break-all font-mono">{reassignDryRun.batchId}</p></div> : null}
          </section>

          <section className="rounded-lg border border-slate-700 bg-focus-navy p-4">
            <h2 className="flex items-center gap-2 text-lg font-black text-white"><AlertTriangle size={19} className="text-amber-300" />Financiar legacy separat</h2>
            <dl className="mt-3 grid gap-2 text-sm text-slate-300"><div className="flex justify-between"><dt>Diferente ledger</dt><dd className="font-bold text-white">{report.financeLegacy.ledgerMismatchCount}</dd></div><div className="flex justify-between"><dt>Incasat fara ledger</dt><dd className="font-bold text-white">{report.financeLegacy.collectedWithoutLedgerCount}</dd></div><div className="flex justify-between"><dt>Import issues deschise</dt><dd className="font-bold text-white">{report.financeLegacy.unresolvedImportIssues}</dd></div></dl>
            <p className="mt-3 text-xs text-slate-400">Aceste diferente nu intra in batch-ul de ownership si nu sunt corectate automat.</p>
          </section>

          <section className="rounded-lg border border-slate-700 bg-focus-navy p-4">
            <h2 className="text-lg font-black text-white">Assignment operational</h2>
            <dl className="mt-3 grid gap-2 text-sm text-slate-300"><div className="flex justify-between"><dt>Taskuri active</dt><dd className="font-bold text-white">{report.operationalAssignment.active}</dd></div><div className="flex justify-between"><dt>Nealocate</dt><dd className="font-bold text-white">{report.operationalAssignment.activeUnassigned}</dd></div><div className="flex justify-between"><dt>La utilizator inactiv</dt><dd className="font-bold text-white">{report.operationalAssignment.activeAssignedToInactiveUser}</dd></div></dl>
            <p className="mt-3 text-xs text-slate-400">Taskurile operationale nu sunt realocate de batch-ul comercial.</p>
          </section>
        </aside>
      </section>
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "ok" | "warning" | "danger" }) {
  const color = tone === "ok" ? "text-emerald-300" : tone === "danger" ? "text-rose-300" : "text-amber-300";
  return <article className="rounded-lg border border-slate-700 bg-focus-navy p-4"><p className="text-xs font-bold uppercase text-slate-400">{label}</p><p className={`mt-2 text-3xl font-black ${color}`}>{value}</p></article>;
}

function StatusBadge({ value }: { value: OwnershipClassification }) {
  const style = value === "SAFE_AUTOFILL" ? "bg-emerald-950 text-emerald-200" : value === "NEEDS_REVIEW" ? "bg-amber-950 text-amber-200" : "bg-slate-800 text-slate-300";
  return <span className={`inline-flex rounded px-2 py-1 text-xs font-black ${style}`}>{classificationLabels[value]}</span>;
}
