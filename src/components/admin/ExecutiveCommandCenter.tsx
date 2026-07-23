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
  FileWarning,
  Hammer,
  Layers3,
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

export function ExecutiveCommandCenter({ data }: { data: ExecutiveOverview }) {
  const scope = data.scope;
  const inventory = data.summary.inventory;
  return (
    <main className="focus-shell min-w-0 py-5 sm:py-7">
      <div className="focus-container min-w-0 space-y-5">
        <header className="grid min-w-0 gap-4 border-b border-focus-line pb-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-black uppercase text-focus-yellow">Executive Command Center</p>
              <span className="rounded border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 text-[11px] font-black text-emerald-100">
                {data.role === "D_CEO" ? "D-CEO · READ-ONLY" : data.role}
              </span>
            </div>
            <h1 className="mt-2 font-display text-3xl font-black uppercase text-white sm:text-4xl">Control executiv</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Situația companiei la data selectată, calculată din registrele canonice. Valorile RON și EUR nu sunt însumate între ele.
            </p>
          </div>
          <Freshness asOf={data.meta.asOf} stale={data.meta.stale} />
        </header>

        <ExecutiveFilters data={data} />

        <section className="grid min-w-0 gap-4 xl:grid-cols-12" aria-labelledby="executive-overview-title">
          <h2 className="sr-only" id="executive-overview-title">Rezumat executiv</h2>
          <div className="min-w-0 xl:col-span-4">
            <PulsePanel data={data} />
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:col-span-8 xl:grid-cols-3">
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
              label="Încasări în perioadă"
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
            <MetricCard
              icon={<Layers3 size={19} />}
              label="Inventar eligibil"
              value={inventory.eligible}
              detail={`${inventory.available} libere · ${inventory.hold} HOLD · ${inventory.booked} BOOKED`}
              href="/admin/dashboard?panel=inventory#inventory-breakdown"
              asOf={data.meta.asOf}
              tone="neutral"
            />
          </div>
        </section>

        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <FactPanel
            eyebrow="Semnale verificate"
            title="Executive Alerts preview"
            rows={data.alertPreview}
            empty="Nu există alerte deterministe pentru scope-ul selectat."
            asOf={data.meta.asOf}
          />
          <FactPanel
            eyebrow="Fluxuri care încetinesc"
            title="Business Bottlenecks preview"
            rows={data.bottleneckPreview}
            empty="Nu există blocaje verificabile în datele selectate."
            asOf={data.meta.asOf}
          />
        </div>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-labelledby="operational-snapshot-title">
          <h2 className="sr-only" id="operational-snapshot-title">Snapshot operațional</h2>
          <MetricCard icon={<Clock3 size={19} />} label="HOLD-uri active" value={inventory.activeHoldReservations} detail="Expirarea efectivă este aplicată" href="/admin/dashboard?panel=inventory#inventory-breakdown" asOf={data.meta.asOf} tone="yellow" />
          <MetricCard icon={<CheckCircle2 size={19} />} label="BOOKED-uri active" value={inventory.activeBookedReservations} detail="Rezervări active la snapshot" href="/admin/dashboard?panel=inventory#inventory-breakdown" asOf={data.meta.asOf} tone="green" />
          <MetricCard icon={<Hammer size={19} />} label="Decorări astăzi" value={data.summary.operationsToday.decorations} detail={data.summary.operationsToday.note} href="/admin/operational" asOf={data.meta.asOf} tone="neutral" quality={`${data.summary.operationsToday.dataQuality} · ${data.summary.operationsToday.confidence}% confidence`} />
          <MetricCard icon={<TimerReset size={19} />} label="Neutralizări astăzi" value={data.summary.operationsToday.neutralizations} detail={data.summary.operationsToday.note} href="/admin/operational" asOf={data.meta.asOf} tone="neutral" quality={`${data.summary.operationsToday.dataQuality} · ${data.summary.operationsToday.confidence}% confidence`} />
        </section>

        <InventoryBreakdown data={data} />
        <CampaignRiskDetails data={data} />
      </div>
    </main>
  );
}

function ExecutiveFilters({ data }: { data: ExecutiveOverview }) {
  return (
    <>
      <details className="rounded-lg border border-focus-line bg-focus-navy/55 p-3 md:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-white">
          <span className="flex items-center gap-2"><CalendarDays size={18} className="text-focus-yellow" /> Filtre executive</span>
          <small className="text-right text-[11px] text-slate-400">{scopeEntityLabel(data)} · {dateLabel(data.scope.snapshotDate)}</small>
        </summary>
        <ExecutiveFilterForm data={data} compact />
      </details>
      <ExecutiveFilterForm data={data} />
    </>
  );
}

function ExecutiveFilterForm({ data, compact = false }: { data: ExecutiveOverview; compact?: boolean }) {
  return (
    <form className={`${compact ? "mt-3 grid grid-cols-2" : "hidden md:grid md:grid-cols-2 xl:grid-cols-[1.1fr_repeat(3,minmax(150px,0.8fr))_auto]"} min-w-0 gap-3 rounded-lg ${compact ? "" : "border border-focus-line bg-focus-navy/55 p-4"}`} method="get">
      <label className={`grid gap-1 text-xs font-black uppercase text-slate-300 ${compact ? "col-span-2" : ""}`}>
        Entitate juridică
        <select className="focus-input min-h-11 w-full" defaultValue={data.scope.entitySelection} name="entity">
          <option value="ALL">Toate entitățile autorizate</option>
          {data.entities.map((entity) => <option key={entity.code} value={entity.code}>{entity.label}</option>)}
        </select>
      </label>
      <DateField label="Snapshot" name="snapshot" value={data.scope.snapshotDate} />
      <DateField label="Perioadă de la" name="periodStart" value={data.scope.periodStart} />
      <DateField label="Până la" name="periodEnd" value={data.scope.periodEnd} />
      <button className={`focus-button min-h-11 self-end ${compact ? "col-span-2" : ""}`} type="submit"><RefreshCw size={17} /> Actualizează</button>
      <p className={`text-xs leading-5 text-slate-400 ${compact ? "col-span-2" : "md:col-span-2 xl:col-span-5"}`}>
        Comparație: {dateLabel(data.scope.comparisonStart)} - {dateLabel(data.scope.comparisonEnd)} · Limite de business: Europe/Bucharest.
      </p>
    </form>
  );
}

function scopeEntityLabel(data: ExecutiveOverview) {
  if (data.scope.entitySelection === "ALL") return "Toate entitățile";
  return data.entities.find((entity) => entity.code === data.scope.entitySelection)?.label || data.scope.entitySelection;
}

function DateField({ label, name, value }: { label: string; name: string; value: string }) {
  return <label className="grid gap-1 text-xs font-black uppercase text-slate-300">{label}<input className="focus-input min-h-11 w-full" defaultValue={value} name={name} type="date" /></label>;
}

function PulsePanel({ data }: { data: ExecutiveOverview }) {
  return (
    <section className="h-full min-w-0 rounded-lg border border-focus-yellow/55 bg-[linear-gradient(145deg,rgba(8,34,55,0.98),rgba(3,19,34,0.96))] p-5 shadow-focus" aria-labelledby="company-pulse-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Confidence înainte de scor</p>
          <h2 className="mt-1 text-xl font-black text-white" id="company-pulse-title">Company Pulse</h2>
        </div>
        <Sparkles className="text-focus-yellow" size={22} />
      </div>
      <div className="mt-5 grid gap-3">
        {data.pulseByEntity.map(({ entityCode, entityLabel, pulse }) => (
          <PulseEntity key={entityCode} label={entityLabel} pulse={pulse} compact={data.pulseByEntity.length > 1} />
        ))}
      </div>
      <Freshness asOf={data.meta.asOf} stale={data.meta.stale} compact />
    </section>
  );
}

function PulseEntity({ label, pulse, compact }: { label: string; pulse: ExecutivePulse; compact: boolean }) {
  return (
    <article className="rounded-md border border-white/10 bg-white/[0.035] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm text-white">{label}</strong>
        <span className="text-xs font-black text-slate-300">Confidence {pulse.totalConfidence}%</span>
      </div>
      <p className={`mt-2 font-black ${pulse.overallScore == null ? "text-amber-100" : "text-emerald-200"} ${compact ? "text-sm" : "text-lg"}`}>
        {pulse.overallScore == null ? pulse.message : `${pulse.overallScore}/100`}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {pulse.dimensions.map((dimension) => (
          <Link className="min-h-11 rounded border border-white/10 px-2 py-2 text-xs transition hover:border-focus-yellow" href={dimension.href} key={dimension.id} prefetch={false}>
            <span className="block font-black text-white">{dimension.label}</span>
            <span className="mt-1 block text-slate-400">{dimension.score == null ? "N/A" : `${dimension.score}/100`} · C {dimension.confidence}%</span>
          </Link>
        ))}
      </div>
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
    <Link className="group flex min-h-40 min-w-0 flex-col rounded-lg border border-focus-line bg-focus-ink/65 p-4 transition hover:border-focus-yellow hover:bg-focus-ink" href={href} prefetch={false}>
      <div className="flex items-center justify-between gap-2 text-slate-400"><span className="text-xs font-black uppercase">{label}</span>{icon}</div>
      <strong className={`mt-4 block break-words text-3xl font-black ${color}`}>{value}</strong>
      <span className="mt-2 block text-xs leading-5 text-slate-400">{detail}</span>
      {quality ? <span className="mt-2 block text-[11px] font-bold text-amber-200">{quality}</span> : null}
      <span className="mt-auto pt-3 text-[11px] text-slate-500">asOf {timeLabel(asOf)} · Deschide</span>
    </Link>
  );
}

function MoneyMetric({ icon, label, rows, empty, asOf, warning = false }: { icon: React.ReactNode; label: string; rows: ExecutiveMoney[]; empty: string; asOf: string; warning?: boolean }) {
  return (
    <article className="flex min-h-40 min-w-0 flex-col rounded-lg border border-focus-line bg-focus-ink/65 p-4">
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
