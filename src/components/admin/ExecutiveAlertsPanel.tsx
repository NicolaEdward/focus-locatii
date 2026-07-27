import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Filter,
  Info,
  ShieldAlert
} from "lucide-react";
import type {
  ExecutiveAlert,
  ExecutiveAlertDomain,
  ExecutiveAlertSeverity,
  ExecutiveAlertsResponse
} from "@/lib/dashboard/executive/alerts-contracts";

const severityLabels: Record<ExecutiveAlertSeverity, string> = {
  P0: "P0 · Critical",
  P1: "P1 · High",
  P2: "P2 · Warning",
  DATA_QUALITY: "Data Quality"
};

const domainLabels: Record<ExecutiveAlertDomain, string> = {
  FINANCE: "Financiar",
  CAMPAIGNS: "Campanii",
  HOLD: "HOLD",
  OPERATIONS: "Operațional",
  CRM: "CRM",
  INVENTORY: "Inventar"
};

export function ExecutiveAlertsPanel({ data }: { data: ExecutiveAlertsResponse }) {
  return (
    <section className="scroll-mt-28 rounded-lg border border-focus-line bg-focus-navy/45 p-4 sm:p-5" id="executive-alerts">
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-3 border-b border-focus-line pb-4">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase text-focus-yellow">Motor determinist · read-only</p>
          <h2 className="mt-1 text-2xl font-black text-white">Executive Alerts</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Semnalele sunt calculate din starea canonică și dispar automat când predicatul nu mai este adevărat.
          </p>
        </div>
        <div className="flex min-h-10 items-center gap-2 text-xs text-emerald-200">
          <Clock3 size={16} />
          <span>asOf {dateTimeLabel(data.meta.asOf)}</span>
        </div>
      </header>

      <AlertSummary data={data} />
      <AlertFilters data={data} />

      <div className="mt-4 grid gap-3" aria-live="polite">
        {data.items.length
          ? data.items.map((alert) => <AlertCard alert={alert} readOnly={data.role === "D_CEO"} key={alert.id} />)
          : <div className="flex min-h-28 items-center gap-3 rounded-lg border border-dashed border-focus-line px-4 text-sm text-slate-300">
              <CheckCircle2 className="text-emerald-300" size={22} />
              Nu există alerte pentru filtrele selectate.
            </div>}
      </div>

      <AlertPagination data={data} />

      <details className="mt-5 rounded-lg border border-white/10 bg-focus-ink/45 p-3 text-sm text-slate-300">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-black text-white">
          <Info className="text-focus-yellow" size={17} />
          Reguli dezactivate și dependențe
        </summary>
        <div className="mt-3 grid gap-2">
          {data.disabledRules.map((rule) => (
            <div className="rounded-md border border-white/10 p-3" key={rule.ruleType}>
              <strong className="text-xs text-amber-100">{rule.ruleType}</strong>
              <p className="mt-1 text-xs leading-5 text-slate-400">{rule.reason}</p>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

function AlertSummary({ data }: { data: ExecutiveAlertsResponse }) {
  const rows: Array<[string, number, string]> = [
    ["Total", data.summary.total, "text-white"],
    ["P0", data.summary.bySeverity.P0, "text-red-200"],
    ["P1", data.summary.bySeverity.P1, "text-orange-200"],
    ["P2", data.summary.bySeverity.P2, "text-amber-200"],
    ["Data Quality", data.summary.bySeverity.DATA_QUALITY, "text-sky-200"]
  ];
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Rezumat alerte">
      {rows.map(([label, value, color]) => (
        <div className="min-h-20 rounded-md border border-white/10 bg-focus-ink/55 p-3" key={label}>
          <span className="text-[11px] font-black uppercase text-slate-400">{label}</span>
          <strong className={`mt-2 block text-2xl ${color}`}>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function AlertFilters({ data }: { data: ExecutiveAlertsResponse }) {
  return (
    <form className="mt-4 grid gap-3 rounded-lg border border-focus-line bg-focus-ink/40 p-3 sm:grid-cols-2 xl:grid-cols-5" method="get">
      <input name="panel" type="hidden" value="alerts" />
      <input name="entity" type="hidden" value={data.scope.entitySelection} />
      <input name="snapshot" type="hidden" value={data.scope.snapshotDate} />
      <FilterSelect label="Severitate" name="severity" value={data.filters.severity}>
        <option value="ALL">Toate severitățile</option>
        {Object.entries(severityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </FilterSelect>
      <FilterSelect label="Domeniu" name="domain" value={data.filters.domain}>
        <option value="ALL">Toate domeniile</option>
        {Object.entries(domainLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </FilterSelect>
      <FilterSelect label="Responsabil" name="owner" value={data.filters.owner}>
        <option value="">Toți responsabilii</option>
        <option value="UNASSIGNED">Nealocat</option>
        {data.filterOptions.owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.label}</option>)}
      </FilterSelect>
      <FilterSelect label="Calitatea datelor" name="dataQuality" value={data.filters.dataQuality}>
        <option value="ALL">Toate nivelurile</option>
        <option value="HIGH">High</option>
        <option value="MEDIUM">Medium</option>
        <option value="LOW">Low</option>
        <option value="DATA_INSUFFICIENT">Date insuficiente</option>
      </FilterSelect>
      <button className="focus-button min-h-11 self-end justify-center" type="submit">
        <Filter size={17} /> Aplică filtrele
      </button>
      {data.filters.ruleType !== "ALL" ? <input name="ruleType" type="hidden" value={data.filters.ruleType} /> : null}
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

function AlertCard({ alert, readOnly }: { alert: ExecutiveAlert; readOnly: boolean }) {
  return (
    <article className={`min-w-0 rounded-lg border p-4 ${alertTone(alert.severity)}`}>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge value={alert.severity} />
            <span className="rounded border border-white/10 px-2 py-1 text-[10px] font-black uppercase text-slate-300">
              {domainLabels[alert.domain]}
            </span>
            <span className="text-[11px] text-slate-400">Confidence {alert.confidence}% · {alert.dataQualityState}</span>
          </div>
          <h3 className="mt-3 text-base font-black text-white">{alert.title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-300">{alert.summary}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
            <span>Entitate: <strong className="text-slate-200">{alert.entityLabel}</strong></span>
            <span>Responsabil: <strong className="text-slate-200">{alert.responsibleLabel}</strong></span>
            <span>Termen: <strong className="text-slate-200">{alert.dueAt ? dateTimeLabel(alert.dueAt) : "Fără termen canonic"}</strong></span>
            <span>Vechime: <strong className="text-slate-200">{alert.age.label}</strong></span>
            <span>Apariții: <strong className="text-slate-200">{alert.occurrenceCount}</strong></span>
          </div>
        </div>
        <div className="flex min-w-44 flex-col justify-between gap-3 lg:items-end">
          <div className="text-left lg:text-right">
            <span className="block text-[10px] font-black uppercase text-slate-400">{alert.impact.label}</span>
            <strong className="mt-1 block text-base text-white">{impactLabel(alert)}</strong>
          </div>
          <Link className="focus-button secondary min-h-11 justify-center" href={alert.deepLink} prefetch={false}>
            <ExternalLink size={16} /> {readOnly ? "Verifică" : "Deschide sursa"}
          </Link>
        </div>
      </div>

      <details className="mt-4 border-t border-white/10 pt-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-xs font-black text-focus-yellow">
          <AlertCircle size={16} /> Evidence și acțiune recomandată
        </summary>
        <div className="grid gap-4 pb-2 pt-2 lg:grid-cols-2">
          <div className="grid gap-2">
            {alert.evidence.map((item) => (
              <div className="flex min-w-0 justify-between gap-3 border-b border-white/5 pb-2 text-xs" key={`${item.label}-${item.value}`}>
                <span className="text-slate-400">{item.label}</span>
                <strong className="max-w-[65%] break-words text-right text-slate-200">{item.value}</strong>
              </div>
            ))}
          </div>
          <div>
            <p className="text-xs font-black uppercase text-slate-400">Acțiune recomandată</p>
            <p className="mt-2 text-sm leading-6 text-slate-200">{alert.recommendedAction}</p>
            {readOnly ? <p className="mt-2 text-xs text-sky-200">Informativ pentru D-CEO. Nicio acțiune nu este executată din acest panou.</p> : null}
            {alert.sourceRefs.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {alert.sourceRefs.slice(0, 10).map((source) => (
                  <Link className="inline-flex min-h-9 items-center rounded border border-white/10 px-2 text-xs text-slate-200 hover:border-focus-yellow" href={source.href} key={source.id} prefetch={false}>
                    {source.label}
                  </Link>
                ))}
                {alert.occurrenceCount > alert.sourceRefs.length
                  ? <span className="inline-flex min-h-9 items-center px-2 text-xs text-slate-400">+{alert.occurrenceCount - alert.sourceRefs.length} în modulul sursă</span>
                  : null}
              </div>
            ) : null}
          </div>
        </div>
      </details>
    </article>
  );
}

function AlertPagination({ data }: { data: ExecutiveAlertsResponse }) {
  if (!data.pagination.previousCursor && !data.pagination.nextCursor) return null;
  return (
    <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Paginare alerte">
      {data.pagination.previousCursor
        ? <Link className="focus-button secondary min-h-11" href={alertPageHref(data, data.pagination.previousCursor)} scroll={false}><ArrowLeft size={16} /> Înapoi</Link>
        : <span />}
      <span className="text-xs text-slate-400">{data.pagination.returned} din {data.summary.total}</span>
      {data.pagination.nextCursor
        ? <Link className="focus-button secondary min-h-11" href={alertPageHref(data, data.pagination.nextCursor)} scroll={false}>Următoarele <ArrowRight size={16} /></Link>
        : <span />}
    </nav>
  );
}

function SeverityBadge({ value }: { value: ExecutiveAlertSeverity }) {
  const icon = value === "P0" ? <ShieldAlert size={14} /> : <AlertCircle size={14} />;
  return <span className={`inline-flex min-h-7 items-center gap-1 rounded px-2 text-[10px] font-black uppercase ${severityTone(value)}`}>{icon}{severityLabels[value]}</span>;
}

function alertPageHref(data: ExecutiveAlertsResponse, cursor: string) {
  const params = new URLSearchParams({
    panel: "alerts",
    entity: data.scope.entitySelection,
    snapshot: data.scope.snapshotDate,
    severity: data.filters.severity,
    domain: data.filters.domain,
    owner: data.filters.owner,
    dataQuality: data.filters.dataQuality,
    cursor
  });
  if (data.filters.ruleType !== "ALL") params.set("ruleType", data.filters.ruleType);
  return `/admin/dashboard?${params.toString()}#executive-alerts`;
}

function impactLabel(alert: ExecutiveAlert) {
  if (alert.impact.amount) return `${money(alert.impact.amount)} ${alert.impact.currency || ""}`.trim();
  if (alert.impact.count != null) return new Intl.NumberFormat("ro-RO").format(alert.impact.count);
  return alert.impact.kind;
}

function money(value: string) {
  return new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
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

function alertTone(severity: ExecutiveAlertSeverity) {
  if (severity === "P0") return "border-red-300/35 bg-red-500/10";
  if (severity === "P1") return "border-orange-300/30 bg-orange-400/[0.08]";
  if (severity === "P2") return "border-amber-300/25 bg-amber-300/[0.06]";
  return "border-sky-300/20 bg-sky-400/[0.05]";
}

function severityTone(severity: ExecutiveAlertSeverity) {
  if (severity === "P0") return "bg-red-400/20 text-red-100";
  if (severity === "P1") return "bg-orange-400/20 text-orange-100";
  if (severity === "P2") return "bg-amber-300/20 text-amber-100";
  return "bg-sky-300/15 text-sky-100";
}
