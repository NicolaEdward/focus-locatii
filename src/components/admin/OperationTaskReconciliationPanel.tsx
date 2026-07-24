import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Filter,
  Info,
  Layers3,
  ShieldCheck
} from "lucide-react";
import type {
  OperationTaskReconciliationBatch,
  OperationTaskReconciliationCategory,
  OperationTaskReconciliationFinding,
  OperationTaskReconciliationResponse
} from "@/lib/dashboard/executive/operation-task-reconciliation-contracts";

const categoryLabels: Record<OperationTaskReconciliationCategory, string> = {
  BOOKED_WITHOUT_OPERATION_TASK: "BOOKED fără task",
  NEUTRALIZATION_MISSING: "Neutralizare lipsă",
  ORPHAN_OPERATION_TASK: "Task orfan",
  UNASSIGNED_ACTIVE_TASK: "Task activ nealocat",
  DUPLICATE_TASK: "Posibil duplicat",
  TERMINAL_TASK_FOR_ACTIVE_OBLIGATION: "Task terminal / BOOKED activ",
  COMPLETED_WITHOUT_PROOF: "Finalizat fără dovadă",
  IMPOSSIBLE_TASK_DATE: "Date imposibile",
  LEGACY_OR_STALE_TASK: "Legacy / stale",
  ENDED_CAMPAIGN_TASK: "Task activ / campanie terminată",
  POSSIBLE_CHANGEOVER: "Changeover posibil",
  DATA_INSUFFICIENT: "Date insuficiente"
};

const batchLabels: Record<OperationTaskReconciliationBatch, string> = {
  SAFE_CASES: "Cazuri deterministe",
  NEEDS_HUMAN_CONFIRMATION: "Confirmare umană",
  DO_NOT_MIGRATE: "Nu se migrează automat",
  DUPLICATES: "Duplicate",
  DATA_INSUFFICIENT: "Date insuficiente"
};

export function OperationTaskReconciliationPanel({
  data
}: {
  data: OperationTaskReconciliationResponse;
}) {
  return (
    <section className="scroll-mt-28 rounded-lg border border-focus-line bg-focus-navy/45 p-4 sm:p-5" id="operation-task-reconciliation">
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-4 border-b border-focus-line pb-4">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase text-focus-yellow">Audit canonic · dry-run read-only</p>
          <h2 className="mt-1 text-2xl font-black text-white">Reconciliere OperationTask</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Compară obligațiile BOOKED cu taskurile, assignmenturile și dovezile existente. Raportul nu modifică și nu pregătește automat datele pentru scriere.
          </p>
        </div>
        <div className="rounded-md border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs font-black text-emerald-100">
          0 scrieri · asOf {dateTimeLabel(data.meta.asOf)}
        </div>
      </header>

      <ReconciliationSummary data={data} />
      <ReconciliationFilters data={data} />

      <div className="mt-4 grid gap-3 xl:grid-cols-5" aria-label="Loturi propuse">
        {data.batches.map((batch) => (
          <article className="min-w-0 rounded-md border border-white/10 bg-focus-ink/55 p-3" key={batch.id}>
            <span className="text-[10px] font-black uppercase text-slate-400">{batch.label}</span>
            <strong className="mt-2 block text-2xl text-white">{batch.count}</strong>
            <span className="mt-1 block text-[11px] text-slate-400">{batch.count} înregistrări · {batch.findingCount} constatări</span>
            <p className="mt-2 text-xs leading-5 text-slate-400">{batch.proposedTreatment}</p>
            <span className="mt-3 inline-flex min-h-7 items-center gap-1 rounded bg-sky-300/10 px-2 text-[10px] font-black uppercase text-sky-100">
              <ShieldCheck size={13} /> Neaprobat pentru execuție
            </span>
          </article>
        ))}
      </div>

      <div className="mt-4 grid gap-3" aria-live="polite">
        {data.items.length
          ? data.items.map((item) => <FindingCard item={item} key={item.id} />)
          : <div className="flex min-h-28 items-center gap-3 rounded-lg border border-dashed border-focus-line px-4 text-sm text-slate-300">
              <CheckCircle2 className="text-emerald-300" size={22} />
              Nu există constatări pentru filtrele selectate.
            </div>}
      </div>

      <ReconciliationPagination data={data} />

      <details className="mt-5 rounded-lg border border-white/10 bg-focus-ink/45 p-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-black text-white">
          <Info className="text-focus-yellow" size={17} /> Contractul de cutover propus
        </summary>
        <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-300">
          <p>1. Se pilotează numai cazurile deterministe, într-un lot mic și reversibil.</p>
          <p>2. Assignmentul, changeover-ul, duplicatele și taskurile fără legături canonice rămân la confirmare umană.</p>
          <p>3. Nu se șterg taskuri legacy și nu se activează global niciun feature flag în această etapă.</p>
          <p>4. Orice viitor batch trebuie să păstreze actor, motiv, before/after, batch id și verificare post-write.</p>
        </div>
      </details>
    </section>
  );
}

function ReconciliationSummary({ data }: { data: OperationTaskReconciliationResponse }) {
  const rows = [
    ["Obligații BOOKED", data.summary.bookedObligations],
    ["OperationTask", data.summary.operationTasks],
    ["Taskuri active", data.summary.activeTasks],
    ["Nealocate", data.summary.unassignedActiveTasks],
    ["Assignment complet", `${data.summary.assignmentCompleteness}%`],
    ["Constatări", data.summary.findings]
  ];
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="Rezumat reconciliere">
      {rows.map(([label, value]) => (
        <div className="min-h-20 rounded-md border border-white/10 bg-focus-ink/55 p-3" key={label}>
          <span className="text-[10px] font-black uppercase text-slate-400">{label}</span>
          <strong className="mt-2 block break-words text-2xl text-white">{value}</strong>
        </div>
      ))}
    </div>
  );
}

function ReconciliationFilters({ data }: { data: OperationTaskReconciliationResponse }) {
  return (
    <form className="mt-4 grid gap-3 rounded-lg border border-focus-line bg-focus-ink/40 p-3 sm:grid-cols-2 xl:grid-cols-6" method="get">
      <input name="panel" type="hidden" value="operation-task-reconciliation" />
      <input name="entity" type="hidden" value={data.scope.entitySelection} />
      <input name="snapshot" type="hidden" value={data.scope.snapshotDate} />
      <FilterSelect label="Categorie" name="category" value={data.filters.category}>
        <option value="ALL">Toate categoriile</option>
        {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </FilterSelect>
      <FilterSelect label="Lot propus" name="batch" value={data.filters.batch}>
        <option value="ALL">Toate loturile</option>
        {Object.entries(batchLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </FilterSelect>
      <FilterSelect label="Tip" name="kind" value={data.filters.kind}>
        <option value="">Toate tipurile</option>
        {Object.keys(data.summary.byKind).map((value) => <option key={value} value={value}>{value}</option>)}
      </FilterSelect>
      <FilterSelect label="Status" name="status" value={data.filters.status}>
        <option value="">Toate statusurile</option>
        {Object.keys(data.summary.byStatus).map((value) => <option key={value} value={value}>{value}</option>)}
      </FilterSelect>
      <FilterSelect label="Mediu" name="medium" value={data.filters.medium}>
        <option value="ALL">Toate mediile</option>
        <option value="STATIC">Static</option>
        <option value="DIGITAL">Digital</option>
        <option value="UNKNOWN">Necunoscut</option>
      </FilterSelect>
      <button className="focus-button min-h-11 self-end justify-center" type="submit">
        <Filter size={17} /> Aplică
      </button>
    </form>
  );
}

function FilterSelect({
  label,
  name,
  value,
  children
}: {
  label: string;
  name: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-xs font-black uppercase text-slate-300">
      {label}
      <select className="focus-input min-h-11 w-full" defaultValue={value} name={name}>{children}</select>
    </label>
  );
}

function FindingCard({ item }: { item: OperationTaskReconciliationFinding }) {
  return (
    <article className="min-w-0 rounded-lg border border-sky-300/20 bg-sky-400/[0.045] p-4">
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex min-h-7 items-center rounded px-2 text-[10px] font-black uppercase ${batchTone(item.batch)}`}>
              {batchLabels[item.batch]}
            </span>
            <span className="rounded border border-white/10 px-2 py-1 text-[10px] font-black uppercase text-slate-300">
              {categoryLabels[item.category]}
            </span>
            <span className="text-[11px] text-slate-400">Confidence {item.confidence}% · {item.dataQualityState}</span>
          </div>
          <h3 className="mt-3 text-base font-black text-white">{item.title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-300">{item.summary}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
            <span>Entitate: <strong className="text-slate-200">{item.entityLabel}</strong></span>
            <span>Tip: <strong className="text-slate-200">{item.kind}</strong></span>
            <span>Status: <strong className="text-slate-200">{item.status}</strong></span>
            <span>Mediu: <strong className="text-slate-200">{item.medium}</strong></span>
          </div>
        </div>
        <Link className="focus-button secondary min-h-11 justify-center self-start" href={item.deepLink} prefetch={false}>
          <ExternalLink size={16} /> Verifică sursa
        </Link>
      </div>
      <details className="mt-4 border-t border-white/10 pt-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-xs font-black text-focus-yellow">
          <AlertTriangle size={16} /> Evidence · {item.reasonCode}
        </summary>
        <div className="grid gap-2 pb-2 pt-2 sm:grid-cols-2">
          {item.evidence.map((entry) => (
            <div className="flex min-w-0 justify-between gap-3 border-b border-white/5 pb-2 text-xs" key={`${entry.label}-${entry.value}`}>
              <span className="text-slate-400">{entry.label}</span>
              <strong className="max-w-[65%] break-words text-right text-slate-200">{entry.value}</strong>
            </div>
          ))}
        </div>
      </details>
    </article>
  );
}

function ReconciliationPagination({ data }: { data: OperationTaskReconciliationResponse }) {
  if (!data.pagination.previousCursor && !data.pagination.nextCursor) return null;
  return (
    <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Paginare reconciliere">
      {data.pagination.previousCursor
        ? <Link className="focus-button secondary min-h-11" href={pageHref(data, data.pagination.previousCursor)} scroll={false}><ArrowLeft size={16} /> Înapoi</Link>
        : <span />}
      <span className="text-xs text-slate-400">{data.pagination.returned} din {data.summary.findings}</span>
      {data.pagination.nextCursor
        ? <Link className="focus-button secondary min-h-11" href={pageHref(data, data.pagination.nextCursor)} scroll={false}>Următoarele <ArrowRight size={16} /></Link>
        : <span />}
    </nav>
  );
}

function pageHref(data: OperationTaskReconciliationResponse, cursor: string) {
  const params = new URLSearchParams({
    panel: "operation-task-reconciliation",
    entity: data.scope.entitySelection,
    snapshot: data.scope.snapshotDate,
    category: data.filters.category,
    batch: data.filters.batch,
    kind: data.filters.kind,
    status: data.filters.status,
    medium: data.filters.medium,
    cursor
  });
  return `/admin/dashboard?${params.toString()}#operation-task-reconciliation`;
}

function batchTone(batch: OperationTaskReconciliationBatch) {
  if (batch === "SAFE_CASES") return "bg-emerald-300/15 text-emerald-100";
  if (batch === "NEEDS_HUMAN_CONFIRMATION") return "bg-amber-300/15 text-amber-100";
  if (batch === "DUPLICATES") return "bg-orange-300/15 text-orange-100";
  if (batch === "DO_NOT_MIGRATE") return "bg-red-300/15 text-red-100";
  return "bg-sky-300/15 text-sky-100";
}

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Bucharest"
  }).format(new Date(value));
}
