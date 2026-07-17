"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSpreadsheet,
  MapPinned,
  MoreHorizontal,
  ShieldAlert,
  UserPlus,
  Users,
  Wrench,
  XCircle
} from "lucide-react";
import type { DashboardData } from "@/lib/dashboard";
import { adminNewReservationHref, adminReservationHref, adminReservationsHref } from "@/lib/admin-routes";
import { hasPermission } from "@/lib/rbac";
import { ReservationPeriodChangeDialog, type ReservationPeriodChangeTarget } from "@/components/admin/ReservationPeriodChangeDialog";
import { SalesReportExportButton } from "@/components/admin/SalesReportExportButton";

const FinancialDashboardPanel = dynamic(
  () => import("@/components/admin/FinancialDashboardPanel").then((module) => module.FinancialDashboardPanel),
  { loading: () => <div className="rounded-lg border border-focus-line p-6 text-sm font-bold text-slate-300">Se incarca datele financiare...</div> }
);

type CooData = DashboardData["coo"];
type CooTab = "overview" | "issues" | "sales" | "crm" | "operations" | "inventory" | "financial" | "exports" | "admin";
type OperationTaskFilter = "all" | "decoration" | "neutralization" | "overdue";
type ReservationRow = CooData["holds"][number];
type CampaignListRow = CooData["activeCampaigns"][number] | CooData["holds"][number];
type TaskRow = CooData["decorationTasks"][number];
type ProblemRow = CooData["problems"][number];

const tabs: Array<{ id: CooTab; label: string }> = [
  { id: "overview", label: "Prioritati" },
  { id: "issues", label: "Probleme" },
  { id: "sales", label: "Vanzari" },
  { id: "crm", label: "CRM" },
  { id: "operations", label: "Operatiuni" },
  { id: "inventory", label: "Inventar" },
  { id: "financial", label: "Financiar" },
  { id: "exports", label: "Exporturi" },
  { id: "admin", label: "Admin" }
];

export function CooCommandCenter({ data }: { data: DashboardData }) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const coo = data.coo;
  const canOperateCampaigns = hasPermission(data.role, "campaigns.operate");
  const [activeTab, setActiveTab] = useState<CooTab>("overview");
  const [operationFilter, setOperationFilter] = useState<OperationTaskFilter>("all");
  const [query, setQuery] = useState("");
  const [hiddenReservations, setHiddenReservations] = useState<Set<string>>(new Set());
  const [hiddenTasks, setHiddenTasks] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [periodTarget, setPeriodTarget] = useState<ReservationRow | null>(null);

  const filterText = query.toLowerCase();
  const visibleHolds = useMemo(() => coo.holds.filter((item) => !hiddenReservations.has(item.id) && rowMatches(item, filterText)), [coo.holds, filterText, hiddenReservations]);
  const visibleTasks = useMemo(() => [...coo.decorationTasks, ...coo.neutralizationTasks].filter((item) => !hiddenTasks.has(item.id) && taskMatches(item, filterText)), [coo.decorationTasks, coo.neutralizationTasks, filterText, hiddenTasks]);
  const filteredOperationTasks = useMemo(() => visibleTasks.filter((item) => {
    if (operationFilter === "decoration") return item.kind === "decoration";
    if (operationFilter === "neutralization") return item.kind === "neutralization";
    if (operationFilter === "overdue") return item.overdue;
    return true;
  }), [operationFilter, visibleTasks]);
  const visibleProblems = useMemo(() => coo.problems.filter((item) => problemMatches(item, filterText)).slice(0, 80), [coo.problems, filterText]);

  async function command(reservationId: string, action: string, body: Record<string, unknown> = {}, success = "Actiunea a fost executata.") {
    setBusy(`${action}-${reservationId}`);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/command-center", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reservationId, action, ...body })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Actiunea nu a putut fi executata.");
      setMessage(success);
      if (["releaseHold", "markLost", "confirmBooking", "approveException", "markResolved"].includes(action)) {
        setHiddenReservations((current) => new Set(current).add(reservationId));
      }
      if (action === "operationStatus" && ["DONE", "ARCHIVED"].includes(String(body.status))) {
        const taskKey = body.taskId ? `${body.kind}-${reservationId}-${body.taskId}` : `${body.kind}-${reservationId}`;
        setHiddenTasks((current) => new Set(current).add(taskKey));
      }
      startRefresh(() => router.refresh());
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "Actiunea nu a putut fi executata.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="focus-shell py-8">
      <div className="focus-container grid gap-6">
        <section className="grid gap-4 border-b border-focus-line pb-5 xl:grid-cols-[1fr_auto]">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Centru operational COO</p>
            <h1 className="font-display text-4xl font-black uppercase text-white">Control operational OOH</h1>
            <p className="mt-2 max-w-4xl text-sm font-bold leading-6 text-slate-300">
              Prioritati zilnice pentru suprapuneri, hold-uri, operatiuni, campanii si blocaje financiare.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:w-[460px]">
            <Link className="focus-button" href={adminNewReservationHref()} prefetch={false}><BriefcaseBusiness size={18} /> Creeaza rezervare</Link>
            <Link className="focus-button secondary" href="/admin/locatii" prefetch={false}><MapPinned size={18} /> Adauga locatie</Link>
            <a className="focus-button secondary" href={coo.reports.availabilityUrl}><FileSpreadsheet size={18} /> Export disponibil</a>
            <SalesReportExportButton icon={<Download size={18} />} label="Export vanzari" />
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label="Campanii active" value={coo.health.activeCampaigns} tone="green" />
          <Metric label="Incep curand" value={coo.health.startingSoon} tone="yellow" />
          <Metric label="Se termina curand" value={coo.health.endingSoon} />
          <Metric label="Disponibile" value={coo.health.availableLocations} tone="green" />
          <Metric label="Hold-uri" value={coo.health.heldLocations} tone="yellow" />
          <Metric label="Probleme" value={coo.health.issues} tone={coo.health.issues ? "red" : "green"} />
        </section>

        {data.finance?.hasActiveReport ? (
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Rest incasat RON" value={money(data.finance.kpis.remainingReceivableRon)} tone="green" />
            <Metric label="Rest incasat EUR" value={money(data.finance.kpis.remainingReceivableEur)} tone="green" />
            <Metric label="Rest plata RON" value={money(data.finance.kpis.remainingPayableRon)} tone="yellow" />
            <Metric label="Rest plata EUR" value={money(data.finance.kpis.remainingPayableEur)} tone="yellow" />
          </section>
        ) : null}

        <section className="grid gap-3 lg:grid-cols-[240px_1fr]">
          <aside className="rounded-lg border border-focus-line bg-focus-ink/65 p-3">
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-black uppercase text-slate-400">Filtru global</span>
              <input className="focus-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Client, cod, oras, vanzator" />
            </label>
            <nav className="grid gap-2" aria-label="Module COO">
              {tabs.map((tab) => (
                <button key={tab.id} className={`rounded-md px-3 py-2 text-left text-sm font-black uppercase transition ${activeTab === tab.id ? "bg-focus-yellow text-focus-navy" : "bg-focus-navy/55 text-slate-200 hover:bg-focus-yellow/10"}`} type="button" onClick={() => setActiveTab(tab.id)}>
                  {tab.label}
                </button>
              ))}
            </nav>
          </aside>

          <div className="grid min-w-0 gap-5">
            {message ? <Feedback tone="green" text={message} /> : null}
            {error ? <Feedback tone="red" text={error} /> : null}

            {activeTab === "overview" ? (
              <div className="grid gap-5">
                <Panel title="Stare operationala" icon={<ShieldAlert size={18} />} action={<Link className="text-xs font-black text-focus-yellow" href="/admin/locatii" prefetch={false}>Inventar</Link>}>
                  <div className="grid gap-3 md:grid-cols-4">
                    <Metric label="Ocupate" value={coo.health.occupiedLocations} />
                    <Metric label="Blocate" value={coo.health.blockedLocations} tone="red" />
                    <Metric label="Decorari" value={coo.decorationTasks.length} tone="yellow" />
                    <Metric label="Neutralizari" value={coo.neutralizationTasks.length} tone="yellow" />
                  </div>
                </Panel>
                <div className="grid gap-5 xl:grid-cols-2">
                  <CampaignList title="Campanii active" rows={coo.activeCampaigns.slice(0, 8)} />
                  <CampaignList title="Campanii care incep curand" rows={coo.startingSoon.slice(0, 8)} />
                </div>
                <div className="grid gap-5 xl:grid-cols-2">
                  <SellerTable rows={coo.sellers.slice(0, 8)} />
                  <InventoryTable title="Disponibilitate pe oras" rows={coo.inventoryByCity.slice(0, 8)} />
                </div>
              </div>
            ) : null}

            {activeTab === "issues" ? (
              <div className="grid gap-5">
                <ProblemCenterPanel rows={visibleProblems} />
                <Panel title={`Suprapuneri contracte (${coo.conflicts.length})`} icon={<AlertTriangle size={18} />}>
                  <div className="grid gap-3">
                    {coo.conflicts.length ? coo.conflicts.map((conflict) => (
                      <article key={conflict.id} className="rounded-lg border border-red-300/30 bg-red-500/10 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-black uppercase text-red-100">Suprapunere {date(conflict.overlapStart)} - {date(conflict.overlapEnd)}</p>
                            <h3 className="text-xl font-black text-white">{conflict.locationCode} {conflict.city ? `- ${conflict.city}` : ""}</h3>
                          </div>
                          <ActionMenu>
                            <span className="px-3 py-2 text-xs font-bold text-slate-300">Rezolvare manuala necesara</span>
                            {canOperateCampaigns ? <button type="button" onClick={() => command(conflict.reservations[0].id, "createTask", { kind: "decoration", status: "NEW", note: "Verificare conflict operational." })}>Creeaza task</button> : null}
                          </ActionMenu>
                        </div>
                        <div className="mt-3 grid gap-3 lg:grid-cols-2">
                          {conflict.reservations.map((reservation) => <ReservationMini key={reservation.id} row={reservation} busy={busy} onCommand={command} onChangePeriod={setPeriodTarget} />)}
                        </div>
                      </article>
                    )) : <Empty text="Nu exista suprapuneri active." />}
                  </div>
                </Panel>

                <HoldPanel title="Hold-uri active" rows={visibleHolds} busy={busy} onCommand={command} onChangePeriod={setPeriodTarget} />
                <div className="grid gap-5 xl:grid-cols-2">
                  <CampaignList title="Montaj fara data valida" rows={coo.missingInstallations} />
                  <CampaignList title="Neutralizare fara data valida" rows={coo.missingNeutralizations} />
                </div>
              </div>
            ) : null}

            {activeTab === "sales" ? (
              <div className="grid gap-5">
                <SellerTable rows={coo.sellers} />
                <div className="grid gap-5 xl:grid-cols-2">
                  <HoldPanel title="Rezervari neconfirmate" rows={visibleHolds} busy={busy} onCommand={command} onChangePeriod={setPeriodTarget} />
                  <CampaignList title="Campanii confirmate" rows={coo.activeCampaigns} />
                </div>
              </div>
            ) : null}

            {activeTab === "crm" ? (
              <CrmTeamPanel data={coo.crmTeam} />
            ) : null}

            {activeTab === "operations" ? (
              <div className="grid gap-5">
                <div className="flex flex-wrap gap-2">
                  <TaskFilterButton active={operationFilter === "all"} onClick={() => setOperationFilter("all")}>Toate ({visibleTasks.length})</TaskFilterButton>
                  <TaskFilterButton active={operationFilter === "decoration"} onClick={() => setOperationFilter("decoration")}>Decorari ({visibleTasks.filter((task) => task.kind === "decoration").length})</TaskFilterButton>
                  <TaskFilterButton active={operationFilter === "neutralization"} onClick={() => setOperationFilter("neutralization")}>Neutralizari ({visibleTasks.filter((task) => task.kind === "neutralization").length})</TaskFilterButton>
                  <TaskFilterButton active={operationFilter === "overdue"} onClick={() => setOperationFilter("overdue")}>Intarziate ({visibleTasks.filter((task) => task.overdue).length})</TaskFilterButton>
                </div>
                <TaskPanel title="Operatiuni de facut" rows={filteredOperationTasks} busy={busy} canOperate={canOperateCampaigns} onCommand={command} />
              </div>
            ) : null}

            {activeTab === "inventory" ? (
              <div className="grid gap-5">
                <div className="grid gap-5 xl:grid-cols-2">
                  <InventoryTable title="Disponibilitate pe oras" rows={coo.inventoryByCity} />
                  <InventoryTable title="Disponibilitate pe tip suport" rows={coo.inventoryByType} />
                </div>
                <div className="grid gap-5 xl:grid-cols-3">
                  <LocationList title="Locatii disponibile" rows={coo.availableLocations} />
                  <CampaignList title="Locatii ocupate" rows={coo.occupiedLocations} />
                  <LocationList title="Locatii blocate" rows={coo.blockedLocations} />
                </div>
              </div>
            ) : null}

            {activeTab === "financial" ? (
              <FinancialDashboardPanel financial={data.finance} />
            ) : null}

            {activeTab === "exports" ? (
              <Panel title="Rapoarte rapide" icon={<FileSpreadsheet size={18} />}>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <a className="focus-button" href={coo.reports.availabilityUrl}><FileSpreadsheet size={18} /> Disponibil complet</a>
                  <SalesReportExportButton icon={<Download size={18} />} label="Situatie vanzari" />
                  <a className="focus-button secondary" href={coo.reports.billingUrl}><Download size={18} /> Financiar manual</a>
                  <Link className="focus-button secondary" href={adminReservationsHref()} prefetch={false}><ClipboardList size={18} /> Solicitari</Link>
                  <Link className="focus-button secondary" href="/admin/locatii/gps" prefetch={false}><MapPinned size={18} /> Audit GPS</Link>
                </div>
              </Panel>
            ) : null}

            {activeTab === "admin" ? (
              <div className="grid gap-5">
                <Panel title="Administrare rapida" icon={<Users size={18} />}>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <Link className="focus-button" href="/admin/utilizatori" prefetch={false}><UserPlus size={18} /> Creeaza utilizator</Link>
                    <Link className="focus-button secondary" href="/admin/locatii" prefetch={false}><MapPinned size={18} /> Admin locatii</Link>
                    <Link className="focus-button secondary" href="/admin/locatii/import" prefetch={false}><FileSpreadsheet size={18} /> Import Excel</Link>
                    <Link className="focus-button secondary" href="/admin/locatii/gps" prefetch={false}><ShieldAlert size={18} /> Conflicte GPS</Link>
                  </div>
                </Panel>
              </div>
            ) : null}
          </div>
        </section>
        {periodTarget ? (
          <ReservationPeriodChangeDialog
            target={periodTargetFromReservation(periodTarget)}
            onClose={() => setPeriodTarget(null)}
            onConfirm={(periodStart, periodEnd) => command(periodTarget.id, "changePeriod", { periodStart, periodEnd }, "Perioada a fost schimbata.")}
          />
        ) : null}
      </div>
    </main>
  );
}

function Panel({ title, icon, action, children }: { title: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-black uppercase text-focus-yellow">{icon}{title}</h2>
      {action}
    </div>
    {children}
  </section>;
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: number | string; tone?: "neutral" | "green" | "yellow" | "red" }) {
  const toneClass = { neutral: "text-white", green: "text-emerald-200", yellow: "text-focus-yellow", red: "text-red-100" }[tone];
  return <div className="rounded-lg border border-focus-line bg-focus-ink/55 p-4">
    <p className="text-xs font-black uppercase text-slate-400">{label}</p>
    <p className={`mt-2 font-display text-3xl font-black uppercase ${toneClass}`}>{value}</p>
  </div>;
}

function Feedback({ tone, text }: { tone: "green" | "red"; text: string }) {
  const Icon = tone === "green" ? CheckCircle2 : XCircle;
  return <p className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-bold ${tone === "green" ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-red-300/30 bg-red-500/10 text-red-100"}`}>
    <Icon size={18} /> {text}
  </p>;
}

function HoldPanel({
  title,
  rows,
  busy,
  onCommand,
  onChangePeriod,
  expired = false
}: {
  title: string;
  rows: ReservationRow[];
  busy: string | null;
  onCommand: (id: string, action: string, body?: Record<string, unknown>, success?: string) => void;
  onChangePeriod: (row: ReservationRow) => void;
  expired?: boolean;
}) {
  return <Panel title={`${title} (${rows.length})`} icon={<CalendarClock size={18} />}>
    <div className="grid gap-3">
      {rows.length ? rows.map((row) => <ReservationMini key={row.id} row={row} busy={busy} onCommand={onCommand} onChangePeriod={onChangePeriod} expired={expired} />) : <Empty text="Nu exista inregistrari." />}
    </div>
  </Panel>;
}

function ReservationMini({
  row,
  busy,
  onCommand,
  onChangePeriod,
  expired = false
}: {
  row: ReservationRow;
  busy: string | null;
  onCommand: (id: string, action: string, body?: Record<string, unknown>, success?: string) => void;
  onChangePeriod: (row: ReservationRow) => void;
  expired?: boolean;
}) {
  const isActiveHold = ["HOLD", "RESERVED"].includes(row.status) && !expired;
  const canChangePeriod = ["HOLD", "RESERVED", "BOOKED"].includes(row.status) && !expired;
  return <article className="rounded-lg border border-focus-line bg-focus-navy/40 p-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase text-focus-yellow">{row.code} {row.city ? `- ${row.city}` : ""}</p>
        <h3 className="font-black text-white">{row.clientName}</h3>
        <p className="text-xs text-slate-400">{row.campaignName || "Fara campanie"} / {row.salesperson || "Nealocat"}</p>
      </div>
      <Badge tone={expired ? "red" : row.status === "BOOKED" ? "green" : "yellow"}>{row.status}</Badge>
    </div>
    <p className="mt-2 text-xs font-bold text-slate-300">{date(row.periodStart)} - {date(row.periodEnd)}{row.holdExpiresAt ? ` / expira ${dateTime(row.holdExpiresAt)}` : ""}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {isActiveHold ? (
        <>
          <button className="focus-button" type="button" disabled={busy === `confirmBooking-${row.id}`} onClick={() => onCommand(row.id, "confirmBooking", {}, "Hold-ul a fost confirmat ca inchiriere.")}>Confirma</button>
          <button className="focus-button secondary" type="button" disabled={busy === `extendHold-${row.id}`} onClick={() => onCommand(row.id, "extendHold", { days: 5 }, "Hold-ul a fost prelungit cu 5 zile.")}>Prelungeste</button>
          <button className="focus-button secondary" type="button" disabled={busy === `releaseHold-${row.id}`} onClick={() => onCommand(row.id, "releaseHold", {}, "Locatia a fost eliberata.")}>Elibereaza</button>
        </>
      ) : null}
      <ActionMenu>
        <Link href={adminReservationHref(row.id)} prefetch={false}>Vezi detalii</Link>
        {canChangePeriod ? <button type="button" onClick={() => onChangePeriod(row)}>Schimba perioada</button> : null}
        {isActiveHold ? <button type="button" onClick={() => onCommand(row.id, "markLost", {}, "Hold-ul a fost marcat ca pierdut.")}>Marcheaza pierdut</button> : null}
        {!isActiveHold && !canChangePeriod ? <span className="px-3 py-2 text-xs font-bold text-slate-400">Nu exista actiuni rapide pentru acest status.</span> : null}
      </ActionMenu>
    </div>
  </article>;
}

function TaskFilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={`rounded-md px-3 py-2 text-xs font-black uppercase transition ${active ? "bg-focus-yellow text-focus-navy" : "bg-focus-navy/60 text-slate-200 hover:bg-focus-yellow/10"}`}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TaskPanel({
  title,
  rows,
  busy,
  canOperate,
  onCommand
}: {
  title: string;
  rows: TaskRow[];
  busy: string | null;
  canOperate: boolean;
  onCommand: (id: string, action: string, body?: Record<string, unknown>, success?: string) => void;
}) {
  return <Panel title={`${title} (${rows.length})`} icon={<Wrench size={18} />}>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="bg-focus-navy/70 text-left text-xs uppercase text-slate-400">
          <tr><th className="px-3 py-2">Data</th><th className="px-3 py-2">Locatie</th><th className="px-3 py-2">Client</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Actiuni</th></tr>
        </thead>
        <tbody>{rows.length ? rows.map((row) => <tr className="border-t border-focus-line" key={row.id}>
          <td className="px-3 py-3"><span className={row.overdue ? "font-black text-red-100" : "font-black text-white"}>{date(row.taskDate)}</span>{row.overdue ? <small className="block text-red-200">Intarziat</small> : null}</td>
          <td className="px-3 py-3 font-black text-white">{row.code}<small className="block text-slate-400">{row.kind}</small></td>
          <td className="px-3 py-3">{row.clientName}<small className="block text-slate-400">{row.salesperson || "-"}</small></td>
          <td className="px-3 py-3"><Badge tone={row.overdue ? "red" : "yellow"}>{row.status}</Badge></td>
          <td className="px-3 py-3">
            {canOperate ? (
              <div className="flex flex-wrap gap-2">
                <button className="focus-button secondary" type="button" disabled={busy === `operationStatus-${row.reservationId}`} onClick={() => onCommand(row.reservationId, "operationStatus", operationStatusBody(row, "IN_PROGRESS"), "Taskul este in lucru.")}>In lucru</button>
                <button className="focus-button" type="button" onClick={() => onCommand(row.reservationId, "operationStatus", operationStatusBody(row, "DONE"), "Taskul a fost finalizat.")}>Finalizat</button>
                <ActionMenu><button type="button" onClick={() => onCommand(row.reservationId, "operationStatus", operationStatusBody(row, "ARCHIVED"), "Taskul a fost arhivat.")}>Arhiveaza</button><Link href={adminReservationHref(row.reservationId)} prefetch={false}>Vezi contract</Link></ActionMenu>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <span className="text-xs font-bold text-slate-500">Doar vizualizare</span>
                <Link className="text-xs font-black text-focus-yellow hover:text-white" href={adminReservationHref(row.reservationId)} prefetch={false}>Vezi contract</Link>
              </div>
            )}
          </td>
        </tr>) : <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={5}>Nu exista taskuri active.</td></tr>}</tbody>
      </table>
    </div>
  </Panel>;
}

function operationStatusBody(row: TaskRow, status: "IN_PROGRESS" | "DONE" | "ARCHIVED") {
  const taskId = typeof row.taskId === "string" && row.taskId.trim() ? row.taskId.trim() : null;
  return {
    kind: row.kind,
    status,
    ...(taskId ? { taskId } : {})
  };
}

function ProblemCenterPanel({ rows }: { rows: ProblemRow[] }) {
  const groups = ["Operational", "Vanzari", "Financiar", "CRM", "Inventar", "Date incomplete"];
  return <Panel title={`Probleme active (${rows.length})`} icon={<AlertTriangle size={18} />}>
    <div className="grid gap-4">
      {groups.map((group) => {
        const groupRows = rows.filter((row) => row.module === group);
        if (!groupRows.length) return null;
        return <section key={group} className="rounded-lg border border-focus-line bg-focus-navy/35">
          <div className="flex items-center justify-between gap-3 border-b border-focus-line px-4 py-3">
            <h3 className="text-xs font-black uppercase text-focus-yellow">{group}</h3>
            <Badge tone={groupRows.some((row) => row.severity === "critical" || row.severity === "high") ? "red" : "yellow"}>{groupRows.length}</Badge>
          </div>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="sticky top-0 bg-focus-navy text-left text-xs uppercase text-slate-400">
                <tr><th className="px-3 py-2">Problema</th><th className="px-3 py-2">Impact</th><th className="px-3 py-2">Scadenta</th><th className="px-3 py-2">Actiune recomandata</th><th className="px-3 py-2">Status</th></tr>
              </thead>
              <tbody>{groupRows.map((row) => <tr className="border-t border-focus-line" key={row.id}>
                <td className="px-3 py-3"><strong className="block text-white">{row.title}</strong><small className="text-slate-400">{row.plainLanguageDescription}</small></td>
                <td className="px-3 py-3"><Badge tone={severityTone(row.severity)}>{row.severity}</Badge></td>
                <td className="px-3 py-3">{row.dueDate ? date(row.dueDate) : "-"}</td>
                <td className="px-3 py-3 text-slate-200">{row.recommendedAction}</td>
                <td className="px-3 py-3"><Badge>{row.status}</Badge></td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>;
      })}
      {!rows.length ? <Empty text="Nu exista probleme pentru filtrul curent." /> : null}
    </div>
  </Panel>;
}

function CrmTeamPanel({ data }: { data: CooData["crmTeam"] }) {
  if (!data) {
    return <Panel title="Activitate CRM" icon={<Users size={18} />}>
      <Empty text="Metricile CRM nu sunt disponibile pentru acest rol." />
    </Panel>;
  }
  return <div className="grid gap-5">
    <Panel
      title="Activitate CRM"
      icon={<Users size={18} />}
      action={<Link className="focus-button" href="/admin/crm" prefetch={false}>Deschide CRM</Link>}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Lead-uri active" value={data.summary.active} tone="green" />
        <Metric label="Follow-up restant" value={data.summary.overdue} tone={data.summary.overdue ? "red" : "green"} />
        <Metric label="Fara urmator pas" value={data.summary.missingNextStep} tone={data.summary.missingNextStep ? "yellow" : "green"} />
        <Metric label="Etape blocate" value={data.summary.stalled} tone={data.summary.stalled ? "yellow" : "green"} />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Activitati 7 zile" value={data.activities7Days} />
        <CrmMoneyMetric label="Pipeline total" values={data.summary.pipelineByCurrency} />
        <CrmMoneyMetric label="Posibil luna" values={data.summary.bestCaseByCurrency} />
        <CrmMoneyMetric label="Angajament luna" values={data.summary.commitByCurrency} />
        <Metric label="Castigate luna" value={data.summary.wonThisMonth} tone="green" />
      </div>
    </Panel>

    <Panel title="Activitate agenti CRM" icon={<Users size={18} />}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-focus-navy/70 text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">Agent</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2">Follow-up</th>
              <th className="px-3 py-2">Activitati 7 zile</th>
              <th className="px-3 py-2">Atentie</th>
              <th className="px-3 py-2">Angajament</th>
              <th className="px-3 py-2">Conversie</th>
            </tr>
          </thead>
          <tbody>{data.sellers.length ? data.sellers.map((seller) => (
            <tr className="border-t border-focus-line" key={seller.id}>
              <td className="px-3 py-3 font-black text-white">{seller.name}<small className="block text-slate-400">{seller.email}</small></td>
              <td className="px-3 py-3">{seller.activeLeads}</td>
              <td className="px-3 py-3"><span className={seller.overdue ? "font-black text-red-100" : ""}>{seller.overdue} restante</span><small className="block text-slate-400">{seller.dueToday} azi / {seller.missingNextStep} fara pas</small></td>
              <td className="px-3 py-3">{seller.activities7Days}<small className="block text-slate-400">{seller.activities30Days} / 30 zile</small></td>
              <td className="px-3 py-3"><span className={seller.stalled || seller.noResponseAttention || seller.missingNextStep ? "font-black text-red-100" : ""}>{seller.stalled} blocate</span><small className="block text-slate-400">{seller.noResponseAttention} fara raspuns / {seller.missingNextStep} fara pas</small></td>
              <td className="px-3 py-3">{formatCurrencyValues(seller.commitByCurrency)}<small className="block text-slate-400">Posibil: {formatCurrencyValues(seller.bestCaseByCurrency)}</small></td>
              <td className="px-3 py-3">{seller.conversionRate == null ? "-" : `${seller.conversionRate}%`}<small className="block text-slate-400">{seller.won} castigate / {seller.lost} pierdute</small></td>
            </tr>
          )) : <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={7}>Nu exista agenti CRM activi.</td></tr>}</tbody>
        </table>
      </div>
    </Panel>

    <Panel title="Pipeline pe etapa" icon={<BriefcaseBusiness size={18} />}>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {data.statusBreakdown.length ? data.statusBreakdown.map((row) => (
          <div className="rounded-lg border border-focus-line bg-focus-navy/40 p-4" key={row.status}>
            <p className="text-xs font-black uppercase text-slate-400">{row.label}</p>
            <p className="mt-2 text-2xl font-black text-white">{row.count}</p>
          </div>
        )) : <Empty text="Pipeline-ul CRM este gol." />}
      </div>
    </Panel>
  </div>;
}

function CrmMoneyMetric({ label, values }: { label: string; values: Record<string, number> }) {
  return <div className="rounded-lg border border-focus-line bg-focus-ink/55 p-4">
    <p className="text-xs font-black uppercase text-slate-400">{label}</p>
    <p className="mt-2 text-lg font-black text-white">{formatCurrencyValues(values)}</p>
  </div>;
}

function SellerTable({ rows }: { rows: CooData["sellers"] }) {
  return <Panel title="Activitate vanzatori" icon={<Users size={18} />}>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] text-sm">
        <thead className="bg-focus-navy/70 text-left text-xs uppercase text-slate-400"><tr><th className="px-3 py-2">Vanzator</th><th className="px-3 py-2">Lead-uri</th><th className="px-3 py-2">Hold-uri</th><th className="px-3 py-2">Confirmate</th><th className="px-3 py-2">Vandut</th><th className="px-3 py-2">Pipeline</th><th className="px-3 py-2">Follow-up</th><th className="px-3 py-2">Conversie</th></tr></thead>
        <tbody>{rows.length ? rows.map((row) => <tr className="border-t border-focus-line" key={row.seller}><td className="px-3 py-3 font-black text-white">{row.seller}<small className="block text-slate-400">{row.latestActivityAt ? `Ultima activitate ${dateTime(row.latestActivityAt)}` : "Fara activitate"}</small></td><td className="px-3 py-3">{row.activeLeads} active / {row.receivedRequests} primite</td><td className="px-3 py-3">{row.activeHolds} active / {row.expiredHolds} expirate</td><td className="px-3 py-3">{row.confirmedCampaigns}</td><td className="px-3 py-3">{money(row.soldValue)} EUR</td><td className="px-3 py-3">{money(row.pipelineValue)} EUR</td><td className="px-3 py-3">{row.overdueFollowUps}</td><td className="px-3 py-3">{row.conversionRate == null ? "-" : `${row.conversionRate}%`}</td></tr>) : <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">Nu exista activitate pe vanzatori.</td></tr>}</tbody>
      </table>
    </div>
  </Panel>;
}

function InventoryTable({ title, rows }: { title: string; rows: CooData["inventoryByCity"] }) {
  return <Panel title={title} icon={<MapPinned size={18} />}>
    <div className="grid gap-2">{rows.length ? rows.map((row) => <div className="grid gap-3 rounded-md border border-focus-line bg-focus-navy/40 p-3 text-sm md:grid-cols-[1fr_repeat(6,auto)]" key={row.label}><strong className="text-white">{row.label}</strong><span>Total {row.total}</span><span className="text-emerald-200">Libere {row.available}</span><span>Ocupate {row.occupied}</span><span className="text-focus-yellow">Hold {row.held}</span><span className="text-red-100">Blocate {row.blocked}</span><span>Premium {row.premium}</span></div>) : <Empty text="Nu exista date de inventar." />}</div>
  </Panel>;
}

function CampaignList({ title, rows }: { title: string; rows: CampaignListRow[] }) {
  return <Panel title={`${title} (${rows.length})`} icon={<BriefcaseBusiness size={18} />}>
    <div className="grid gap-2">{rows.length ? rows.slice(0, 12).map((row) => {
      const locations = "locations" in row && Array.isArray(row.locations) ? row.locations : null;
      return <div className="rounded-md border border-focus-line bg-focus-navy/40 p-3 text-sm" key={row.id}>
        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <span>
            <strong className="text-white">{row.campaignName || row.clientName}</strong>
            <small className="block text-slate-400">
              {row.clientName} / {date(row.periodStart)} - {date(row.periodEnd)}
              {row.amount ? ` / ${money(row.amount)} ${row.currency || "EUR"}` : ""}
            </small>
          </span>
          <Badge tone={row.status === "BOOKED" ? "green" : "yellow"}>{locations ? `${locations.length} locatii` : row.status}</Badge>
        </div>
        {locations ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {locations.slice(0, 12).map((location) => (
              <span className="rounded-full border border-focus-line bg-focus-ink/70 px-2.5 py-1 text-xs font-bold text-slate-200" key={location.reservationId}>
                {location.code}{location.city ? ` / ${location.city}` : ""}
              </span>
            ))}
            {locations.length > 12 ? <span className="text-xs font-bold text-slate-400">+{locations.length - 12} locatii</span> : null}
          </div>
        ) : (
          <small className="mt-2 block text-slate-400">{row.code} / {row.city || "-"} / {row.type || "-"}</small>
        )}
      </div>;
    }) : <Empty text="Nu exista inregistrari." />}</div>
  </Panel>;
}

function LocationList({ title, rows }: { title: string; rows: CooData["availableLocations"] }) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const visibleRows = rows.filter((row) => !hiddenIds.has(row.id));
  const blockedList = title.toLowerCase().includes("blocate");
  async function unblock(rowId: string) {
    const response = await fetch(`/api/admin/locations/${rowId}/block`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blocked: false })
    });
    if (response.ok) setHiddenIds((current) => new Set(current).add(rowId));
    else window.alert("Locatia nu a putut fi deblocata.");
  }
  if (blockedList) {
    return <Panel title={`${title} (${visibleRows.length})`} icon={<MapPinned size={18} />}>
      <div className="grid gap-2">{visibleRows.length ? visibleRows.map((row) => <div className="rounded-md border border-focus-line bg-focus-navy/40 p-3 text-sm" key={row.id}><strong className="text-white">{row.code}</strong><span className="block text-slate-400">{[row.city, row.type, row.lifecycleStatus].filter(Boolean).join(" | ")}</span><span className="mt-1 block text-xs text-red-100">{row.blockedReason || `Status inventar: ${row.lifecycleStatus}`}</span>{row.blockedReason ? <button className="focus-button secondary mt-3" type="button" onClick={() => unblock(row.id)}>Deblocheaza</button> : null}</div>) : <Empty text="Nu exista locatii blocate." />}</div>
    </Panel>;
  }
  return <Panel title={`${title} (${rows.length})`} icon={<MapPinned size={18} />}>
    <div className="grid gap-2">{rows.length ? rows.map((row) => <div className="rounded-md border border-focus-line bg-focus-navy/40 p-3 text-sm" key={row.id}><strong className="text-white">{row.code}</strong><span className="block text-slate-400">{[row.city, row.type, row.status].filter(Boolean).join(" / ")}</span></div>) : <Empty text="Nu exista locatii in lista." />}</div>
  </Panel>;
}

function ActionMenu({ children }: { children: React.ReactNode }) {
  return <details className="relative">
    <summary className="focus-button secondary cursor-pointer list-none"><MoreHorizontal size={18} /> Actiuni</summary>
    <div className="absolute right-0 z-20 mt-2 grid min-w-56 gap-1 rounded-lg border border-focus-line bg-focus-navy p-2 shadow-xl [&_a]:rounded [&_a]:px-3 [&_a]:py-2 [&_a]:text-left [&_a]:text-sm [&_a]:font-bold [&_button]:rounded [&_button]:px-3 [&_button]:py-2 [&_button]:text-left [&_button]:text-sm [&_button]:font-bold [&_button:hover]:bg-focus-yellow/10 [&_a:hover]:bg-focus-yellow/10">
      {children}
    </div>
  </details>;
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "yellow" | "red" }) {
  const className = { neutral: "border-slate-400/40 bg-slate-400/10 text-slate-100", green: "border-emerald-300/50 bg-emerald-400/10 text-emerald-100", yellow: "border-focus-yellow/60 bg-focus-yellow/10 text-focus-yellow", red: "border-red-300/50 bg-red-400/10 text-red-100" }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-black uppercase ${className}`}>{children}</span>;
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-lg border border-focus-line bg-focus-navy/35 px-4 py-6 text-center text-sm font-bold text-slate-400">{text}</p>;
}

function rowMatches(row: CampaignListRow, query: string) {
  if (!query) return true;
  const locations = "locations" in row && Array.isArray(row.locations)
    ? row.locations.map((location) => [location.code, location.city, location.type].join(" ")).join(" ")
    : "";
  return [row.code, row.city, row.clientName, row.campaignName, row.salesperson, row.status, locations].join(" ").toLowerCase().includes(query);
}

function taskMatches(row: TaskRow, query: string) {
  if (!query) return true;
  return [row.code, row.city, row.clientName, row.campaignName, row.salesperson, row.status, row.kind].join(" ").toLowerCase().includes(query);
}

function problemMatches(row: ProblemRow, query: string) {
  if (!query) return true;
  return [row.module, row.type, row.title, row.plainLanguageDescription, row.recommendedAction, row.severity].join(" ").toLowerCase().includes(query);
}

function severityTone(severity: ProblemRow["severity"]) {
  if (severity === "critical" || severity === "high") return "red" as const;
  if (severity === "medium") return "yellow" as const;
  return "neutral" as const;
}

function periodTargetFromReservation(row: ReservationRow): ReservationPeriodChangeTarget {
  return {
    id: row.id,
    locationId: row.locationId,
    locationLabel: [row.code, row.city].filter(Boolean).join(" / "),
    clientName: row.clientName,
    campaignName: row.campaignName,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd
  };
}

function date(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" }).format(new Date(value));
}

function money(value: number) {
  return new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 0 }).format(value || 0);
}

function formatCurrencyValues(values: Record<string, number>) {
  const rows = Object.entries(values).filter(([, value]) => value !== 0);
  if (!rows.length) return "0";
  return rows.map(([currency, value]) => `${money(value)} ${currency}`).join(" / ");
}
