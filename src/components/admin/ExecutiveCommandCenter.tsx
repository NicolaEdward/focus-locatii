import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  CircleGauge,
  Clock3,
  FilePlus2,
  FileWarning,
  Hammer,
  MapPinned,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TimerReset,
  Wrench
} from "lucide-react";
import type {
  ExecutiveCampaignRisk,
  ExecutiveFactItem,
  ExecutiveMoney,
  ExecutiveOverview,
  ExecutivePulse
} from "@/lib/dashboard/executive/contracts";
import { ExecutiveAlertsPanel } from "@/components/admin/ExecutiveAlertsPanel";
import { ExecutiveActivityFeed, ExecutiveControlTabs } from "@/components/admin/ExecutiveControlTabs";
import { ExecutiveGlobalSearch } from "@/components/admin/ExecutiveGlobalSearch";
import { OperationTaskReconciliationPanel } from "@/components/admin/OperationTaskReconciliationPanel";

export function ExecutiveCommandCenter({ data }: { data: ExecutiveOverview }) {
  const scope = data.scope;
  const inventory = data.summary.inventory;
  return (
    <main className="focus-shell min-w-0 py-2 sm:py-3">
      <div className="focus-container min-w-0 space-y-3 xl:space-y-2">
        <header className="grid min-w-0 gap-2 border-b border-focus-line pb-2 xl:grid-cols-[minmax(260px,0.8fr)_minmax(360px,1.2fr)_auto] xl:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-black uppercase text-focus-yellow">Executive Command Center</p>
              <span className="rounded border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 text-[11px] font-black text-emerald-100">
                {data.role === "D_CEO" ? "D-CEO · READ-ONLY" : data.role}
              </span>
            </div>
            <h1 className="mt-1 font-display text-2xl font-black uppercase text-white sm:text-3xl">Control executiv</h1>
            <p className="mt-1 text-xs leading-5 text-slate-400">Ce necesită atenție acum, cu sursa și responsabilul verificabile. RON și EUR nu sunt însumate.</p>
          </div>
          <ExecutiveGlobalSearch data={data} />
          <div className="flex flex-wrap items-end justify-between gap-2 xl:justify-end">
            <Freshness asOf={data.meta.asOf} stale={data.meta.stale} />
            {data.viewer.canUseQuickActions ? <QuickActions /> : null}
          </div>
        </header>

        <ExecutiveFilters data={data} />

        <section className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1.15fr)_minmax(280px,0.8fr)]" aria-labelledby="executive-priority-title">
          <h2 className="sr-only" id="executive-priority-title">Priorități executive</h2>
          <FactPanel
            eyebrow="Probleme de business"
            title="Executive Alerts"
            rows={data.alertPreview.slice(0, 2)}
            empty="Nu există alerte deterministe pentru scope-ul selectat."
            asOf={data.meta.asOf}
            data={data}
          />
          <AttentionPanel rows={data.attentionPreview.slice(0, 2)} asOf={data.meta.asOf} data={data} />
          <PulsePanel data={data} />
        </section>

        <TodayStrip data={data} />

        <section className="min-w-0" aria-labelledby="executive-overview-title">
          <h2 className="sr-only" id="executive-overview-title">Rezumat executiv</h2>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              icon={<BriefcaseBusiness size={19} />}
              label="Campanii active"
              value={data.summary.activeCampaigns}
              detail="Status efectiv la snapshot"
              href={campaignListHref(data, { effectiveStatus: "ACTIVE" })}
              asOf={data.meta.asOf}
              tone="green"
            />
            <MetricCard
              icon={<ShieldAlert size={19} />}
              label="Campanii în risc"
              value={data.summary.campaignRisks}
              detail="Numai reguli deterministe"
              href={dashboardPanelHref(data, "campaign-risks", "campaign-risks")}
              asOf={data.meta.asOf}
              tone={data.summary.campaignRisks ? "red" : "green"}
            />
            <MetricCard
              icon={<CircleGauge size={19} />}
              label="Grad ocupare"
              value={data.summary.filterApplicability.inventory === "FILTER_NOT_APPLICABLE" || inventory.occupancyRate == null ? "N/A" : `${formatNumber(inventory.occupancyRate)}%`}
              detail={data.summary.filterApplicability.inventory === "FILTER_NOT_APPLICABLE"
                ? "Filtrul juridic nu se aplică inventarului comun."
                : `${inventory.booked} BOOKED din ${inventory.eligible} suporturi eligibile · inventar comun`}
              href={data.summary.filterApplicability.inventory === "FILTER_NOT_APPLICABLE"
                ? undefined
                : dashboardPanelHref(data, "inventory", "inventory-breakdown")}
              asOf={data.meta.asOf}
              tone="neutral"
            />
            <MoneyMetric
              icon={<Banknote size={19} />}
              label="Încasări"
              rows={data.summary.collectionsThisMonth}
              empty="Nu sunt încasări active în perioada selectată."
              asOf={data.meta.asOf}
            />
            <MoneyMetric
              icon={<FileWarning size={19} />}
              label="Facturi restante"
              rows={data.summary.overdueInvoices}
              empty="Nu sunt facturi restante validate."
              asOf={data.meta.asOf}
              warning
            />
            <MoneyMetric
              icon={<CalendarDays size={19} />}
              label="Scadente în 7 zile"
              rows={data.summary.dueWithinSevenDays}
              empty="Nu sunt facturi care ajung la scadență în 7 zile."
              asOf={data.meta.asOf}
              warning
            />
          </div>
        </section>

        {data.alerts ? <ExecutiveAlertsPanel data={data.alerts} /> : (
          <div className="flex justify-end">
            <Link className="focus-button secondary min-h-11" href={dashboardPanelHref(data, "alerts", "executive-alerts")} prefetch={false}>
              <ShieldAlert size={17} /> Vezi toate alertele
            </Link>
          </div>
        )}

        {data.operationTaskReconciliation
          ? <OperationTaskReconciliationPanel data={data.operationTaskReconciliation} />
          : null}

        <ExecutiveControlTabs data={data} />
        <ExecutiveActivityFeed data={data} />

        {scope.panel === "inventory" ? <InventoryBreakdown data={data} /> : null}
        {scope.panel === "campaign-risks" ? <CampaignRiskDetails data={data} /> : null}
        {scope.panel?.startsWith("operations-today-") ? <OperationsTodayDetails data={data} /> : null}
      </div>
    </main>
  );
}

function QuickActions() {
  return (
    <details className="relative">
      <summary className="focus-button secondary min-h-11 cursor-pointer list-none"><Plus size={17} /> Acțiuni rapide</summary>
      <div className="absolute right-0 top-[calc(100%+8px)] z-40 grid w-64 gap-1 rounded-lg border border-focus-line bg-focus-navy p-2 shadow-2xl">
        <Link className="flex min-h-11 items-center gap-2 rounded px-3 text-sm font-bold text-white hover:bg-white/[0.06]" href="/admin/locatii?newReservation=1" prefetch={false}><MapPinned size={17} className="text-focus-yellow" /> Rezervare nouă</Link>
        <Link className="flex min-h-11 items-center gap-2 rounded px-3 text-sm font-bold text-white hover:bg-white/[0.06]" href="/admin/campanii?create=1" prefetch={false}><BriefcaseBusiness size={17} className="text-focus-yellow" /> Campanie nouă</Link>
        <Link className="flex min-h-11 items-center gap-2 rounded px-3 text-sm font-bold text-white hover:bg-white/[0.06]" href="/admin/crm?view=pipeline" prefetch={false}><FilePlus2 size={17} className="text-focus-yellow" /> Deschide CRM</Link>
        <Link className="flex min-h-11 items-center gap-2 rounded px-3 text-sm font-bold text-white hover:bg-white/[0.06]" href="/admin/operational" prefetch={false}><Wrench size={17} className="text-focus-yellow" /> Deschide operațional</Link>
      </div>
    </details>
  );
}

function AttentionPanel({ rows, asOf, data }: { rows: ExecutiveOverview["attentionPreview"]; asOf: string; data: ExecutiveOverview }) {
  return (
    <section className="min-w-0 rounded-lg border border-focus-yellow/35 bg-focus-navy/55 p-3">
      <div className="flex items-end justify-between gap-3">
        <div><p className="text-xs font-black uppercase text-focus-yellow">Management by exception</p><h2 className="mt-1 text-xl font-black text-white">Necesită atenția mea</h2></div>
        <span className="text-[11px] text-slate-500">Top {rows.length} · asOf {timeLabel(asOf)}</span>
      </div>
      <div className="mt-3 grid gap-2">
        {rows.length ? rows.map((row, index) => (
          <Link className="grid min-h-16 grid-cols-[26px_minmax(0,1fr)_auto] items-start gap-2 rounded-md border border-white/10 bg-focus-ink/45 p-3 hover:border-focus-yellow" href={row.href} key={row.id} prefetch={false}>
            <span className={`grid h-6 w-6 place-items-center rounded text-[11px] font-black ${row.severity === "P0" ? "bg-red-400/20 text-red-100" : row.severity === "P1" ? "bg-amber-300/20 text-amber-100" : "bg-white/10 text-slate-300"}`}>{index + 1}</span>
            <span className="min-w-0"><strong className="block truncate text-sm text-white">{row.title}</strong><small className="mt-1 block truncate text-slate-400">{row.responsibleLabel} · {row.why || row.domain}</small></span>
            <span className="text-right"><strong className="block text-xs text-amber-100">{row.impactLabel}</strong><small className="text-[10px] text-slate-500">{row.deadline ? dateLabel(row.deadline.slice(0, 10)) : `C ${row.confidence}%`}</small></span>
          </Link>
        )) : <div><div className="flex min-h-20 items-center gap-3 rounded-md border border-dashed border-focus-line px-4 text-sm text-slate-400"><CheckCircle2 size={20} />Nu există situații prioritare pentru scope-ul selectat.</div></div>}
      </div>
      <Link className="mt-2 flex min-h-9 items-center justify-end gap-2 text-xs font-black text-focus-yellow hover:text-white" href={dashboardPanelHref(data, "alerts", "executive-alerts")} prefetch={false}>Vezi toate situațiile <ArrowRight size={15} /></Link>
    </section>
  );
}

function TodayStrip({ data }: { data: ExecutiveOverview }) {
  const inventory = data.summary.inventory;
  const inventoryApplicable = data.summary.filterApplicability.inventory !== "FILTER_NOT_APPLICABLE";
  const items = [
    { label: "Campanii încep astăzi", value: data.summary.campaignsStartingToday, href: campaignListHref(data, { dateFilter: "STARTS_ON" }), icon: <CalendarDays size={16} /> },
    { label: "Campanii se încheie astăzi", value: data.summary.campaignsEndingToday, href: campaignListHref(data, { dateFilter: "ENDS_ON" }), icon: <CalendarDays size={16} /> },
    { label: "BOOKED-uri active", value: inventoryApplicable ? inventory.activeBookedReservations : "N/A", href: inventoryApplicable ? "/admin/locatii?rscope=active&rstatus=BOOKED" : undefined, icon: <CheckCircle2 size={16} />, note: inventoryApplicable ? undefined : "Filtrul juridic nu se aplică" },
    { label: "HOLD-uri active", value: inventoryApplicable ? inventory.activeHoldReservations : "N/A", href: inventoryApplicable ? "/admin/locatii?rscope=active&rstatus=HOLD" : undefined, icon: <TimerReset size={16} />, note: inventoryApplicable ? undefined : "Filtrul juridic nu se aplică" },
    { label: "Decorări astăzi", value: data.summary.operationsToday.decorations, href: dashboardPanelHref(data, "operations-today-decoration", "operations-today"), icon: <Hammer size={16} />, quality: data.summary.operationsToday.confidence },
    { label: "Neutralizări astăzi", value: data.summary.operationsToday.neutralizations, href: dashboardPanelHref(data, "operations-today-neutralization", "operations-today"), icon: <Wrench size={16} />, quality: data.summary.operationsToday.confidence }
  ];
  return (
    <section aria-labelledby="today-overview-title">
      <div className="mb-2 flex items-center justify-between gap-3"><h2 className="text-xs font-black uppercase text-slate-400" id="today-overview-title">Astăzi</h2><span className="text-[11px] text-slate-500">Fiecare valoare deschide sursa</span></div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {items.map((item) => (
          <TodayItem item={item} key={item.label} />
        ))}
      </div>
    </section>
  );
}

function TodayItem({ item }: {
  item: {
    label: string;
    value: string | number;
    href?: string;
    icon: React.ReactNode;
    quality?: number;
    note?: string;
  };
}) {
  const content = (
    <>
            <span className="flex items-center justify-between gap-2 text-[10px] font-black uppercase text-slate-400">{item.label}{item.icon}</span>
            <strong className="mt-1 block text-xl text-white">{item.value}</strong>
            {item.quality != null ? <small className="text-[10px] text-amber-200">C {item.quality}%</small> : null}
            {item.note ? <small className="block text-[10px] text-slate-500">{item.note}</small> : null}
    </>
  );
  const className = "min-h-14 rounded-md border border-focus-line bg-focus-ink/55 p-2.5";
  return item.href
    ? <Link className={`${className} hover:border-focus-yellow`} href={item.href} prefetch={false}>{content}</Link>
    : <article className={className}>{content}</article>;
}

function ExecutiveFilters({ data }: { data: ExecutiveOverview }) {
  return (
    <details className="rounded-lg border border-focus-line bg-focus-navy/55 p-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-white">
        <span className="flex items-center gap-2"><CalendarDays size={18} className="text-focus-yellow" /> Filtre executive</span>
        <small className="text-right text-[11px] text-slate-400">{scopeEntityLabel(data)} · {dateLabel(data.scope.snapshotDate)} · {periodPresetLabel(data.scope.periodPreset)}</small>
      </summary>
      <ExecutiveFilterForm data={data} compact />
    </details>
  );
}

function ExecutiveFilterForm({ data, compact = false }: { data: ExecutiveOverview; compact?: boolean }) {
  return (
    <form className={`${compact ? "mt-3 grid grid-cols-2" : "hidden md:grid md:grid-cols-2 xl:grid-cols-[1.1fr_repeat(4,minmax(135px,0.75fr))_auto]"} min-w-0 gap-3 rounded-lg ${compact ? "" : "border border-focus-line bg-focus-navy/55 p-3"}`} method="get">
      <label className={`grid gap-1 text-xs font-black uppercase text-slate-300 ${compact ? "col-span-2" : ""}`}>
        Entitate juridică
        <select className="focus-input min-h-11 w-full" defaultValue={data.scope.entitySelection} name="entity">
          <option value="ALL">Toate entitățile autorizate</option>
          {data.entities.map((entity) => <option key={entity.code} value={entity.code}>{entity.label}</option>)}
        </select>
      </label>
      <DateField label="Snapshot" name="snapshot" value={data.scope.snapshotDate} />
      <label className="grid gap-1 text-xs font-black uppercase text-slate-300">
        Perioadă
        <select className="focus-input min-h-11 w-full" defaultValue={data.scope.periodPreset} name="period">
          <option value="TODAY">Astăzi</option>
          <option value="WEEK">Săptămâna curentă</option>
          <option value="MONTH">Luna curentă</option>
          <option value="CUSTOM">Personalizat</option>
        </select>
      </label>
      <DateField label="Perioadă de la" name="periodStart" value={data.scope.periodStart} />
      <DateField label="Până la" name="periodEnd" value={data.scope.periodEnd} />
      <button className={`focus-button min-h-11 self-end ${compact ? "col-span-2" : ""}`} type="submit"><RefreshCw size={17} /> Actualizează</button>
      <p className={`text-xs leading-5 text-slate-400 ${compact ? "col-span-2" : "md:col-span-2 xl:col-span-6"}`}>
        Comparație: {dateLabel(data.scope.comparisonStart)} - {dateLabel(data.scope.comparisonEnd)} · Limite de business: Europe/Bucharest.
      </p>
    </form>
  );
}

function scopeEntityLabel(data: ExecutiveOverview) {
  if (data.scope.entitySelection === "ALL") return "Toate entitățile";
  return data.entities.find((entity) => entity.code === data.scope.entitySelection)?.label || data.scope.entitySelection;
}

function periodPresetLabel(value: ExecutiveOverview["scope"]["periodPreset"]) {
  return { TODAY: "Astăzi", WEEK: "Săptămână", MONTH: "Lună", CUSTOM: "Personalizat" }[value];
}

function DateField({ label, name, value }: { label: string; name: string; value: string }) {
  return <label className="grid gap-1 text-xs font-black uppercase text-slate-300">{label}<input className="focus-input min-h-11 w-full" defaultValue={value} name={name} type="date" /></label>;
}

function PulsePanel({ data }: { data: ExecutiveOverview }) {
  const compact = data.pulseByEntity.length > 1;
  return (
    <section className="theme-dark-panel h-full min-w-0 rounded-lg border border-focus-yellow/55 bg-[linear-gradient(145deg,rgba(8,34,55,0.98),rgba(3,19,34,0.96))] p-3 shadow-focus" aria-labelledby="company-pulse-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Confidence înainte de scor</p>
          <h2 className="mt-1 text-xl font-black text-white" id="company-pulse-title">Company Pulse</h2>
        </div>
        <Sparkles className="text-focus-yellow" size={22} />
      </div>
      <div className={`${compact ? "mt-3 gap-2" : "mt-5 gap-3"} grid`}>
        {data.pulseByEntity.map(({ entityCode, entityLabel, pulse }) => (
          <PulseEntity key={entityCode} label={entityLabel} pulse={pulse} compact={compact} />
        ))}
      </div>
      <Freshness asOf={data.meta.asOf} stale={data.meta.stale} compact />
    </section>
  );
}

function PulseEntity({ label, pulse, compact }: { label: string; pulse: ExecutivePulse; compact: boolean }) {
  if (compact) {
    const factor = pulse.mainFactors[0];
    const missingReason = pulse.missingData[0];
    const content = (
      <>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
          <strong className="truncate text-xs text-white">{label}</strong>
          <span className="shrink-0 text-[10px] font-black text-slate-300">C {pulse.totalConfidence}%</span>
          <span className={`truncate text-xs font-black ${pulse.overallScore == null ? "text-amber-100" : "text-emerald-200"}`}>
            {pulse.overallScore == null ? "Date insuficiente" : `${pulse.overallScore}%`}
          </span>
          <span className="max-w-48 truncate text-right text-[10px] text-slate-400" title={missingReason || pulse.trend.label}>
            {pulse.overallScore == null && missingReason
              ? `Lipsește: ${missingReason}`
              : pulse.trend.direction === "UNAVAILABLE"
                ? "Trend indisponibil"
                : `${pulse.trend.delta || 0}%`}
          </span>
        </div>
        {factor ? (
          <span className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-slate-300">
            <span className="truncate">{factor.label}</span>
            <strong className={`shrink-0 ${factor.tone === "critical" ? "text-red-200" : factor.tone === "warning" ? "text-amber-200" : "text-slate-300"}`}>{factor.count}</strong>
          </span>
        ) : null}
      </>
    );
    const className = "block min-h-12 rounded-md border border-white/10 bg-white/[0.035] px-2.5 py-1.5";
    return factor
      ? <Link className={`${className} hover:border-focus-yellow hover:bg-white/[0.05]`} href={factor.href} prefetch={false}>{content}</Link>
      : <article className={className}>{content}</article>;
  }
  return (
    <article className="rounded-md border border-white/10 bg-white/[0.035] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm text-white">{label}</strong>
        <span className="text-xs font-black text-slate-300">Încredere {pulse.totalConfidence}%</span>
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
        <span>
          <small className="block text-[10px] font-black uppercase text-slate-500">Overall health</small>
          <strong className={`${pulse.overallScore == null ? "text-amber-100" : "text-emerald-200"} text-2xl`}>
            {pulse.overallScore == null ? "Date insuficiente" : `${pulse.overallScore}%`}
          </strong>
        </span>
        <span className="max-w-52 text-right text-[11px] leading-4 text-slate-400">
          {pulse.trend.direction === "UNAVAILABLE" ? "Trend indisponibil" : `${pulse.trend.delta && pulse.trend.delta > 0 ? "▲" : pulse.trend.delta && pulse.trend.delta < 0 ? "▼" : "•"} ${pulse.trend.delta || 0}%`}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-400">{pulse.overallScore == null ? pulse.message : pulse.trend.label}</p>
      {pulse.mainFactors.length ? (
        <div className="mt-3 grid gap-1">
          <span className="text-[10px] font-black uppercase text-slate-500">Factori principali</span>
          {pulse.mainFactors.slice(0, 3).map((factor) => (
            <Link className="flex min-h-8 items-center justify-between gap-2 rounded px-2 text-xs text-slate-300 hover:bg-white/[0.04] hover:text-white" href={factor.href} key={factor.id} prefetch={false}>
              <span className="truncate">{factor.label}</span><strong className={factor.tone === "critical" ? "text-red-200" : factor.tone === "warning" ? "text-amber-200" : "text-slate-300"}>{factor.count}</strong>
            </Link>
          ))}
        </div>
      ) : null}
      <details className="mt-3">
        <summary className="flex min-h-10 cursor-pointer items-center text-xs font-black text-focus-yellow">Dimensiuni și confidence</summary>
        <div className="grid grid-cols-2 gap-2">
        {pulse.dimensions.map((dimension) => (
          <Link className="min-h-11 rounded border border-white/10 px-2 py-2 text-xs transition hover:border-focus-yellow" href={dimension.href} key={dimension.id} prefetch={false}>
            <span className="block font-black text-white">{dimension.label}</span>
            <span className="mt-1 block text-slate-400">{dimension.score == null ? "N/A" : `${dimension.score}/100`} · C {dimension.confidence}%</span>
          </Link>
        ))}
        </div>
      </details>
      {pulse.missingData.length ? <details className="mt-3 text-xs text-slate-300"><summary className="flex min-h-11 cursor-pointer items-center font-black text-focus-yellow">Ce lipsește</summary><ul className="mt-2 grid gap-1">{pulse.missingData.slice(0, 8).map((item) => <li key={item}>• {item}</li>)}</ul></details> : null}
    </article>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  href,
  asOf,
  tone,
  quality
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  detail: string;
  href?: string;
  asOf: string;
  tone: "neutral" | "green" | "yellow" | "red";
  quality?: string;
}) {
  const color = { neutral: "text-white", green: "text-emerald-200", yellow: "text-focus-yellow", red: "text-red-200" }[tone];
  const content = (
    <>
      <div className="flex items-center justify-between gap-2 text-slate-400"><span className="text-xs font-black uppercase">{label}</span>{icon}</div>
      <strong className={`mt-3 block break-words text-2xl font-black ${color}`}>{value}</strong>
      <span className="mt-2 block text-xs leading-5 text-slate-400">{detail}</span>
      {quality ? <span className="mt-2 block text-[11px] font-bold text-amber-200">{quality}</span> : null}
      <span className="mt-auto pt-3 text-[11px] text-slate-500">asOf {timeLabel(asOf)}{href ? " · Deschide" : ""}</span>
    </>
  );
  const className = "group flex min-h-32 min-w-0 flex-col rounded-lg border border-focus-line bg-focus-ink/65 p-3 transition";
  return href
    ? <Link className={`${className} hover:border-focus-yellow hover:bg-focus-ink`} href={href} prefetch={false}>{content}</Link>
    : <article className={className}>{content}</article>;
}

function MoneyMetric({ icon, label, rows, empty, asOf, warning = false }: { icon: React.ReactNode; label: string; rows: ExecutiveMoney[]; empty: string; asOf: string; warning?: boolean }) {
  return (
    <article className="flex min-h-32 min-w-0 flex-col rounded-lg border border-focus-line bg-focus-ink/65 p-3">
      <div className="flex items-center justify-between gap-2 text-slate-400"><h3 className="text-xs font-black uppercase">{label}</h3>{icon}</div>
      <div className="mt-3 grid gap-2">
        {rows.length ? rows.map((row) => (
          row.href ? (
            <Link className="flex min-h-9 min-w-0 items-center justify-between gap-2 border-t border-white/10 pt-2 text-xs hover:text-focus-yellow" href={row.href} key={`${row.entityCode}-${row.currency}`} prefetch={false}>
              <span className="min-w-0 truncate text-slate-300">{row.entityLabel} · {row.count}</span>
              <strong className={warning ? "shrink-0 text-red-100" : "shrink-0 text-emerald-200"}>{moneyLabel(row.amount, row.currency)}</strong>
            </Link>
          ) : (
            <div className="flex min-h-9 min-w-0 items-center justify-between gap-2 border-t border-white/10 pt-2 text-xs" key={`${row.entityCode}-${row.currency}`}>
              <span className="min-w-0 truncate text-slate-300">{row.entityLabel} · {row.count}</span>
              <strong className={warning ? "shrink-0 text-red-100" : "shrink-0 text-emerald-200"}>{moneyLabel(row.amount, row.currency)}</strong>
            </div>
          )
        )) : <p className="text-xs leading-5 text-slate-400">{empty}</p>}
      </div>
      <span className="mt-auto pt-3 text-[11px] text-slate-500">asOf {timeLabel(asOf)}{rows.some((row) => !row.href) ? " · drill-down retras când perioada nu poate fi reprodusă exact" : ""}</span>
    </article>
  );
}

function FactPanel({ eyebrow, title, rows, empty, asOf, data }: { eyebrow: string; title: string; rows: ExecutiveFactItem[]; empty: string; asOf: string; data: ExecutiveOverview }) {
  return (
    <section className="min-w-0 rounded-lg border border-focus-line bg-focus-navy/45 p-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><p className="text-xs font-black uppercase text-focus-yellow">{eyebrow}</p><h2 className="mt-1 text-xl font-black text-white">{title}</h2></div>
        <span className="text-[11px] text-slate-500">asOf {timeLabel(asOf)}</span>
      </div>
      <div className="mt-3 grid gap-2">
        {rows.length ? rows.map((row) => <FactRow key={row.id} row={row} />) : <div className="flex min-h-20 items-center gap-3 rounded-md border border-dashed border-focus-line px-4 text-sm text-slate-400"><CheckCircle2 size={20} />{empty}</div>}
      </div>
      <Link className="mt-2 flex min-h-9 items-center justify-end gap-2 text-xs font-black text-focus-yellow hover:text-white" href={dashboardPanelHref(data, "alerts", "executive-alerts")} prefetch={false}>Vezi toate alertele <ArrowRight size={15} /></Link>
    </section>
  );
}

function FactRow({ row }: { row: ExecutiveFactItem }) {
  const tone = row.severity === "critical" ? "border-red-300/30 bg-red-400/10" : row.severity === "warning" ? "border-amber-300/30 bg-amber-300/10" : "border-white/10 bg-white/[0.025]";
  const severityLabel = row.severityCode === "DATA_QUALITY"
    ? "Calitatea datelor"
    : row.severityCode || (row.severity === "critical" ? "Critic" : row.severity === "warning" ? "Avertizare" : "Informativ");
  const qualityLabel = {
    HIGH: "Date bune",
    MEDIUM: "Date medii",
    LOW: "Date reduse",
    DATA_INSUFFICIENT: "Date insuficiente"
  }[row.dataQuality];
  return (
    <Link className={`grid min-h-16 min-w-0 gap-2 rounded-md border px-3 py-3 transition hover:border-focus-yellow sm:grid-cols-[minmax(0,1fr)_auto] ${tone}`} href={row.href} prefetch={false}>
      <span className="min-w-0"><strong className="block text-sm text-white">{row.label}</strong><small className="mt-1 block leading-5 text-slate-300">{row.detail}</small></span>
      <span className="flex items-center justify-between gap-3 sm:justify-end"><strong className="text-xl text-white">{row.count}</strong><small className="text-right text-[10px] font-black uppercase text-slate-300">{severityLabel}<br /><span className="text-slate-500">{qualityLabel} · C {row.confidence}%</span></small><ArrowRight size={15} className="text-focus-yellow" /></span>
    </Link>
  );
}

function InventoryBreakdown({ data }: { data: ExecutiveOverview }) {
  if (data.summary.filterApplicability.inventory === "FILTER_NOT_APPLICABLE") {
    return (
      <section className="scroll-mt-40 rounded-lg border border-focus-line bg-focus-navy/40 p-4" id="inventory-breakdown">
        <p className="text-xs font-black uppercase text-focus-yellow">Inventar comun</p>
        <h2 className="mt-1 text-xl font-black text-white">Filtrul juridic nu se aplică</h2>
        <p className="mt-2 text-sm text-slate-300">Locațiile nu au o relație canonică cu o singură entitate juridică. Selectează „Toate entitățile” pentru partiția completă; nu afișăm date globale într-un context filtrat.</p>
      </section>
    );
  }
  const inventory = data.summary.inventory;
  const rows = [
    ["Inactive", inventory.inactive],
    ["Arhivate", inventory.archived],
    ["Mentenanță", inventory.maintenance],
    ["Lifecycle blocked", inventory.lifecycleBlocked],
    ["BOOKED", inventory.booked],
    ["HOLD", inventory.hold],
    ["Blocaj manual", inventory.manualUnavailable],
    ["Disponibile", inventory.available],
    ["Necunoscute", inventory.unknown]
  ] as const;
  return (
    <section className="scroll-mt-40 rounded-lg border border-focus-line bg-focus-navy/40 p-4" id="inventory-breakdown">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-black uppercase text-focus-yellow">Partiție mutual exclusivă</p><h2 className="mt-1 text-xl font-black text-white">Inventar la snapshot</h2></div>
        <span className="text-xs text-slate-400">Suma categoriilor: {rows.reduce((sum, row) => sum + row[1], 0)} / Total: {inventory.total}</span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-9">
        {rows.map(([label, value]) => <div className="min-h-20 rounded-md border border-white/10 bg-focus-ink/50 p-3" key={label}><span className="text-[11px] font-black uppercase text-slate-400">{label}</span><strong className="mt-2 block text-xl text-white">{value}</strong></div>)}
      </div>
      {inventory.lifecycleBookingConflicts ? <p className="mt-3 rounded-md border border-red-300/30 bg-red-400/10 p-3 text-sm text-red-100"><AlertTriangle className="mr-2 inline" size={17} />{inventory.lifecycleBookingConflicts} suporturi neeligibile au BOOKED activ. BOOKED-ul este vizibil ca excepție, dar suportul rămâne într-o singură categorie principală.</p> : null}
    </section>
  );
}

function CampaignRiskDetails({ data }: { data: ExecutiveOverview }) {
  if (!data.campaignRisks.length) return null;
  return (
    <section className="scroll-mt-40 rounded-lg border border-focus-line bg-focus-navy/40 p-4" id="campaign-risks">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-black uppercase text-focus-yellow">Drill-down</p><h2 className="mt-1 text-xl font-black text-white">Campanii în risc</h2></div>
        <span className="text-xs text-slate-400">Afișate {data.campaignRisks.length} din {data.summary.campaignRisks}</span>
      </div>
      <div className="mt-4 grid gap-2">
        {data.campaignRisks.map((risk) => <CampaignRiskRow key={risk.id} risk={risk} />)}
      </div>
    </section>
  );
}

function CampaignRiskRow({ risk }: { risk: ExecutiveCampaignRisk }) {
  return (
    <Link className="grid min-h-16 gap-2 rounded-md border border-white/10 bg-focus-ink/50 px-3 py-3 transition hover:border-focus-yellow md:grid-cols-[80px_minmax(0,1fr)_auto]" href={risk.href} prefetch={false}>
      <strong className={risk.severity === "P0" ? "text-red-200" : risk.severity === "P1" ? "text-amber-200" : "text-focus-yellow"}>{risk.severity}</strong>
      <span className="min-w-0"><strong className="block truncate text-white">{risk.campaignName}</strong><small className="block truncate text-slate-400">{risk.clientName} · {risk.effectiveStatus}</small></span>
      <span className="text-xs text-slate-300">{risk.reasonCodes.join(" · ")}</span>
    </Link>
  );
}

function OperationsTodayDetails({ data }: { data: ExecutiveOverview }) {
  const kind = data.scope.panel === "operations-today-neutralization" ? "NEUTRALIZATION" : "DECORATION";
  const rows = (data.operationsTodayDetails || []).filter((row) => row.kind === kind);
  return (
    <section className="scroll-mt-40 rounded-lg border border-focus-line bg-focus-navy/40 p-4" id="operations-today">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Drill-down exact</p>
          <h2 className="mt-1 text-xl font-black text-white">{kind === "DECORATION" ? "Decorări astăzi" : "Neutralizări astăzi"}</h2>
        </div>
        <span className="text-xs text-slate-400">{rows.length} rezultate · C {data.summary.operationsToday.confidence}%</span>
      </div>
      <p className="mt-2 text-xs text-slate-400">{data.summary.operationsToday.note}</p>
      <div className="mt-4 grid gap-2">
        {rows.length ? rows.map((row) => (
          <Link className="grid min-h-14 gap-2 rounded-md border border-white/10 bg-focus-ink/50 p-3 hover:border-focus-yellow md:grid-cols-[minmax(0,1fr)_minmax(180px,0.5fr)_auto]" href={row.href} key={row.id} prefetch={false}>
            <span><strong className="block text-white">{row.locationLabel}</strong><small className="text-slate-400">{row.campaignLabel}</small></span>
            <span className="text-sm text-slate-300">Responsabil client: <strong className="text-white">{row.responsibleLabel}</strong><small className="mt-0.5 block text-slate-500">Executor: {row.executorLabel}</small></span>
            <span className="text-xs font-black text-focus-yellow">{row.status}</span>
          </Link>
        )) : <div className="flex min-h-20 items-center gap-3 rounded border border-dashed border-focus-line px-4 text-sm text-slate-400"><CheckCircle2 size={19} />Nu există operațiuni de acest tip la snapshot.</div>}
      </div>
    </section>
  );
}

function Freshness({ asOf, stale, compact = false }: { asOf: string; stale: boolean; compact?: boolean }) {
  return <div className={`${compact ? "mt-3" : ""} flex min-h-8 items-center gap-2 text-xs ${stale ? "text-amber-200" : "text-emerald-200"}`}><Clock3 size={15} /><span>{stale ? "Date expirate" : "Date actuale"} · {dateTimeLabel(asOf)}</span></div>;
}

function moneyLabel(value: string, currency: string) {
  return `${new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 }).format(Number(value))} ${currency}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 1 }).format(value);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
}

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" }).format(new Date(value));
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" }).format(new Date(value));
}

function dashboardPanelHref(data: ExecutiveOverview, panel: string, hash?: string) {
  const params = executiveScopeParams(data);
  params.set("panel", panel);
  return `/admin/dashboard?${params}${hash ? `#${hash}` : ""}`;
}

function campaignListHref(
  data: ExecutiveOverview,
  filter: { effectiveStatus?: string; dateFilter?: "STARTS_ON" | "ENDS_ON" }
) {
  const params = new URLSearchParams({ snapshot: data.scope.snapshotDate });
  if (data.scope.entitySelection !== "ALL") params.set("entity", data.scope.entitySelection);
  if (filter.effectiveStatus) params.set("effectiveStatus", filter.effectiveStatus);
  if (filter.dateFilter) params.set("dateFilter", filter.dateFilter);
  return `/admin/campanii?${params}`;
}

function executiveScopeParams(data: ExecutiveOverview) {
  return new URLSearchParams({
    entity: data.scope.entitySelection,
    snapshot: data.scope.snapshotDate,
    period: data.scope.periodPreset,
    periodStart: data.scope.periodStart,
    periodEnd: data.scope.periodEnd
  });
}
