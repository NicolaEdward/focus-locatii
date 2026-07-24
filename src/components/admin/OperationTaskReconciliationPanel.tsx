import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSearch,
  Filter,
  Info,
  ShieldCheck
} from "lucide-react";
import type {
  OperationCutoverCase,
  OperationCutoverPriority,
  OperationCutoverReviewGroup
} from "@/lib/dashboard/executive/operation-task-cutover-contracts";
import type { OperationTaskReconciliationResponse } from "@/lib/dashboard/executive/operation-task-reconciliation-contracts";

const priorityLabels: Record<OperationCutoverPriority, string> = {
  CRITICAL_CURRENT: "Critice / curente",
  RECENT_RELEVANT: "Relevante recent",
  HISTORICAL_LEGACY: "Istorice / legacy"
};

const reviewGroupLabels: Record<OperationCutoverReviewGroup, string> = {
  DETERMINISTIC: "Deterministe",
  HUMAN_REVIEW: "Validare umană",
  LEGACY_EXCLUDED: "Legacy / excluse propus"
};

export function OperationTaskReconciliationPanel({ data }: { data: OperationTaskReconciliationResponse }) {
  const review = data.review;
  return (
    <section className="scroll-mt-28 rounded-lg border border-focus-line bg-focus-navy/45 p-4 sm:p-5" id="operation-task-reconciliation">
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-4 border-b border-focus-line pb-4">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase text-focus-yellow">OperationTask · human review pack</p>
          <h2 className="mt-1 text-2xl font-black text-white">Reconciliere pentru cutover</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Separă cazurile curente, recente și legacy fără să modifice datele. Eligibilitatea KPI și loturile de remediere sunt doar propuneri.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-11 items-center rounded-md border border-emerald-300/20 bg-emerald-400/10 px-3 text-xs font-black text-emerald-100">
            0 scrieri · {dateTimeLabel(data.meta.asOf)}
          </span>
          <Link className="focus-button secondary min-h-11" href={exportHref(data)} prefetch={false}>
            <Download size={17} /> Exportă analiza
          </Link>
        </div>
      </header>

      <DecisionUniverse data={data} />
      <AssignmentCompleteness data={data} />
      <ReviewFilters data={data} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-black uppercase text-slate-400">Cazuri filtrate</p>
          <p className="mt-1 text-sm text-slate-300">
            <strong className="text-xl text-white">{review.filteredCaseCount}</strong> cazuri distincte, nu constatări suprapuse
          </p>
        </div>
        <span className="rounded border border-sky-300/20 bg-sky-400/10 px-2 py-1 text-[11px] font-black text-sky-100">
          {review.contractVersion}
        </span>
      </div>

      <div className="mt-4 grid gap-3" aria-live="polite">
        {review.cases.length
          ? review.cases.map((item) => <ReviewCaseCard item={item} key={item.stableCaseId} />)
          : <div className="flex min-h-28 items-center gap-3 rounded-lg border border-dashed border-focus-line px-4 text-sm text-slate-300">
              <CheckCircle2 className="text-emerald-300" size={22} />
              Nu există cazuri pentru filtrele selectate.
            </div>}
      </div>

      <ReviewPagination data={data} />
      <ReviewArchitecture data={data} />
    </section>
  );
}

function DecisionUniverse({ data }: { data: OperationTaskReconciliationResponse }) {
  const summary = data.review.summary;
  const rows = [
    ["Cazuri decizie", summary.decisionCases],
    ["Taskuri existente", summary.taskCases],
    ["Taskuri lipsă", summary.missingTaskCases],
    ["Changeover", summary.changeoverCases],
    ["Constatări", summary.findingOccurrences],
    ["Rezervări distincte", summary.distinctReservations]
  ];
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="Univers matematic reconciliere">
      {rows.map(([label, value]) => (
        <div className="min-h-20 rounded-md border border-white/10 bg-focus-ink/55 p-3" key={label}>
          <span className="text-[10px] font-black uppercase text-slate-400">{label}</span>
          <strong className="mt-2 block break-words text-2xl text-white">{value}</strong>
        </div>
      ))}
    </div>
  );
}

function AssignmentCompleteness({ data }: { data: OperationTaskReconciliationResponse }) {
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Assignment completeness propus">
      {data.review.assignmentCompleteness.map((slice) => (
        <article className="min-w-0 rounded-md border border-white/10 bg-focus-ink/40 p-3" key={slice.id}>
          <div className="flex items-start justify-between gap-2">
            <span className="text-[10px] font-black uppercase text-slate-400">{slice.label}</span>
            {slice.target !== null ? <span className="text-[10px] text-slate-500">Țintă {slice.target}%</span> : null}
          </div>
          <strong className="mt-2 block text-2xl text-white">{slice.completeness}%</strong>
          <p className="mt-1 text-xs text-slate-400">{slice.assigned} atribuite · {slice.unassigned} nealocate · {slice.total} total</p>
          <span className="mt-2 inline-flex rounded bg-amber-300/10 px-2 py-1 text-[10px] font-black text-amber-100">POLITICĂ NEACTIVATĂ</span>
        </article>
      ))}
    </div>
  );
}

function ReviewFilters({ data }: { data: OperationTaskReconciliationResponse }) {
  return (
    <form className="mt-4 grid gap-3 rounded-lg border border-focus-line bg-focus-ink/40 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" method="get">
      <input name="panel" type="hidden" value="operation-task-reconciliation" />
      <input name="entity" type="hidden" value={data.scope.entitySelection} />
      <input name="snapshot" type="hidden" value={data.scope.snapshotDate} />
      <FilterSelect label="Prioritate" name="priority" value={data.filters.priority}>
        <option value="ALL">Toate prioritățile</option>
        {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </FilterSelect>
      <FilterSelect label="Grup review" name="reviewGroup" value={data.filters.reviewGroup}>
        <option value="ALL">Toate grupurile</option>
        {Object.entries(reviewGroupLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </FilterSelect>
      <FilterSelect label="Confidence" name="confidence" value={data.filters.confidence}>
        <option value="ALL">Orice confidence</option>
        <option value="HIGH">Ridicat, minimum 80%</option>
        <option value="MEDIUM">Mediu, 50–79%</option>
        <option value="LOW">Redus, sub 50%</option>
      </FilterSelect>
      <FilterSelect label="Mediu" name="medium" value={data.filters.medium}>
        <option value="ALL">Toate mediile</option>
        <option value="STATIC">Static</option>
        <option value="DIGITAL">Digital</option>
        <option value="MIXED">Mixt</option>
        <option value="UNKNOWN">Necunoscut</option>
      </FilterSelect>
      <FilterSelect label="Status task" name="status" value={data.filters.status}>
        <option value="">Toate statusurile</option>
        {Object.keys(data.summary.byStatus).map((value) => <option key={value} value={value}>{value}</option>)}
      </FilterSelect>
      <FilterInput label="Campanie" name="campaign" placeholder="Nume sau ID" value={data.filters.campaign} />
      <FilterInput label="Locație" name="location" placeholder="Cod sau ID" value={data.filters.location} />
      <FilterInput label="Anomalie" name="anomalyCode" placeholder="ex. DONE_PROOF_MISSING" value={data.filters.anomalyCode} />
      <FilterInput label="Perioadă de la" name="periodFrom" type="date" value={data.filters.periodFrom} />
      <FilterInput label="Perioadă până la" name="periodTo" type="date" value={data.filters.periodTo} />
      <button className="focus-button min-h-11 self-end justify-center sm:col-span-2 lg:col-span-1" type="submit">
        <Filter size={17} /> Aplică filtrele
      </button>
    </form>
  );
}

function FilterSelect({ label, name, value, children }: { label: string; name: string; value: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-xs font-black uppercase text-slate-300">
      {label}
      <select className="focus-input min-h-11 w-full" defaultValue={value} name={name}>{children}</select>
    </label>
  );
}

function FilterInput({ label, name, value, placeholder, type = "text" }: { label: string; name: string; value: string; placeholder?: string; type?: string }) {
  return (
    <label className="grid gap-1 text-xs font-black uppercase text-slate-300">
      {label}
      <input className="focus-input min-h-11 w-full" defaultValue={value} name={name} placeholder={placeholder} type={type} />
    </label>
  );
}

function ReviewCaseCard({ item }: { item: OperationCutoverCase }) {
  return (
    <article className="min-w-0 rounded-lg border border-sky-300/20 bg-sky-400/[0.045] p-4">
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex min-h-7 items-center rounded px-2 text-[10px] font-black uppercase ${priorityTone(item.priority)}`}>
              {priorityLabels[item.priority]}
            </span>
            <span className="rounded border border-white/10 px-2 py-1 text-[10px] font-black uppercase text-slate-300">
              {reviewGroupLabels[item.reviewGroup]}
            </span>
            <span className="text-[11px] text-slate-400">Confidence {item.confidence}% · completitudine {item.dataCompleteness}%</span>
          </div>
          <h3 className="mt-3 break-words text-base font-black text-white">
            {item.locationCode || "Locație necunoscută"} · {item.campaignName || "Campanie neidentificată"}
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-300">{item.proposedAction}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
            <span>Caz: <strong className="break-all text-slate-200">{item.stableCaseId}</strong></span>
            <span>Entitate: <strong className="text-slate-200">{item.companyEntityLabel}</strong></span>
            <span>Tip: <strong className="text-slate-200">{item.taskType}</strong></span>
            <span>Status: <strong className="text-slate-200">{item.taskStatus}</strong></span>
            <span>Mediu: <strong className="text-slate-200">{item.mediaClassification}</strong></span>
            <span>Assignment: <strong className="text-slate-200">{item.assignedToLabel}</strong></span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {item.anomalyCodes.map((code) => (
              <span className="rounded bg-white/5 px-2 py-1 text-[10px] font-bold text-slate-300" key={code}>{code}</span>
            ))}
          </div>
        </div>
        <Link className="focus-button secondary min-h-11 justify-center self-start" href={item.deepLink} prefetch={false}>
          <ExternalLink size={16} /> Verifică sursa
        </Link>
      </div>
      <details className="mt-4 border-t border-white/10 pt-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-xs font-black text-focus-yellow">
          <FileSearch size={16} /> Dovezi, risc și clasificare
        </summary>
        <div className="grid gap-4 pb-2 pt-3 lg:grid-cols-2">
          <div className="grid gap-2">
            {item.evidence.map((entry) => (
              <div className="flex min-w-0 justify-between gap-3 border-b border-white/5 pb-2 text-xs" key={`${entry.label}-${entry.value}`}>
                <span className="text-slate-400">{entry.label}</span>
                <strong className="max-w-[65%] break-words text-right text-slate-200">{entry.value}</strong>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-white/10 bg-focus-ink/45 p-3 text-xs leading-5 text-slate-300">
            <p><strong className="text-white">Clasificare propusă:</strong> {item.proposedClassification}</p>
            <p className="mt-2"><strong className="text-white">Risc:</strong> {item.risk}</p>
            <p className="mt-2"><strong className="text-white">Eligibilitate KPI:</strong> {item.proposedMetricsEligibility.eligible ? "DA, propus" : "NU, propus"}</p>
            <p className="mt-1 text-slate-400">{item.proposedMetricsEligibility.reasonCodes.join(" · ")}</p>
          </div>
        </div>
      </details>
    </article>
  );
}

function ReviewPagination({ data }: { data: OperationTaskReconciliationResponse }) {
  const pagination = data.review.pagination;
  if (!pagination.previousCursor && !pagination.nextCursor) return null;
  return (
    <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Paginare reconciliere">
      {pagination.previousCursor
        ? <Link className="focus-button secondary min-h-11" href={pageHref(data, pagination.previousCursor)} scroll={false}><ArrowLeft size={16} /> Înapoi</Link>
        : <span />}
      <span className="text-xs text-slate-400">{pagination.returned} din {data.review.filteredCaseCount}</span>
      {pagination.nextCursor
        ? <Link className="focus-button secondary min-h-11" href={pageHref(data, pagination.nextCursor)} scroll={false}>Următoarele <ArrowRight size={16} /></Link>
        : <span />}
    </nav>
  );
}

function ReviewArchitecture({ data }: { data: OperationTaskReconciliationResponse }) {
  return (
    <div className="mt-5 grid gap-3 xl:grid-cols-2">
      <details className="rounded-lg border border-white/10 bg-focus-ink/45 p-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-black text-white">
          <BarChart3 className="text-focus-yellow" size={17} /> Matrice static / digital
        </summary>
        <div className="mt-3 grid gap-2">
          {data.review.mediaMatrix.map((row) => (
            <div className="rounded border border-white/10 p-3 text-xs text-slate-300" key={row.locationType}>
              <div className="flex flex-wrap justify-between gap-2">
                <strong className="text-white">{row.locationType}</strong>
                <span>{row.locationCount} locații · {row.classification} · {row.confidence}%</span>
              </div>
              <p className="mt-2">Start: {row.startOperation}</p>
              <p>Final: {row.endOperation}</p>
              <p className="mt-1 text-slate-500">Exemple: {row.exampleCodes.join(", ") || "fără coduri"}</p>
            </div>
          ))}
        </div>
      </details>
      <details className="rounded-lg border border-white/10 bg-focus-ink/45 p-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-black text-white">
          <Info className="text-focus-yellow" size={17} /> Cutover și loturi propuse
        </summary>
        <div className="mt-3 grid gap-2 text-xs leading-5 text-slate-300">
          {data.review.remediationBatches.map((batch) => (
            <div className="rounded border border-white/10 p-3" key={batch.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-white">Lot {batch.id} · {batch.label}</strong>
                <span>{batch.caseCount} cazuri</span>
              </div>
              <p className="mt-2">{batch.futureMutation}</p>
              <span className="mt-2 inline-flex min-h-7 items-center gap-1 rounded bg-sky-300/10 px-2 text-[10px] font-black uppercase text-sky-100">
                <ShieldCheck size={13} /> Neaprobat pentru execuție
              </span>
            </div>
          ))}
          <div className="rounded border border-emerald-300/15 bg-emerald-400/5 p-3">
            <strong className="text-emerald-100">Recomandare cutover</strong>
            <p className="mt-1">{data.review.cutoverOptions.find((row) => row.recommended)?.label}: după semn-off-ul cazurilor critice, fără rescrierea istoriei.</p>
          </div>
        </div>
      </details>
    </div>
  );
}

function pageHref(data: OperationTaskReconciliationResponse, cursor: string) {
  const params = reviewSearchParams(data);
  params.set("cursor", cursor);
  return `/admin/dashboard?${params.toString()}#operation-task-reconciliation`;
}

function exportHref(data: OperationTaskReconciliationResponse) {
  const params = reviewSearchParams(data);
  params.delete("panel");
  return `/api/admin/executive/operation-task-reconciliation/export?${params.toString()}`;
}

function reviewSearchParams(data: OperationTaskReconciliationResponse) {
  return new URLSearchParams({
    panel: "operation-task-reconciliation",
    entity: data.scope.entitySelection,
    snapshot: data.scope.snapshotDate,
    priority: data.filters.priority,
    reviewGroup: data.filters.reviewGroup,
    confidence: data.filters.confidence,
    medium: data.filters.medium,
    status: data.filters.status,
    campaign: data.filters.campaign,
    location: data.filters.location,
    anomalyCode: data.filters.anomalyCode,
    periodFrom: data.filters.periodFrom,
    periodTo: data.filters.periodTo
  });
}

function priorityTone(priority: OperationCutoverPriority) {
  if (priority === "CRITICAL_CURRENT") return "bg-red-300/15 text-red-100";
  if (priority === "RECENT_RELEVANT") return "bg-amber-300/15 text-amber-100";
  return "bg-slate-300/10 text-slate-200";
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
