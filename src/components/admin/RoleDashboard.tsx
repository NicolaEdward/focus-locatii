import Link from "next/link";
import { AlertTriangle, ArrowRight, BriefcaseBusiness, Building2, CalendarClock, CircleDollarSign, Hammer, MapPinned, ShieldCheck, Undo2, Users } from "lucide-react";
import type { DashboardData } from "@/lib/dashboard";
import type { AuthSession } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/rbac";
import { CooCommandCenter } from "@/components/admin/CooCommandCenter";
import { DashboardHoldActions } from "@/components/admin/DashboardHoldActions";
import { FinancialDashboardPanel } from "@/components/admin/FinancialDashboardPanel";
import { adminCampaignHref, adminNewReservationHref, adminOperationalHref, adminReservationHref, adminReservationsHref } from "@/lib/admin-routes";

export function RoleDashboard({ session, data }: { session: AuthSession; data: DashboardData }) {
  if (session.role === "COO") return <CooCommandCenter data={data} />;
  if (session.role === "FINANCE_OPERATOR") {
    return (
      <main className="focus-shell py-8">
        <div className="focus-container grid gap-6">
          <section className="border-b border-focus-line pb-5">
            <p className="text-xs font-black uppercase text-focus-yellow">{ROLE_LABELS[session.role]}</p>
            <h1 className="font-display text-4xl font-black uppercase">Financiar</h1>
            <p className="mt-2 text-sm text-slate-400">Upload, preview si validare raport zilnic.</p>
          </section>
          <OperationsPreview data={data.coo} compact />
          <FinancialDashboardPanel financial={data.finance} />
        </div>
      </main>
    );
  }

  const kpis = dashboardKpis(session.role, data);
  const showHoldActions =
    ["SALES_AGENT", "SALES_DIRECTOR", "SUPER_ADMIN"].includes(session.role) &&
    (session.role === "SALES_AGENT" || data.coo.holds.length > 0 || data.coo.expiredHolds.length > 0);

  return (
    <main className="focus-shell py-8">
      <div className="focus-container grid gap-6">
        <section className="flex flex-wrap items-end justify-between gap-4 border-b border-focus-line pb-5">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">{ROLE_LABELS[session.role]}</p>
            <h1 className="font-display text-4xl font-black uppercase">Buna, {session.name.split(" ")[0]}</h1>
            <p className="mt-2 text-sm text-slate-400">Date actualizate pentru {data.monthLabel}.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="focus-button" href="/admin/locatii">
              <MapPinned size={18} /> Vezi inventarul
            </Link>
            <Link className="focus-button secondary" href={adminNewReservationHref()}>
              <BriefcaseBusiness size={18} /> Actiune comerciala
            </Link>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((item) => (
            <article className="rounded-lg border border-focus-line bg-focus-ink/70 p-4" key={item.label}>
              <div className="flex items-center justify-between gap-3 text-slate-400">
                <span className="text-xs font-black uppercase">{item.label}</span>
                {item.icon}
              </div>
              <p className={`mt-3 text-3xl font-black ${item.tone}`}>{item.value}</p>
              <p className="mt-1 text-xs text-slate-400">{item.detail}</p>
            </article>
          ))}
        </section>

        {data.alerts.length ? (
          <section className="grid gap-2" aria-label="Alerte">
            {data.alerts.map((alert) => (
              <div className="flex items-center gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm" key={alert.label}>
                <AlertTriangle className="h-5 w-5 shrink-0 text-focus-yellow" />
                <span>{alert.label}</span>
              </div>
            ))}
          </section>
        ) : null}

        {showHoldActions ? (
          <DashboardHoldActions session={session} activeHolds={data.coo.holds} expiredHolds={data.coo.expiredHolds} />
        ) : null}

        <OperationsPreview data={data.coo} />

        <section className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
          <DashboardTable title={session.role === "SALES_AGENT" ? "Activitatea mea recenta" : "Campanii recente"} rows={data.recentCampaigns} />
          <div className="grid content-start gap-5">
            <Pipeline data={data.offerPipeline} />
            {session.role === "SUPER_ADMIN" ? <UsersSummary data={data.usersByRole} /> : null}
            {session.role === "SALES_DIRECTOR" ? <Ranking title="Performanta agenti" rows={data.agentPerformance} /> : null}
            {session.role === "SALES_AGENT" ? <DashboardTable title="Campanii care urmeaza" rows={data.upcomingCampaigns} compact /> : null}
          </div>
        </section>

        {data.auditLogs.length ? (
          <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-5">
            <h2 className="text-sm font-black uppercase text-focus-yellow">Activitate recenta</h2>
            <div className="mt-4 grid gap-2">
              {data.auditLogs.map((item) => (
                <div className="grid gap-1 border-b border-focus-line py-2 text-sm sm:grid-cols-[1fr_auto]" key={item.id}>
                  <span><strong>{item.actor}</strong> · {item.action} · {item.entityType}</span>
                  <time className="text-slate-400">{formatDateTime(item.createdAt)}</time>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function dashboardKpis(role: AuthSession["role"], data: DashboardData) {
  if (role === "SALES_AGENT") return [
    { label: "Lead-uri deschise", value: data.totals.openLeads, detail: "Solicitari care cer follow-up", icon: <Users size={18} />, tone: "text-white" },
    { label: "Hold-uri active", value: data.totals.pendingApprovals, detail: "Rezervari interne in asteptare", icon: <CalendarClock size={18} />, tone: "text-focus-yellow" },
    { label: "Campanii active", value: data.totals.active, detail: "In portofoliul propriu", icon: <BriefcaseBusiness size={18} />, tone: "text-emerald-300" },
    { label: "Vanzari luna", value: euro(data.totals.confirmedRevenue), detail: "Valoare confirmata pro-rata", icon: <CircleDollarSign size={18} />, tone: "text-white" }
  ];
  if (role === "SALES_DIRECTOR") return [
    { label: "Vanzari luna", value: euro(data.totals.confirmedRevenue), detail: "Valoare confirmata pro-rata", icon: <CircleDollarSign size={18} />, tone: "text-white" },
    { label: "Hold-uri", value: data.totals.pendingApprovals, detail: "Necesita decizie comerciala", icon: <CalendarClock size={18} />, tone: "text-focus-yellow" },
    { label: "Campanii viitoare", value: data.totals.future, detail: "Sortate dupa data de start", icon: <BriefcaseBusiness size={18} />, tone: "text-emerald-300" },
    { label: "Lead-uri deschise", value: data.totals.openLeads, detail: "Pipeline activ", icon: <Users size={18} />, tone: "text-white" }
  ];
  if (role === "COO") return [
    { label: "Ocupare inventar", value: `${data.totals.occupancyPercent}%`, detail: `${data.totals.occupied} din ${data.totals.locations} locatii`, icon: <Building2 size={18} />, tone: "text-white" },
    { label: "Campanii active", value: data.totals.active, detail: `${data.totals.future} urmeaza`, icon: <BriefcaseBusiness size={18} />, tone: "text-emerald-300" },
    { label: "Necesita atentie", value: data.totals.atRisk + data.totals.conflicts, detail: "Riscuri si conflicte", icon: <AlertTriangle size={18} />, tone: "text-focus-yellow" },
    { label: "Venit confirmat", value: euro(data.totals.confirmedRevenue), detail: "Luna curenta, pro-rata", icon: <CircleDollarSign size={18} />, tone: "text-white" }
  ];
  return [
    { label: "Utilizatori activi", value: data.totals.activeUsers, detail: `${data.totals.users} conturi totale`, icon: <Users size={18} />, tone: "text-white" },
    { label: "Inventar public", value: data.totals.locations, detail: `${data.totals.available} disponibile acum`, icon: <MapPinned size={18} />, tone: "text-emerald-300" },
    { label: "Conflicte", value: data.totals.conflicts, detail: "Suprapuneri active detectate", icon: <AlertTriangle size={18} />, tone: "text-focus-yellow" },
    { label: "Sistem", value: "Operational", detail: "Baza de date si sesiune active", icon: <ShieldCheck size={18} />, tone: "text-white" }
  ];
}

function OperationsPreview({ data, compact = false }: { data: DashboardData["coo"]; compact?: boolean }) {
  const rows = [
    ...data.decorationTasks.map((item) => ({ ...item, label: "Decorare", icon: <Hammer className="h-4 w-4 text-focus-yellow" /> })),
    ...data.neutralizationTasks.map((item) => ({ ...item, label: "Neutralizare", icon: <Undo2 className="h-4 w-4 text-focus-yellow" /> }))
  ]
    .sort((a, b) => new Date(a.taskDate).getTime() - new Date(b.taskDate).getTime())
    .slice(0, compact ? 4 : 8);

  return (
    <section className="overflow-hidden rounded-lg border border-focus-line bg-focus-ink/70">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-focus-line px-5 py-4">
        <div>
          <h2 className="text-sm font-black uppercase text-focus-yellow">Decorari si neutralizari</h2>
          <p className="mt-1 text-xs font-bold text-slate-400">Vizibil pentru toata echipa, ca sa fie clar ce urmeaza operational.</p>
        </div>
        {!compact ? (
          <Link className="inline-flex items-center gap-1 text-xs font-bold text-slate-300 hover:text-white" href={adminOperationalHref()}>
            Vezi toate <ArrowRight size={14} />
          </Link>
        ) : null}
      </div>
      {rows.length ? (
        <div className="grid divide-y divide-focus-line">
          {rows.map((row) => (
            <div className="grid gap-3 px-5 py-3 text-sm md:grid-cols-[130px_1fr_160px]" key={row.id}>
              <div className="flex items-center gap-2 font-black text-white">
                {row.icon}
                {row.label}
              </div>
              <div>
                <p className="font-bold text-white">
                  {row.code} | {row.clientName}
                </p>
                <p className="text-xs text-slate-400">{[row.campaignName, row.city, row.salesperson].filter(Boolean).join(" | ") || "-"}</p>
              </div>
              <div className="text-left md:text-right">
                <p className={row.overdue ? "font-black text-red-100" : "font-black text-focus-yellow"}>{date(row.taskDate)}</p>
                <p className="text-xs text-slate-400">{row.overdue ? "Intarziat" : "Programat"}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="p-5 text-sm text-slate-400">Nu sunt decorari sau neutralizari active in perioada urmatoare.</p>
      )}
    </section>
  );
}

function DashboardTable({ title, rows, compact = false }: { title: string; rows: DashboardData["recentCampaigns"]; compact?: boolean }) {
  return <section className="overflow-hidden rounded-lg border border-focus-line bg-focus-ink/70">
    <div className="flex items-center justify-between border-b border-focus-line px-5 py-4">
      <h2 className="text-sm font-black uppercase text-focus-yellow">{title}</h2>
      <Link className="inline-flex items-center gap-1 text-xs font-bold text-slate-300 hover:text-white" href={adminReservationsHref()}>Deschide lista <ArrowRight size={14} /></Link>
    </div>
    {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-focus-navy/70 text-left text-xs uppercase text-slate-400"><tr><th className="px-4 py-3">Cod</th><th className="px-4 py-3">Client</th><th className="px-4 py-3">Perioada</th><th className="px-4 py-3">Status</th>{compact ? null : <th className="px-4 py-3">Vanzator</th>}<th className="px-4 py-3">Actiune</th></tr></thead><tbody>{rows.map((row) => <tr className="border-t border-focus-line" key={row.id}><td className="px-4 py-3 font-black text-white">{row.code}</td><td className="px-4 py-3">{row.clientName}<span className="block text-xs text-slate-400">{row.campaignName || row.city || "-"}</span></td><td className="px-4 py-3 text-xs">{date(row.periodStart)} - {date(row.periodEnd)}</td><td className="px-4 py-3"><span className="rounded border border-focus-line px-2 py-1 text-xs font-black">{row.status}</span></td>{compact ? null : <td className="px-4 py-3 text-slate-400">{row.salesperson || "-"}</td>}<td className="px-4 py-3"><Link className="text-xs font-black text-focus-yellow hover:text-white" href={row.campaignId ? adminCampaignHref(row.campaignId) : adminReservationHref(row.reservationId || row.id)}>Deschide</Link></td></tr>)}</tbody></table></div> : <p className="p-6 text-sm text-slate-400">Nu exista inregistrari pentru acest interval.</p>}
  </section>;
}

function Pipeline({ data }: { data: Record<string, number> }) { const entries = Object.entries(data); return <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-5"><h2 className="text-sm font-black uppercase text-focus-yellow">Pipeline solicitari</h2>{entries.length ? <div className="mt-4 grid grid-cols-2 gap-3">{entries.map(([label, value]) => <div className="border-l-2 border-focus-yellow pl-3" key={label}><strong className="text-xl">{value}</strong><span className="block text-xs text-slate-400">{label}</span></div>)}</div> : <p className="mt-4 text-sm text-slate-400">Nu exista solicitari.</p>}</section>; }
function Ranking({ title, rows }: { title: string; rows: DashboardData["agentPerformance"] }) { return <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-5"><h2 className="text-sm font-black uppercase text-focus-yellow">{title}</h2>{rows.length ? <div className="mt-4 grid gap-3">{rows.map((row) => <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-focus-line pb-2 text-sm" key={row.label}><span>{row.label}<small className="block text-slate-400">{row.campaigns} campanii</small></span><strong>{euro(row.revenue)}</strong></div>)}</div> : <p className="mt-4 text-sm text-slate-400">Nu exista date in perioada curenta.</p>}</section>; }
function UsersSummary({ data }: { data: Record<string, number> }) { return <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-black uppercase text-focus-yellow">Utilizatori</h2><Link className="text-xs font-bold" href="/admin/utilizatori">Gestioneaza</Link></div><div className="mt-4 grid grid-cols-2 gap-2">{Object.entries(data).map(([role, count]) => <div className="border-l-2 border-focus-yellow pl-3" key={role}><strong>{count}</strong><span className="block text-xs text-slate-400">{role}</span></div>)}</div></section>; }
function euro(value: number) { return `${new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 0 }).format(value)} EUR`; }
function date(value: string) { return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
