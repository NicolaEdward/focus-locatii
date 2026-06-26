"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
import { FinancialDashboardPanel } from "@/components/admin/FinancialDashboardPanel";

type CooData = DashboardData["coo"];
type CooTab = "overview" | "issues" | "sales" | "crm" | "operations" | "inventory" | "financial" | "exports" | "admin";
type ReservationRow = CooData["holds"][number];
type CampaignListRow = CooData["activeCampaigns"][number] | CooData["holds"][number];
type TaskRow = CooData["decorationTasks"][number];
type CrmLead = CooData["crmLeads"][number];
type ProblemRow = CooData["problems"][number];
type SellerUser = { id: string; name: string; email: string; role: string };
type ReassignRow = { id: string; code: string; city: string | null; clientName: string; campaignName: string | null; periodStart: string; periodEnd: string; status: string; currentSellerName: string | null };

const tabs: Array<{ id: CooTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "issues", label: "Probleme" },
  { id: "sales", label: "Vanzari" },
  { id: "crm", label: "CRM" },
  { id: "operations", label: "Operational" },
  { id: "inventory", label: "Inventory" },
  { id: "financial", label: "Financiar" },
  { id: "exports", label: "Exporturi" },
  { id: "admin", label: "Admin" }
];

const crmStatuses = [
  ["COLD", "Cold"],
  ["QUALIFIED", "Calificat"],
  ["IN_ANALYSIS", "In analiza"],
  ["IN_OFFER", "In ofertare"],
  ["IN_NEGOTIATION", "In negociere"],
  ["IN_CONTRACTING", "In contractare"],
  ["ON_HOLD", "On Hold"],
  ["NO_RESPONSE", "Nu raspunde"],
  ["ACCOUNT_MANAGEMENT", "Account Management"],
  ["WON", "Castigat"],
  ["LOST", "Pierdut"],
  ["INACTIVE", "Inactiv"]
] as const;

export function CooCommandCenter({ data }: { data: DashboardData }) {
  const coo = data.coo;
  const [activeTab, setActiveTab] = useState<CooTab>("overview");
  const [query, setQuery] = useState("");
  const [hiddenReservations, setHiddenReservations] = useState<Set<string>>(new Set());
  const [hiddenTasks, setHiddenTasks] = useState<Set<string>>(new Set());
  const [crmLeads, setCrmLeads] = useState(coo.crmLeads);
  const [sellerUsers, setSellerUsers] = useState<SellerUser[]>([]);
  const [reassignments, setReassignments] = useState<{ reservations: ReassignRow[]; sellers: SellerUser[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filterText = query.toLowerCase();
  const visibleHolds = useMemo(() => coo.holds.filter((item) => !hiddenReservations.has(item.id) && rowMatches(item, filterText)), [coo.holds, filterText, hiddenReservations]);
  const visibleExpiredHolds = useMemo(() => coo.expiredHolds.filter((item) => !hiddenReservations.has(item.id) && rowMatches(item, filterText)), [coo.expiredHolds, filterText, hiddenReservations]);
  const visibleTasks = useMemo(() => [...coo.decorationTasks, ...coo.neutralizationTasks].filter((item) => !hiddenTasks.has(item.id) && taskMatches(item, filterText)), [coo.decorationTasks, coo.neutralizationTasks, filterText, hiddenTasks]);
  const visibleCrm = useMemo(() => crmLeads.filter((item) => crmMatches(item, filterText)), [crmLeads, filterText]);
  const visibleProblems = useMemo(() => coo.problems.filter((item) => problemMatches(item, filterText)).slice(0, 80), [coo.problems, filterText]);

  useEffect(() => {
    if (activeTab !== "crm" && activeTab !== "admin") return;
    let cancelled = false;
    fetch("/api/admin/sellers", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!cancelled && Array.isArray(payload?.sellers)) setSellerUsers(payload.sellers);
      })
      .catch(() => {
        if (!cancelled) setSellerUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "admin") return;
    let cancelled = false;
    fetch("/api/admin/seller-reassignments", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!cancelled && payload) setReassignments(payload);
      })
      .catch(() => {
        if (!cancelled) setReassignments({ reservations: [], sellers: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

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
        setHiddenTasks((current) => new Set(current).add(`${body.kind}-${reservationId}`));
      }
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "Actiunea nu a putut fi executata.");
    } finally {
      setBusy(null);
    }
  }

  async function updateCrmLead(id: string, patch: Record<string, unknown>) {
    setBusy(`crm-${id}`);
    setError(null);
    setMessage(null);
    try {
      const lead = crmLeads.find((item) => item.id === id);
      const endpoint = lead?.sourceKind === "crm" ? `/api/admin/crm/leads/${id}` : `/api/offer-requests/${id}`;
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(lead?.sourceKind === "crm" ? normalizeCrmPatch(patch) : patch)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Lead-ul nu a putut fi actualizat.");
      setCrmLeads((current) => current.map((item) => item.id === id ? { ...item, ...patch, ...payload.request, ...serializePatchedCrmLead(payload.lead) } : item));
      setMessage("Lead-ul a fost actualizat.");
    } catch (crmError) {
      setError(crmError instanceof Error ? crmError.message : "Lead-ul nu a putut fi actualizat.");
    } finally {
      setBusy(null);
    }
  }

  async function createCrmLead(input: Record<string, unknown>) {
    setBusy("crm-create");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/crm/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Lead-ul nu a putut fi creat.");
      setCrmLeads((current) => [{ ...serializePatchedCrmLead(payload.lead), id: payload.lead.id, sourceKind: "crm", selectedCodes: null, relatedCampaigns: [], createdAt: payload.lead.createdAt || new Date().toISOString() } as CrmLead, ...current]);
      setMessage("Lead-ul a fost creat.");
    } catch (crmError) {
      setError(crmError instanceof Error ? crmError.message : "Lead-ul nu a putut fi creat.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="focus-shell py-8">
      <div className="focus-container grid gap-6">
        <section className="grid gap-4 border-b border-focus-line pb-5 xl:grid-cols-[1fr_auto]">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">COO Operational Command Center</p>
            <h1 className="font-display text-4xl font-black uppercase text-white">Control operational OOH</h1>
            <p className="mt-2 max-w-4xl text-sm font-bold leading-6 text-slate-300">
              Campanii, conflicte, hold-uri, taskuri, vanzari, CRM, inventar si actiuni admin intr-un singur dashboard.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:w-[460px]">
            <Link className="focus-button" href="/admin/locatii#rezervari"><BriefcaseBusiness size={18} /> Creeaza rezervare</Link>
            <Link className="focus-button secondary" href="/admin/locatii"><MapPinned size={18} /> Adauga locatie</Link>
            <a className="focus-button secondary" href={coo.reports.availabilityUrl}><FileSpreadsheet size={18} /> Export disponibil</a>
            <a className="focus-button secondary" href={coo.reports.salesUrl}><Download size={18} /> Export vanzari</a>
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

        {data.finance ? (
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
                <Panel title="Operational Health" icon={<ShieldAlert size={18} />} action={<Link className="text-xs font-black text-focus-yellow" href="/admin/locatii">Inventar</Link>}>
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
                <Panel title={`Conflict Center (${coo.conflicts.length})`} icon={<AlertTriangle size={18} />}>
                  <div className="grid gap-3">
                    {coo.conflicts.length ? coo.conflicts.map((conflict) => (
                      <article key={conflict.id} className="rounded-lg border border-red-300/30 bg-red-500/10 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-black uppercase text-red-100">Suprapunere {date(conflict.overlapStart)} - {date(conflict.overlapEnd)}</p>
                            <h3 className="text-xl font-black text-white">{conflict.locationCode} {conflict.city ? `- ${conflict.city}` : ""}</h3>
                          </div>
                          <ActionMenu>
                            <button type="button" onClick={() => command(conflict.reservations[0].id, "markResolved", { note: "Conflict verificat din dashboard COO." })}>Marcheaza rezolvat</button>
                            <button type="button" onClick={() => command(conflict.reservations[0].id, "approveException", { note: "Exceptie aprobata de COO." })}>Aproba exceptie</button>
                            <button type="button" onClick={() => command(conflict.reservations[0].id, "createTask", { kind: "decoration", status: "NEW", note: "Verificare conflict operational." })}>Creeaza task</button>
                          </ActionMenu>
                        </div>
                        <div className="mt-3 grid gap-3 lg:grid-cols-2">
                          {conflict.reservations.map((reservation) => <ReservationMini key={reservation.id} row={reservation} busy={busy} onCommand={command} />)}
                        </div>
                      </article>
                    )) : <Empty text="Nu exista suprapuneri active." />}
                  </div>
                </Panel>

                <div className="grid gap-5 xl:grid-cols-2">
                  <HoldPanel title="Hold-uri active" rows={visibleHolds} busy={busy} onCommand={command} />
                  <HoldPanel title="Hold-uri expirate" rows={visibleExpiredHolds} busy={busy} onCommand={command} expired />
                </div>
                <div className="grid gap-5 xl:grid-cols-2">
                  <CampaignList title="Fara data montaj" rows={coo.missingInstallations} />
                  <CampaignList title="Fara data neutralizare" rows={coo.missingNeutralizations} />
                </div>
              </div>
            ) : null}

            {activeTab === "sales" ? (
              <div className="grid gap-5">
                <SellerTable rows={coo.sellers} />
                <div className="grid gap-5 xl:grid-cols-2">
                  <HoldPanel title="Rezervari neconfirmate" rows={visibleHolds} busy={busy} onCommand={command} />
                  <CampaignList title="Campanii confirmate" rows={coo.activeCampaigns} />
                </div>
              </div>
            ) : null}

            {activeTab === "crm" ? (
              <CrmPanel rows={visibleCrm} sellers={sellerUsers} busy={busy} onUpdate={updateCrmLead} onCreate={createCrmLead} />
            ) : null}

            {activeTab === "operations" ? (
              <div className="grid gap-5">
                <TaskPanel title="Taskuri operationale active" rows={visibleTasks} busy={busy} onCommand={command} />
                <div className="grid gap-5 xl:grid-cols-2">
                  <TaskPanel title="Decorari" rows={coo.decorationTasks.filter((task) => !hiddenTasks.has(task.id))} busy={busy} onCommand={command} />
                  <TaskPanel title="Neutralizari" rows={coo.neutralizationTasks.filter((task) => !hiddenTasks.has(task.id))} busy={busy} onCommand={command} />
                </div>
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
                  <a className="focus-button secondary" href={coo.reports.salesUrl}><Download size={18} /> Situatie vanzari</a>
                  <a className="focus-button secondary" href={coo.reports.billingUrl}><Download size={18} /> Financiar manual</a>
                  <Link className="focus-button secondary" href="/admin/locatii#rezervari"><ClipboardList size={18} /> Solicitari</Link>
                  <Link className="focus-button secondary" href="/admin/locatii/gps"><MapPinned size={18} /> Audit GPS</Link>
                </div>
              </Panel>
            ) : null}

            {activeTab === "admin" ? (
              <div className="grid gap-5">
                <Panel title="Administrare rapida" icon={<Users size={18} />}>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <Link className="focus-button" href="/admin/utilizatori"><UserPlus size={18} /> Creeaza utilizator</Link>
                    <Link className="focus-button secondary" href="/admin/locatii"><MapPinned size={18} /> Admin locatii</Link>
                    <Link className="focus-button secondary" href="/admin/locatii/import"><FileSpreadsheet size={18} /> Import Excel</Link>
                    <Link className="focus-button secondary" href="/admin/locatii/gps"><ShieldAlert size={18} /> Conflicte GPS</Link>
                  </div>
                </Panel>
                <SellerReassignmentPanel data={reassignments} onReload={() => setReassignments(null)} />
              </div>
            ) : null}
          </div>
        </section>
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

function HoldPanel({ title, rows, busy, onCommand, expired = false }: { title: string; rows: ReservationRow[]; busy: string | null; onCommand: (id: string, action: string, body?: Record<string, unknown>, success?: string) => void; expired?: boolean }) {
  return <Panel title={`${title} (${rows.length})`} icon={<CalendarClock size={18} />}>
    <div className="grid gap-3">
      {rows.length ? rows.map((row) => <ReservationMini key={row.id} row={row} busy={busy} onCommand={onCommand} expired={expired} />) : <Empty text="Nu exista inregistrari." />}
    </div>
  </Panel>;
}

function ReservationMini({ row, busy, onCommand, expired = false }: { row: ReservationRow; busy: string | null; onCommand: (id: string, action: string, body?: Record<string, unknown>, success?: string) => void; expired?: boolean }) {
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
      <button className="focus-button" type="button" disabled={busy === `confirmBooking-${row.id}`} onClick={() => onCommand(row.id, "confirmBooking", {}, "Hold-ul a fost confirmat ca inchiriere.")}>Confirma</button>
      <button className="focus-button secondary" type="button" onClick={() => onCommand(row.id, "extendHold", { days: 5 }, "Hold-ul a fost prelungit cu 5 zile.")}>Prelungeste</button>
      <button className="focus-button secondary" type="button" onClick={() => onCommand(row.id, "releaseHold", {}, "Locatia a fost eliberata.")}>Elibereaza</button>
      <ActionMenu>
        <Link href="/admin/locatii#rezervari">Vezi detalii</Link>
        <button type="button" onClick={() => changePeriod(row, onCommand)}>Schimba perioada</button>
        <button type="button" onClick={() => onCommand(row.id, "markLost", {}, "Hold-ul a fost marcat ca pierdut.")}>Marcheaza pierdut</button>
        <button type="button" onClick={() => onCommand(row.id, "createTask", { kind: "decoration", status: "NEW", note: "Follow-up operational pentru hold." })}>Creeaza task</button>
      </ActionMenu>
    </div>
  </article>;
}

function TaskPanel({ title, rows, busy, onCommand }: { title: string; rows: TaskRow[]; busy: string | null; onCommand: (id: string, action: string, body?: Record<string, unknown>, success?: string) => void }) {
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
          <td className="px-3 py-3"><div className="flex flex-wrap gap-2">
            <button className="focus-button secondary" type="button" disabled={busy === `operationStatus-${row.reservationId}`} onClick={() => onCommand(row.reservationId, "operationStatus", { kind: row.kind, status: "IN_PROGRESS", taskId: row.taskId }, "Taskul este in lucru.")}>In lucru</button>
            <button className="focus-button" type="button" onClick={() => onCommand(row.reservationId, "operationStatus", { kind: row.kind, status: "DONE", taskId: row.taskId }, "Taskul a fost finalizat.")}>Finalizat</button>
            <ActionMenu><button type="button" onClick={() => onCommand(row.reservationId, "operationStatus", { kind: row.kind, status: "ARCHIVED", taskId: row.taskId }, "Taskul a fost arhivat.")}>Arhiveaza</button><Link href="/admin/locatii#rezervari">Vezi contract</Link></ActionMenu>
          </div></td>
        </tr>) : <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={5}>Nu exista taskuri active.</td></tr>}</tbody>
      </table>
    </div>
  </Panel>;
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

function CrmPanel({
  rows,
  sellers,
  busy,
  onUpdate,
  onCreate
}: {
  rows: CrmLead[];
  sellers: SellerUser[];
  busy: string | null;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  onCreate: (input: Record<string, unknown>) => void;
}) {
  const [newLead, setNewLead] = useState({ companyName: "", contactName: "", phone: "", email: "", estimatedValue: "", nextFollowUpDate: "" });
  const canCreate = newLead.companyName.trim().length >= 2;
  return <Panel title={`Mini CRM (${rows.length})`} icon={<Users size={18} />}>
    <div className="mb-4 grid gap-3 rounded-lg border border-focus-line bg-focus-navy/35 p-4 md:grid-cols-3 xl:grid-cols-7">
      <input className="focus-input" value={newLead.companyName} onChange={(event) => setNewLead((current) => ({ ...current, companyName: event.target.value }))} placeholder="Companie" />
      <input className="focus-input" value={newLead.contactName} onChange={(event) => setNewLead((current) => ({ ...current, contactName: event.target.value }))} placeholder="Contact" />
      <input className="focus-input" value={newLead.phone} onChange={(event) => setNewLead((current) => ({ ...current, phone: event.target.value }))} placeholder="Telefon" />
      <input className="focus-input" value={newLead.email} onChange={(event) => setNewLead((current) => ({ ...current, email: event.target.value }))} placeholder="Email" />
      <input className="focus-input" value={newLead.estimatedValue} onChange={(event) => setNewLead((current) => ({ ...current, estimatedValue: event.target.value }))} placeholder="Valoare estimata" />
      <input className="focus-input" type="date" value={newLead.nextFollowUpDate} onChange={(event) => setNewLead((current) => ({ ...current, nextFollowUpDate: event.target.value }))} aria-label="Data follow-up" />
      <button className="focus-button" type="button" disabled={!canCreate || busy === "crm-create"} onClick={() => {
        onCreate({
          ...newLead,
          estimatedValue: newLead.estimatedValue ? Number(newLead.estimatedValue.replace(",", ".")) : null,
          currency: "EUR"
        });
        if (canCreate) setNewLead({ companyName: "", contactName: "", phone: "", email: "", estimatedValue: "", nextFollowUpDate: "" });
      }}>Adauga lead</button>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1120px] text-sm">
        <thead className="bg-focus-navy/70 text-left text-xs uppercase text-slate-400">
          <tr><th className="px-3 py-2">Client</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Vanzator</th><th className="px-3 py-2">Status lead</th><th className="px-3 py-2">Valoare</th><th className="px-3 py-2">Follow-up</th><th className="px-3 py-2">Coduri</th><th className="px-3 py-2">Actiuni</th></tr>
        </thead>
        <tbody>{rows.length ? rows.map((row) => <tr className="border-t border-focus-line" key={row.id}>
          <td className="px-3 py-3 font-black text-white">{row.clientName}<small className="block text-slate-400">{row.company || row.message || "-"}</small></td>
          <td className="px-3 py-3">{[row.email, row.phone].filter(Boolean).join(" / ") || "-"}</td>
          <td className="px-3 py-3">{row.sourceKind === "crm" ? (
            <select
              className="focus-input min-w-48"
              value={(row as CrmLead & { assignedToUserId?: string | null }).assignedToUserId || ""}
              disabled={busy === `crm-${row.id}` || sellers.length === 0}
              onChange={(event) => onUpdate(row.id, { assignedToUserId: event.target.value || null })}
            >
              <option value="">{sellers.length ? "Nealocat" : row.salesperson || "Nealocat"}</option>
              {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
            </select>
          ) : row.salesperson || "Nealocat"}</td>
          <td className="px-3 py-3"><select className="focus-input min-w-44" value={row.crmStatus} disabled={busy === `crm-${row.id}`} onChange={(event) => onUpdate(row.id, { crmStatus: event.target.value, status: offerStatusForCrm(event.target.value) })}>{crmStatuses.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></td>
          <td className="px-3 py-3">{row.estimatedValue ? `${money(row.estimatedValue)} EUR` : "-"}</td>
          <td className="px-3 py-3">{row.nextFollowUpAt ? date(row.nextFollowUpAt) : "-"}</td>
          <td className="px-3 py-3 max-w-52 whitespace-normal text-xs">{row.selectedCodes || "-"}</td>
          <td className="px-3 py-3"><ActionMenu>
            <button type="button" onClick={() => setCrmEstimate(row, onUpdate)}>Seteaza valoare</button>
            <button type="button" onClick={() => setCrmFollowUp(row, onUpdate)}>Seteaza follow-up</button>
            <button type="button" onClick={() => setCrmNotes(row, onUpdate)}>Adauga note</button>
          </ActionMenu></td>
        </tr>) : <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={8}>Nu exista lead-uri pentru filtrul curent.</td></tr>}</tbody>
      </table>
    </div>
  </Panel>;
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
    <div className="grid gap-2">{rows.length ? rows.map((row) => <div className="grid gap-3 rounded-md border border-focus-line bg-focus-navy/40 p-3 text-sm md:grid-cols-[1fr_repeat(5,auto)]" key={row.label}><strong className="text-white">{row.label}</strong><span>Total {row.total}</span><span className="text-emerald-200">Libere {row.available}</span><span>Ocupate {row.occupied}</span><span className="text-focus-yellow">Hold {row.held}</span><span>Premium {row.premium}</span></div>) : <Empty text="Nu exista date de inventar." />}</div>
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
      <div className="grid gap-2">{visibleRows.length ? visibleRows.map((row) => <div className="rounded-md border border-focus-line bg-focus-navy/40 p-3 text-sm" key={row.id}><strong className="text-white">{row.code}</strong><span className="block text-slate-400">{[row.city, row.type, row.status].filter(Boolean).join(" | ")}</span><span className="mt-1 block text-xs text-red-100">{row.blockedReason || "Blocare operationala"}</span><button className="focus-button secondary mt-3" type="button" onClick={() => unblock(row.id)}>Deblocheaza</button></div>) : <Empty text="Nu exista locatii blocate." />}</div>
    </Panel>;
  }
  return <Panel title={`${title} (${rows.length})`} icon={<MapPinned size={18} />}>
    <div className="grid gap-2">{rows.length ? rows.map((row) => <div className="rounded-md border border-focus-line bg-focus-navy/40 p-3 text-sm" key={row.id}><strong className="text-white">{row.code}</strong><span className="block text-slate-400">{[row.city, row.type, row.status].filter(Boolean).join(" / ")}</span></div>) : <Empty text="Nu exista locatii in lista." />}</div>
  </Panel>;
}

function SellerReassignmentPanel({ data }: { data: { reservations: ReassignRow[]; sellers: SellerUser[] } | null; onReload?: () => void }) {
  const [targetById, setTargetById] = useState<Record<string, string>>({});
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  async function reassign(row: ReassignRow) {
    const sellerUserId = targetById[row.id];
    if (!sellerUserId) {
      window.alert("Alege un vanzator valid.");
      return;
    }
    setBusy(row.id);
    try {
      const response = await fetch("/api/admin/seller-reassignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reservationIds: [row.id], sellerUserId, reason: reasonById[row.id] || undefined })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Realocarea nu a putut fi salvata.");
      setHiddenIds((current) => new Set(current).add(row.id));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Realocarea nu a putut fi salvata.");
    } finally {
      setBusy(null);
    }
  }

  const rows = (data?.reservations || []).filter((row) => !hiddenIds.has(row.id));
  return <Panel title={`Realocare vanzari neclare (${rows.length})`} icon={<ShieldAlert size={18} />}>
    {!data ? <Empty text="Se incarca vanzarile cu vanzator invalid." /> : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-focus-navy/70 text-left text-xs uppercase text-slate-400">
            <tr><th className="px-3 py-2">Locatie</th><th className="px-3 py-2">Client</th><th className="px-3 py-2">Perioada</th><th className="px-3 py-2">Vanzator curent</th><th className="px-3 py-2">Vanzator corect</th><th className="px-3 py-2">Motiv</th><th className="px-3 py-2">Actiune</th></tr>
          </thead>
          <tbody>{rows.length ? rows.slice(0, 40).map((row) => <tr className="border-t border-focus-line" key={row.id}>
            <td className="px-3 py-3 font-black text-white">{row.code}<small className="block text-slate-400">{row.city || "-"}</small></td>
            <td className="px-3 py-3">{row.clientName}<small className="block text-slate-400">{row.campaignName || row.status}</small></td>
            <td className="px-3 py-3">{date(row.periodStart)} - {date(row.periodEnd)}</td>
            <td className="px-3 py-3">{row.currentSellerName || "Nealocat"}</td>
            <td className="px-3 py-3">
              <select className="focus-input min-w-52" value={targetById[row.id] || ""} onChange={(event) => setTargetById((current) => ({ ...current, [row.id]: event.target.value }))}>
                <option value="">Alege vanzator</option>
                {data.sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
              </select>
            </td>
            <td className="px-3 py-3"><input className="focus-input min-w-52" value={reasonById[row.id] || ""} onChange={(event) => setReasonById((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Motiv optional" /></td>
            <td className="px-3 py-3"><button className="focus-button" type="button" disabled={busy === row.id} onClick={() => reassign(row)}>Realoca</button></td>
          </tr>) : <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={7}>Nu exista vanzari cu vanzator invalid.</td></tr>}</tbody>
        </table>
      </div>
    )}
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

function crmMatches(row: CrmLead, query: string) {
  if (!query) return true;
  return [row.clientName, row.company, row.email, row.phone, row.salesperson, row.crmStatus, row.selectedCodes].join(" ").toLowerCase().includes(query);
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

function changePeriod(row: ReservationRow, onCommand: (id: string, action: string, body?: Record<string, unknown>, success?: string) => void) {
  const periodStart = window.prompt("Data noua de start campanie (YYYY-MM-DD)", row.periodStart.slice(0, 10));
  if (!periodStart) return;
  const periodEnd = window.prompt("Data noua de final campanie (YYYY-MM-DD)", row.periodEnd.slice(0, 10));
  if (!periodEnd) return;
  onCommand(row.id, "changePeriod", { periodStart, periodEnd }, "Perioada a fost schimbata.");
}

function setCrmEstimate(row: CrmLead, onUpdate: (id: string, patch: Record<string, unknown>) => void) {
  const estimatedValue = window.prompt("Valoare estimata EUR", row.estimatedValue ? String(row.estimatedValue) : "");
  if (estimatedValue == null) return;
  onUpdate(row.id, { estimatedValue });
}

function setCrmFollowUp(row: CrmLead, onUpdate: (id: string, patch: Record<string, unknown>) => void) {
  const nextFollowUpAt = window.prompt("Urmatorul follow-up (YYYY-MM-DD)", row.nextFollowUpAt ? row.nextFollowUpAt.slice(0, 10) : "");
  if (nextFollowUpAt == null) return;
  onUpdate(row.id, { nextFollowUpAt });
}

function setCrmNotes(row: CrmLead, onUpdate: (id: string, patch: Record<string, unknown>) => void) {
  const notes = window.prompt("Notite interne", row.notes || "");
  if (notes == null) return;
  onUpdate(row.id, { notes });
}

function offerStatusForCrm(status: string) {
  if (status === "OFFER_SENT") return "QUOTED";
  if (status === "WON") return "WON";
  if (status === "LOST") return "LOST";
  if (status === "CONTACTED" || status === "NEGOTIATION" || status === "RESERVATION_CREATED") return "CONTACTED";
  return "NEW";
}

function normalizeCrmPatch(patch: Record<string, unknown>) {
  const next = { ...patch };
  if (typeof next.crmStatus === "string") {
    next.status = crmStatusToDb(next.crmStatus);
    delete next.crmStatus;
  }
  if (typeof next.estimatedValue === "string") next.estimatedValue = Number(next.estimatedValue.replace(",", "."));
  if (typeof next.nextFollowUpAt === "string") {
    next.nextFollowUpDate = next.nextFollowUpAt;
    delete next.nextFollowUpAt;
  }
  return next;
}

function serializePatchedCrmLead(lead?: {
  id: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  estimatedValue: number | null;
  currency: string | null;
  nextFollowUpDate: string | null;
  notes: string | null;
  assignedToUserId?: string | null;
  assignedTo?: { id?: string; name: string; email: string } | null;
}) {
  if (!lead) return {};
  return {
    clientName: lead.contactName || lead.companyName,
    company: lead.companyName,
    email: lead.email,
    phone: lead.phone,
    assignedToUserId: lead.assignedToUserId || lead.assignedTo?.id || null,
    salesperson: lead.assignedTo?.name || "Nealocat",
    crmStatus: dbStatusToCrm(lead.status),
    status: dbStatusToCrm(lead.status),
    estimatedValue: lead.estimatedValue || 0,
    currency: lead.currency || "EUR",
    nextFollowUpAt: lead.nextFollowUpDate,
    notes: lead.notes
  };
}

function crmStatusToDb(status: string) {
  const map: Record<string, string> = {
    COLD: "cold",
    QUALIFIED: "qualified",
    IN_ANALYSIS: "in_analysis",
    IN_OFFER: "in_offer",
    IN_NEGOTIATION: "in_negotiation",
    IN_CONTRACTING: "in_contracting",
    ON_HOLD: "on_hold",
    NO_RESPONSE: "no_response",
    ACCOUNT_MANAGEMENT: "account_management",
    WON: "won",
    LOST: "lost",
    INACTIVE: "inactive",
    NEW: "cold",
    CONTACTED: "qualified",
    OFFER_SENT: "in_offer",
    NEGOTIATION: "in_negotiation",
    RESERVATION_CREATED: "on_hold"
  };
  return map[status] || status.toLowerCase();
}

function dbStatusToCrm(status: string) {
  const map: Record<string, string> = {
    cold: "COLD",
    qualified: "QUALIFIED",
    in_analysis: "IN_ANALYSIS",
    in_offer: "IN_OFFER",
    in_negotiation: "IN_NEGOTIATION",
    in_contracting: "IN_CONTRACTING",
    on_hold: "ON_HOLD",
    no_response: "NO_RESPONSE",
    account_management: "ACCOUNT_MANAGEMENT",
    won: "WON",
    lost: "LOST",
    inactive: "INACTIVE",
    new: "COLD",
    contacted: "QUALIFIED",
    brief_received: "IN_ANALYSIS",
    offer_sent: "IN_OFFER",
    negotiation: "IN_NEGOTIATION",
    hold_created: "ON_HOLD"
  };
  return map[status] || status.toUpperCase();
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
