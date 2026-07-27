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
    <main className="focus-shell min-w-0 py-4 sm:py-5">
      <div className="focus-container min-w-0 space-y-4">
        <header className="grid min-w-0 gap-3 border-b border-focus-line pb-4 xl:grid-cols-[minmax(260px,0.8fr)_minmax(360px,1.2fr)_auto] xl:items-end">
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
          <ExecutiveGlobalSearch />
          <div className="flex flex-wrap items-end justify-between gap-2 xl:justify-end">
            <Freshness asOf={data.meta.asOf} stale={data.meta.stale} />
            {data.viewer.canUseQuickActions ? <QuickActions /> : null}
          </div>
        </header>

        <ExecutiveFilters data={data} />

        <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1.15fr)_minmax(280px,0.8fr)]" aria-labelledby="executive-priority-title">
          <h2 className="sr-only" id="executive-priority-title">Priorități executive</h2>
          <FactPanel
            eyebrow="Probleme de business"
            title="Executive Alerts"
            rows={data.alertPreview.slice(0, 3)}
            empty="Nu există alerte deterministe pentru scope-ul selectat."
            asOf={data.meta.asOf}
          />
          <AttentionPanel rows={data.attentionPreview.slice(0, 3)} asOf={data.meta.asOf} />
          <PulsePanel data={data} />
        </section>

        <section className="min-w-0" aria-labelledby="executive-overview-title">
          <h2 className="sr-only" id="executive-overview-title">Rezumat executiv</h2>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              icon={<BriefcaseBusiness size={19} />}
              label="Campanii active"
              value={data.summary.activeCampaigns}
              detail="Status efectiv la snapshot"
              href={`/admin/campanii?effectiveStatus=ACTIVE`}
              asOf={data.meta.asOf}
              tone="green"
            />
            <MetricCard
              icon={<ShieldAlert size={19} />}
              label="Campanii în risc"
              value={data.summary.campaignRisks}
              detail="Numai reguli deterministe"
              href="/admin/dashboard?panel=campaign-risks#campaign-risks"
              asOf={data.meta.asOf}
              tone={data.summary.campaignRisks ? "red" : "green"}
            />
            <MetricCard
              icon={<CircleGauge size={19} />}
              label="Grad ocupare"
              value={inventory.occupancyRate == null ? "N/A" : `${formatNumber(inventory.occupancyRate)}%`}
              detail={`${inventory.booked} BOOKED din ${inventory.eligible} suporturi eligibile · inventar comun`}
              href="/admin/dashboard?panel=inventory#inventory-breakdown"
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

        <TodayStrip data={data} />

        {data.alerts ? <ExecutiveAlertsPanel data={data.alerts} /> : (
          <div className="flex justify-end">
            <Link className="focus-button secondary min-h-11" href="/admin/dashboard?panel=alerts#executive-alerts" prefetch={false}>
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

function AttentionPanel({ rows, asOf }: { rows: ExecutiveOverview["attentionPreview"]; asOf: string }) {
  return (
    <section className="min-w-0 rounded-lg border border-focus-yellow/35 bg-focus-navy/55 p-4">
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
      <Link className="mt-3 flex min-h-10 items-center justify-end gap-2 text-xs font-black text-focus-yellow hover:text-white" href="/admin/dashboard?panel=alerts#executive-alerts" prefetch={false}>Vezi toate situațiile <ArrowRight size={15} /></Link>
    </section>
  );
}

function TodayStrip({ data }: { data: ExecutiveOverview }) {
  const inventory = data.summary.inventory;
  const items = [
    { label: "BOOKED-uri active", value: inventory.activeBookedReservations, href: "/admin/locatii?rscope=active&rstatus=BOOKED", icon: <CheckCircle2 size={16} /> },
    { label: "HOLD-uri active", value: inventory.activeHoldReservations, href: "/admin/locatii?rscope=active&rstatus=HOLD", icon: <TimerReset size={16} /> },
    { label: "Decorări astăzi", value: data.summary.operationsToday.decorations, href: "/admin/operational?panel=decorations", icon: <Hammer size={16} />, quality: data.summary.operationsToday.confidence },
    { label: "Neutralizări astăzi", value: data.summary.operationsToday.neutralizations, href: "/admin/operational?panel=neutralizations", icon: <Wrench size={16} />, quality: data.summary.operationsToday.confidence }
  ];
  return (
    <section aria-labelledby="today-overview-title">
      <div className="mb-2 flex items-center justify-between gap-3"><h2 className="text-xs font-black uppercase text-slate-400" id="today-overview-title">Astăzi</h2><span className="text-[11px] text-slate-500">Fiecare valoare deschide sursa</span></div>
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <Link className="min-h-20 rounded-md border border-focus-line bg-focus-ink/55 p-3 hover:border-focus-yellow" href={item.href} key={item.label} prefetch={false}>
            <span className="flex items-center justify-between gap-2 text-[10px] font-black uppercase text-slate-400">{item.label}{item.icon}</span>
            <strong className="mt-2 block text-xl text-white">{item.value}</strong>
            {item.quality != null ? <small className="text-[10px] text-amber-200">C {item.quality}%</small> : null}
          </Link>
        ))}
      </div>
    </section>
  );
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
    <section className="h-full min-w-0 rounded-lg border border-focus-yellow/55 bg-[linear-gradient(145deg,rgba(8,34,55,0.98),rgba(3,19,34,0.96))] p-4 shadow-focus" aria-labelledby="company-pulse-title">
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
    return (
      <article className="rounded-md border border-white/10 bg-white/[0.035] px-3 py-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
          <strong className="truncate text-xs text-white">{label}</strong>
          <span className="shrink-0 text-[10px] font-black text-slate-300">C {pulse.totalConfidence}%</span>
          <span className={`truncate text-xs font-black ${pulse.overallScore == null ? "text-amber-100" : "text-emerald-200"}`}>
            {pulse.overallScore == null ? "Date insuficiente" : `${pulse.overallScore}%`}
          </span>
          <span className="shrink-0 text-[10px] text-slate-500">{pulse.trend.direction === "UNAVAILABLE" ? "Trend indisponibil" : `${pulse.trend.delta || 0}%`}</span>
        </div>
        {factor ? (
          <Link className="mt-1 flex min-h-8 items-center justify-between gap-2 rounded px-1 text-[11px] text-slate-300 hover:bg-white/[0.04] hover:text-white" href={factor.href} prefetch={false}>
            <span className="truncate">{factor.label}</span>
            <strong className={`shrink-0 ${factor.tone === "critical" ? "text-red-200" : factor.tone === "warning" ? "text-amber-200" : "text-slate-300"}`}>{factor.count}</strong>
          </Link>
        ) : null}
      </article>
    );
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
  href: string;
  asOf: string;
  tone: "neutral" | "green" | "yellow" | "red";
  quality?: string;
}) {
  const color = { neutral: "text-white", green: "text-emerald-200", yellow: "text-focus-yellow", red: "text-red-200" }[tone];
  return (
    <Link className="group flex min-h-32 min-w-0 flex-col rounded-lg border border-focus-line bg-focus-ink/65 p-3 transition hover:border-focus-yellow hover:bg-focus-ink" href={href} prefetch={false}>
      <div className="flex items-center justify-between gap-2 text-slate-400"><span className="text-xs font-black uppercase">{label}</span>{icon}</div>
      <strong className={`mt-3 block break-words text-2xl font-black ${color}`}>{value}</strong>
      <span className="mt-2 block text-xs leading-5 text-slate-400">{detail}</span>
      {quality ? <span className="mt-2 block text-[11px] font-bold text-amber-200">{quality}</span> : null}
      <span className="mt-auto pt-3 text-[11px] text-slate-500">asOf {timeLabel(asOf)} · Deschide</span>
    </Link>
  );
}

function MoneyMetric({ icon, label, rows, empty, asOf, warning = false }: { icon: React.ReactNode; label: string; rows: ExecutiveMoney[]; empty: string; asOf: string; warning?: boolean }) {
  return (
    <article className="flex min-h-32 min-w-0 flex-col rounded-lg border border-focus-line bg-focus-ink/65 p-3">
      <div className="flex items-center justify-between gap-2 text-slate-400"><h3 className="text-xs font-black uppercase">{label}</h3>{icon}</div>
      <div className="mt-3 grid gap-2">
        {rows.length ? rows.map((row) => (
          <Link className="flex min-h-9 min-w-0 items-center justify-between gap-2 border-t border-white/10 pt-2 text-xs hover:text-focus-yellow" href={row.href} key={`${row.entityCode}-${row.currency}`} prefetch={false}>
            <span className="min-w-0 truncate text-slate-300">{row.entityLabel} · {row.count}</span>
            <strong className={warning ? "shrink-0 text-red-100" : "shrink-0 text-emerald-200"}>{moneyLabel(row.amount, row.currency)}</strong>
          </Link>
        )) : <p className="text-xs leading-5 text-slate-400">{empty}</p>}
      </div>
      <span className="mt-auto pt-3 text-[11px] text-slate-500">asOf {timeLabel(asOf)}</span>
    </article>
  );
}

function FactPanel({ eyebrow, title, rows, empty, asOf }: { eyebrow: string; title: string; rows: ExecutiveFactItem[]; empty: string; asOf: string }) {
  return (
    <section className="min-w-0 rounded-lg border border-focus-line bg-focus-navy/45 p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><p className="text-xs font-black uppercase text-focus-yellow">{eyebrow}</p><h2 className="mt-1 text-xl font-black text-white">{title}</h2></div>
        <span className="text-[11px] text-slate-500">asOf {timeLabel(asOf)}</span>
      </div>
      <div className="mt-4 grid gap-2">
        {rows.length ? rows.map((row) => <FactRow key={row.id} row={row} />) : <div className="flex min-h-20 items-center gap-3 rounded-md border border-dashed border-focus-line px-4 text-sm text-slate-400"><CheckCircle2 size={20} />{empty}</div>}
      </div>
      <Link className="mt-3 flex min-h-10 items-center justify-end gap-2 text-xs font-black text-focus-yellow hover:text-white" href="/admin/dashboard?panel=alerts#executive-alerts" prefetch={false}>Vezi toate alertele <ArrowRight size={15} /></Link>
    </section>
  );
}

function FactRow({ row }: { row: ExecutiveFactItem }) {
  const tone = row.severity === "critical" ? "border-red-300/30 bg-red-400/10" : row.severity === "warning" ? "border-amber-300/30 bg-amber-300/10" : "border-white/10 bg-white/[0.025]";
  return (
    <Link className={`grid min-h-16 min-w-0 gap-2 rounded-md border px-3 py-3 transition hover:border-focus-yellow sm:grid-cols-[minmax(0,1fr)_auto] ${tone}`} href={row.href} prefetch={false}>
      <span className="min-w-0"><strong className="block text-sm text-white">{row.label}</strong><small className="mt-1 block leading-5 text-slate-300">{row.detail}</small></span>
      <span className="flex items-center justify-between gap-3 sm:justify-end"><strong className="text-xl text-white">{row.count}</strong><small className="text-right text-[10px] font-black uppercase text-slate-400">{row.dataQuality}<br />C {row.confidence}%</small><ArrowRight size={15} className="text-focus-yellow" /></span>
    </Link>
  );
}

function InventoryBreakdown({ data }: { data: ExecutiveOverview }) {
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
