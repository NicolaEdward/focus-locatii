import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileWarning,
  MapPinned,
  ReceiptText,
  ShieldAlert,
  TrendingUp,
  Wrench
} from "lucide-react";
import type { CooDashboardData, CooAttentionItem } from "@/lib/dashboard/coo-dashboard";

export function CooCommandCenter({ data }: { data: CooDashboardData }) {
  const ron = currencyRow(data, "RON");
  const eur = currencyRow(data, "EUR");
  return (
    <main className="focus-shell py-7">
      <div className="focus-container grid min-w-0 grid-cols-[minmax(0,1fr)] gap-7">
        <header className="flex flex-wrap items-end justify-between gap-5 border-b border-focus-line pb-6">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-focus-yellow">Centru de comandă COO</p>
            <h1 className="mt-1 font-display text-3xl font-black uppercase text-white sm:text-4xl">Rezumat executiv</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">Sănătatea companiei și excepțiile care cer o decizie. Date calculate live din registrele canonice.</p>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            <Link className="focus-button" href="/admin/financiar/incasari?status=overdue" prefetch={false}><ReceiptText size={18} /> Facturi scadente</Link>
            <Link className="focus-button secondary" href="/admin/operational" prefetch={false}><Wrench size={18} /> Operațional</Link>
          </div>
        </header>

        <section aria-labelledby="executive-summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <h2 className="sr-only" id="executive-summary">Indicatori executivi</h2>
          <ExecutiveCard icon={<CircleDollarSign size={19} />} label="Sold clienți" value={moneyPair(ron?.remaining, eur?.remaining)} detail={`${sumCounts(data.summary.finance, "invoiceCount")} facturi în registru`} href="/admin/financiar/incasari?status=open" tone="neutral" />
          <ExecutiveCard icon={<FileWarning size={19} />} label="Scadent acum" value={moneyPair(ron?.overdue, eur?.overdue)} detail={`${sumCounts(data.summary.finance, "overdueCount")} facturi depășite`} href="/admin/financiar/incasari?status=overdue" tone={sumCounts(data.summary.finance, "overdueCount") ? "red" : "green"} />
          <ExecutiveCard icon={<CalendarClock size={19} />} label="Urmează în 7 zile" value={moneyPair(ron?.dueSoon, eur?.dueSoon)} detail={`${sumCounts(data.summary.finance, "dueSoonCount")} facturi apropiate de scadență`} href="/admin/financiar/incasari?status=due_soon" tone="yellow" />
          <ExecutiveCard icon={<BriefcaseBusiness size={19} />} label="Campanii active" value={data.summary.campaigns.active} detail={`${data.summary.campaigns.startingSoon} încep în 7 zile`} href="/admin/campanii" tone="green" />
          <ExecutiveCard icon={<ShieldAlert size={19} />} label="Întârzieri operaționale" value={data.summary.operations.delayed} detail={`${data.summary.operations.pendingDecorations} decorări · ${data.summary.operations.pendingNeutralizations} neutralizări`} href="/admin/operational?panel=decorations" tone={data.summary.operations.delayed ? "red" : "green"} />
          <ExecutiveCard icon={<Clock3 size={19} />} label="HOLD-uri active" value={data.summary.holds.active} detail={`${data.summary.holds.expiringSoon} expiră în 3 zile`} href="/admin/locatii?panel=sales#rezervari" tone={data.summary.holds.expiringSoon ? "yellow" : "neutral"} />
          <ExecutiveCard icon={<MapPinned size={19} />} label="Ocupare inventar" value={`${data.summary.inventory.occupied} ocupate`} detail={`${data.summary.inventory.available} disponibile · ${data.summary.inventory.blocked} blocate`} href="/admin/locatii#locatii" tone="neutral" />
          <ExecutiveCard icon={<TrendingUp size={19} />} label="Comercial de urmărit" value={data.commercial.overdueFollowUps + data.commercial.missingNextStep} detail={`${data.commercial.overdueFollowUps} follow-up restante · ${data.commercial.missingNextStep} fără pas următor`} href="/admin/crm?view=today" tone={data.commercial.overdueFollowUps ? "yellow" : "green"} />
        </section>

        <section className="border-y border-focus-line py-6" aria-labelledby="attention-title">
          <SectionHeader eyebrow="Intervenții" title="Atenție azi" description="Ordonat după urgență. Fiecare semnal deschide direct fluxul în care se rezolvă." />
          <div className="mt-5 grid gap-2">
            {data.attention.length ? data.attention.map((item) => <AttentionRow item={item} key={item.id} />) : <EmptyState icon={<CheckCircle2 size={22} />} text="Nu există excepții urgente în datele disponibile." />}
          </div>
        </section>

        <section aria-labelledby="finance-title">
          <SectionHeader eyebrow="Registru canonic" title="Financiar" description="Facturat, încasat și restant fără date din vechiul dashboard SmartBill." action={<Link className="section-link" href="/admin/financiar/incasari" prefetch={false}>Deschide Facturi clienți <ArrowRight size={15} /></Link>} />
          <div className="mt-5 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="grid gap-3 sm:grid-cols-2">
              {data.financial.currencies.map((row) => <FinanceCurrencyCard key={row.currency} row={row} />)}
              {!data.financial.currencies.length ? <EmptyState icon={<Banknote size={22} />} text="Registrul nu conține facturi validate." /> : null}
            </div>
            <div className="overflow-hidden rounded-lg border border-focus-line bg-focus-ink/55">
              <div className="border-b border-focus-line px-4 py-3"><h3 className="text-sm font-black uppercase text-white">Aging restanțe</h3></div>
              <div className="divide-y divide-focus-line">
                {data.financial.aging.map((bucket) => <div className="grid grid-cols-[70px_1fr] gap-4 px-4 py-3 text-sm" key={bucket.label}><strong className="text-focus-yellow">{bucket.label}</strong><span className="text-right text-slate-200">{bucket.values.length ? bucket.values.map((value) => `${formatMoney(value.amount)} ${value.currency} (${value.count})`).join(" · ") : "0"}</span></div>)}
              </div>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto rounded-lg border border-focus-line">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-focus-navy/80 text-xs uppercase text-slate-400"><tr><th className="px-4 py-3">Client restant</th><th className="px-4 py-3">Facturi</th><th className="px-4 py-3 text-right">Sold</th><th className="px-4 py-3 text-right">Acțiune</th></tr></thead>
              <tbody>{data.financial.topOverdueClients.slice(0, 8).map((row) => <tr className="border-t border-focus-line" key={`${row.clientId}-${row.clientName}-${row.currency}`}><td className="px-4 py-3 font-bold text-white">{row.clientName}</td><td className="px-4 py-3 text-slate-300">{row.invoiceCount}</td><td className="px-4 py-3 text-right font-black text-red-100">{formatMoney(row.amount)} {row.currency}</td><td className="px-4 py-3 text-right"><Link className="section-link justify-end" href={row.href} prefetch={false}>Vezi <ArrowRight size={14} /></Link></td></tr>)}</tbody>
            </table>
            {!data.financial.topOverdueClients.length ? <p className="p-5 text-sm text-slate-400">Nu există clienți restanți.</p> : null}
          </div>
        </section>

        <div className="grid gap-7 border-t border-focus-line pt-7 xl:grid-cols-2">
          <section aria-labelledby="commercial-title">
            <SectionHeader eyebrow="Mișcare comercială" title="Comercial" description="Acțiuni reale din CRM și campanii. Media Plan nu este folosit ca sursă." action={<Link className="section-link" href="/admin/crm?view=today" prefetch={false}>Deschide CRM <ArrowRight size={15} /></Link>} />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniMetric label="Follow-up restante" value={data.commercial.overdueFollowUps} tone="red" />
              <MiniMetric label="Astăzi" value={data.commercial.dueTodayFollowUps} tone="yellow" />
              <MiniMetric label="Fără pas următor" value={data.commercial.missingNextStep} />
              <MiniMetric label="Câștigate luna" value={data.commercial.wonThisMonth} tone="green" />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <CampaignBrief title="Încep în 7 zile" rows={data.commercial.startingSoon} />
              <CampaignBrief title="Se termină în 7 zile" rows={data.commercial.endingSoon} />
            </div>
          </section>

          <section aria-labelledby="operations-title">
            <SectionHeader eyebrow="Execuție" title="Operațional" description="Doar lucrări active și întârzieri; istoricul rămâne în workspace-ul operațional." action={<Link className="section-link" href="/admin/operational" prefetch={false}>Deschide operațional <ArrowRight size={15} /></Link>} />
            <div className="mt-4 grid gap-2">
              {data.operations.delayed.length ? data.operations.delayed.slice(0, 6).map((row) => <OperationRow key={row.id} row={row} />) : <EmptyState icon={<CheckCircle2 size={22} />} text="Nu există lucrări întârziate." />}
            </div>
          </section>
        </div>

        <section className="border-t border-focus-line pt-7" aria-labelledby="inventory-title">
          <SectionHeader eyebrow="Capacitate OOH" title="Inventar" description="Rezumat agregat; lista completă rămâne în modulul Locații." action={<Link className="section-link" href="/admin/locatii#locatii" prefetch={false}>Gestionează inventarul <ArrowRight size={15} /></Link>} />
          <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <MiniMetric label="Total intern" value={data.inventory.total} />
            <MiniMetric label="Disponibile" value={data.inventory.available} tone="green" />
            <MiniMetric label="Ocupate" value={data.inventory.occupied} />
            <MiniMetric label="HOLD" value={data.inventory.held} tone="yellow" />
            <MiniMetric label="Blocate" value={data.inventory.blocked} tone="red" />
            <MiniMetric label="Fără schiță" value={data.inventory.missingSketch} />
          </div>
        </section>

        <section className="border-t border-focus-line pt-7" aria-labelledby="decisions-title">
          <SectionHeader eyebrow="Reguli de business" title="Decizii recomandate" description="Recomandări explicabile, generate numai când există date verificabile." />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {data.decisions.length ? data.decisions.map((item) => <Link className={`flex items-center justify-between gap-3 rounded-lg border p-4 text-sm font-bold transition hover:border-focus-yellow ${item.tone === "red" ? "border-red-300/35 bg-red-500/10" : item.tone === "yellow" ? "border-amber-300/35 bg-amber-400/10" : "border-focus-line bg-focus-ink/55"}`} href={item.href} key={item.id} prefetch={false}><span>{item.text}</span><span className="inline-flex shrink-0 items-center gap-1 text-focus-yellow">{item.actionLabel}<ArrowRight size={14} /></span></Link>) : <EmptyState icon={<CheckCircle2 size={22} />} text="Nu există decizii excepționale recomandate acum." />}
          </div>
        </section>

        <p className="text-right text-xs text-slate-500">Actualizat {formatDateTime(data.generatedAt)}</p>
      </div>
    </main>
  );
}

function ExecutiveCard({ icon, label, value, detail, href, tone }: { icon: React.ReactNode; label: string; value: string | number; detail: string; href: string; tone: "neutral" | "green" | "yellow" | "red" }) {
  const toneClass = { neutral: "text-white", green: "text-emerald-200", yellow: "text-focus-yellow", red: "text-red-200" }[tone];
  return <Link className="group min-h-36 min-w-0 rounded-lg border border-focus-line bg-focus-ink/65 p-4 transition hover:border-focus-yellow hover:bg-focus-ink" href={href} prefetch={false}><div className="flex items-center justify-between text-slate-400"><span className="text-xs font-black uppercase">{label}</span>{icon}</div><strong className={`mt-4 block break-words text-2xl font-black ${toneClass}`}>{value}</strong><span className="mt-2 block text-xs leading-5 text-slate-400">{detail}</span><span className="mt-3 inline-flex items-center gap-1 text-xs font-black text-focus-yellow opacity-80 group-hover:opacity-100">Deschide <ArrowRight size={13} /></span></Link>;
}

function SectionHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex min-w-0 flex-wrap items-end justify-between gap-3"><div className="min-w-0"><p className="text-xs font-black uppercase text-focus-yellow">{eyebrow}</p><h2 className="mt-1 text-2xl font-black text-white">{title}</h2><p className="mt-1 max-w-3xl text-sm text-slate-400">{description}</p></div>{action}</div>;
}

function AttentionRow({ item }: { item: CooAttentionItem }) {
  const tone = item.urgency === "critical" ? "border-red-300/35 bg-red-500/10" : item.urgency === "high" ? "border-amber-300/35 bg-amber-400/10" : "border-focus-line bg-focus-ink/55";
  return <article className={`grid gap-3 rounded-lg border px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] ${tone}`}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge value={kindLabel(item.kind)} tone={item.urgency === "critical" ? "red" : item.urgency === "high" ? "yellow" : "neutral"} /><strong className="text-sm text-white">{item.title}</strong>{item.owner ? <span className="text-xs text-slate-400">Responsabil: {item.owner}</span> : null}</div><p className="mt-1 text-sm text-slate-300">{item.reason}</p></div><div className="flex flex-wrap items-center gap-4 md:justify-end">{item.amount ? <strong className="text-sm text-white">{formatMoney(item.amount)} {item.currency}</strong> : null}{item.dueDate ? <time className="text-xs font-bold text-slate-300">{formatDate(item.dueDate)}</time> : null}<Link className="section-link" href={item.href} prefetch={false}>{item.actionLabel}<ArrowRight size={14} /></Link></div></article>;
}

function FinanceCurrencyCard({ row }: { row: CooDashboardData["financial"]["currencies"][number] }) {
  return <article className="rounded-lg border border-focus-line bg-focus-ink/55 p-4"><div className="flex items-center justify-between"><h3 className="font-black text-white">{row.currency}</h3><span className="rounded bg-focus-yellow px-2 py-1 text-xs font-black text-focus-navy">{row.invoiceCount} facturi</span></div><div className="mt-4 grid grid-cols-2 gap-4 text-sm"><MoneyStat label="Facturat" value={row.invoiced} currency={row.currency} /><MoneyStat label="Încasat" value={row.collected} currency={row.currency} tone="green" /><MoneyStat label="Sold" value={row.remaining} currency={row.currency} /><MoneyStat label="Scadent" value={row.overdue} currency={row.currency} tone={row.overdueCount ? "red" : "green"} /></div></article>;
}

function MoneyStat({ label, value, currency, tone = "neutral" }: { label: string; value: string; currency: string; tone?: "neutral" | "green" | "red" }) {
  const color = tone === "green" ? "text-emerald-200" : tone === "red" ? "text-red-200" : "text-white";
  return <div><span className="text-xs uppercase text-slate-400">{label}</span><strong className={`mt-1 block ${color}`}>{formatMoney(value)} {currency}</strong></div>;
}

function MiniMetric({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "green" | "yellow" | "red" }) {
  const color = { neutral: "text-white", green: "text-emerald-200", yellow: "text-focus-yellow", red: "text-red-200" }[tone];
  return <div className="min-h-24 rounded-lg border border-focus-line bg-focus-ink/55 p-4"><span className="text-xs font-black uppercase text-slate-400">{label}</span><strong className={`mt-2 block text-2xl font-black ${color}`}>{value}</strong></div>;
}

function CampaignBrief({ title, rows }: { title: string; rows: CooDashboardData["commercial"]["startingSoon"] }) {
  return <div className="rounded-lg border border-focus-line bg-focus-ink/55 p-4"><h3 className="text-sm font-black uppercase text-white">{title}</h3><div className="mt-3 grid gap-2">{rows.length ? rows.slice(0, 4).map((row) => <Link className="group flex items-center justify-between gap-3 border-t border-focus-line pt-2 text-sm" href={row.href} key={row.id} prefetch={false}><span className="min-w-0"><strong className="block truncate text-slate-100">{row.clientName}</strong><small className="block truncate text-slate-400">{row.campaignName} · {row.owner || "Fără responsabil"}</small></span><time className="shrink-0 text-xs font-bold text-focus-yellow">{row.date ? formatDate(row.date) : "-"}</time></Link>) : <p className="text-sm text-slate-400">Nicio campanie.</p>}</div></div>;
}

function OperationRow({ row }: { row: CooDashboardData["operations"]["delayed"][number] }) {
  return <Link className="flex items-center justify-between gap-3 rounded-lg border border-red-300/25 bg-red-500/10 px-4 py-3 text-sm transition hover:border-focus-yellow" href={row.href} prefetch={false}><span className="min-w-0"><strong className="block truncate text-white">{row.locationCode} · {row.clientName}</strong><small className="block truncate text-slate-400">{row.kind === "decoration" ? "Decorare" : "Neutralizare"} · {row.campaignName || "Fără campanie"} · {row.owner || "Fără responsabil"}</small></span><span className="shrink-0 text-right"><time className="block font-black text-red-100">{row.taskDate ? formatDate(row.taskDate) : "-"}</time><small className="text-slate-400">{row.proofPhotoCount} dovezi</small></span></Link>;
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) { return <div className="flex items-center gap-3 rounded-lg border border-dashed border-focus-line px-4 py-6 text-sm text-slate-400">{icon}{text}</div>; }
function Badge({ value, tone }: { value: string; tone: "neutral" | "yellow" | "red" }) { const colors = tone === "red" ? "border-red-300/40 bg-red-400/10 text-red-100" : tone === "yellow" ? "border-amber-300/40 bg-amber-400/10 text-amber-100" : "border-slate-400/30 bg-slate-400/10 text-slate-200"; return <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${colors}`}>{value}</span>; }
function kindLabel(value: CooAttentionItem["kind"]) { return ({ finance: "Financiar", campaign: "Campanie", operation: "Operațional", hold: "HOLD", crm: "CRM" })[value]; }
function currencyRow(data: CooDashboardData, currency: string) { return data.summary.finance.find((row) => row.currency === currency); }
function sumCounts(rows: CooDashboardData["summary"]["finance"], key: "invoiceCount" | "overdueCount" | "dueSoonCount") { return rows.reduce((sum, row) => sum + row[key], 0); }
function moneyPair(ron?: string, eur?: string) { return `${formatMoney(ron)} RON / ${formatMoney(eur)} EUR`; }
function formatMoney(value?: string | null) { return new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 }).format(Number(value || 0)); }
function formatDate(value: string) { return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" }).format(new Date(value)); }
