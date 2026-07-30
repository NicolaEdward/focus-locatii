"use client";

import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  History,
  Loader2,
  Mail,
  MessageSquareText,
  Phone,
  Plus,
  Search,
  SlidersHorizontal,
  Target,
  UserRound,
  Users,
  X
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CRM_NEXT_ACTION_CATALOG,
  CRM_NEXT_ACTION_LABELS,
  CRM_OPPORTUNITY_STAGE_OPTIONS,
  CRM_PROSPECT_STATUS_OPTIONS
} from "@/lib/crm-domain";

type View = "today" | "prospecting" | "opportunities" | "all";
type RecordKind = "prospect" | "opportunity";
type Owner = { id: string; name: string; email: string; role?: string };
type NextAction = { id: string; type: string; label: string; description?: string | null; dueAt: string; priority: string };
type Prospect = {
  kind: "prospect"; id: string; companyId: string; companyName: string; taxId?: string | null; industry?: string | null;
  owner?: Owner | null; ownerId?: string | null; status: string; statusLabel: string; priority: string; contactState: string;
  source?: string | null; primaryContact?: { name: string; email?: string | null; phone?: string | null } | null;
  nextAction?: NextAction | null; version: number; createdAt: string; updatedAt: string;
};
type Opportunity = {
  kind: "opportunity"; id: string; companyId: string; companyName: string; taxId?: string | null; industry?: string | null;
  owner?: Owner | null; ownerId?: string | null; name: string; needSummary?: string | null; stage: string; stageLabel: string;
  value?: number | null; currency?: string | null; forecast: string; forecastLabel: string; decisionDate?: string | null;
  nextAction?: NextAction | null; version: number; createdAt: string; updatedAt: string;
};
type AgendaAction = {
  id: string; companyName: string; industry?: string | null; kind: RecordKind; recordId?: string | null; recordName: string;
  stage?: string; version: number; label: string; description?: string | null; dueAt: string; priority: string; owner?: Owner | null;
  opportunity?: { value?: number | null; currency?: string | null; decisionDate?: string | null } | null;
};
type WorkspaceData = {
  view: View; perspective: string;
  records: { actions: AgendaAction[]; prospects: Prospect[]; opportunities: Opportunity[] };
  pagination: { page: number; limit: number; total: number; pages: number };
  summary: {
    activeProspects: number; activeOpportunities: number; overdue: number; dueToday: number; missingAction: number; wonThisMonth: number;
    forecastByLevel: Record<string, Record<string, number>>;
  };
};

const primaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-focus-yellow px-4 py-2 text-sm font-black text-focus-ink transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-600 bg-focus-navy/60 px-4 py-2 text-sm font-bold text-white transition hover:border-focus-yellow/60 hover:bg-focus-navy disabled:cursor-not-allowed disabled:opacity-50";
const fieldClass = "min-h-10 w-full rounded-md border border-slate-600 bg-focus-ink/85 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-focus-yellow focus:ring-2 focus:ring-focus-yellow/15";

export function CrmWorkspaceV4({
  canViewTeam,
  canEdit,
  canAssignOwners,
  sessionUserId
}: {
  canViewTeam: boolean;
  canEdit: boolean;
  canAssignOwners: boolean;
  sessionUserId: string;
}) {
  const initial = useMemo(readInitialUrlState, []);
  const [view, setView] = useState<View>(initial.view);
  const [query, setQuery] = useState(initial.query);
  const [debouncedQuery, setDebouncedQuery] = useState(initial.query);
  const [ownerId, setOwnerId] = useState(initial.ownerId);
  const [status, setStatus] = useState(initial.status);
  const [stage, setStage] = useState(initial.stage);
  const [due, setDue] = useState(initial.due);
  const [page, setPage] = useState(initial.page);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createMode, setCreateMode] = useState<"prospect" | "inbound" | null>(null);
  const [selected, setSelected] = useState<{ kind: RecordKind; id: string } | null>(initial.selected);
  const [notice, setNotice] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedQuery(query.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async (silent = false) => {
    const id = ++requestId.current;
    if (!silent) setLoading(true);
    setError("");
    const controller = new AbortController();
    const params = new URLSearchParams({ view, page: String(page), limit: view === "opportunities" ? "25" : "24" });
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (ownerId) params.set("owner", ownerId);
    if (status) params.set("status", status);
    if (stage) params.set("stage", stage);
    if (due !== "all") params.set("due", due);
    replaceUrl(params);
    try {
      const response = await fetch(`/api/admin/crm/workspace?${params}`, { cache: "no-store", signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "CRM-ul nu a putut fi incarcat.");
      if (id === requestId.current) setData(payload);
    } catch (loadError) {
      if (id === requestId.current && (loadError as Error).name !== "AbortError") setError(loadError instanceof Error ? loadError.message : "CRM-ul nu a putut fi incarcat.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
    return () => controller.abort();
  }, [view, page, debouncedQuery, ownerId, status, stage, due]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!canViewTeam) return;
    fetch("/api/admin/crm/assignees", { cache: "no-store" }).then((response) => response.json()).then((payload) => setOwners(payload.assignees || [])).catch(() => setOwners([]));
  }, [canViewTeam]);

  function changeView(next: View) {
    setView(next); setPage(1); setStatus(""); setStage(""); setDue("all");
  }

  function completed(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
    void load(true);
  }

  const summary = data?.summary;
  return <main className="min-w-0 space-y-5 overflow-x-hidden pb-12">
    <header className="rounded-lg border border-slate-700/80 bg-[linear-gradient(135deg,rgba(7,27,44,.98),rgba(12,46,67,.9))] px-4 py-5 shadow-xl shadow-black/10 sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase text-focus-yellow">Comercial / CRM</p>
          <h1 className="mt-1 text-2xl font-black text-white sm:text-3xl">Relații comerciale</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-300">{canViewTeam ? (ownerId ? "Perspectiva agentului selectat" : "Perspectiva echipei") : "Perspectiva personală"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className={secondaryButton} href="/api/admin/crm/export.xlsx"><Download size={17} /> Export CRM</a>
          {canEdit ? <><button className={secondaryButton} type="button" onClick={() => setCreateMode("inbound")}><BriefcaseBusiness size={17} /> Inbound</button>
          <button className={primaryButton} type="button" onClick={() => setCreateMode("prospect")}><Plus size={18} /> Prospect nou</button></> : <span className="inline-flex min-h-10 items-center rounded-md border border-slate-600 bg-focus-navy/60 px-4 text-sm font-bold text-slate-300">Mod vizualizare</span>}
        </div>
      </div>
    </header>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="Indicatori CRM">
      <Metric label="Pipeline" value={formatCurrencyMap(summary?.forecastByLevel.pipeline)} hint="Valori integrale" icon={<CircleDollarSign size={18} />} />
      <Metric label="Posibil" value={formatCurrencyMap(summary?.forecastByLevel.possible)} hint="În negociere" icon={<Target size={18} />} />
      <Metric label="Angajament" value={formatCurrencyMap(summary?.forecastByLevel.commit)} hint="În contractare" icon={<Check size={18} />} />
      <Metric label="Restante" value={summary?.overdue ?? 0} tone={summary?.overdue ? "danger" : "normal"} icon={<AlertCircle size={18} />} />
      <Metric label="Oportunități active" value={summary?.activeOpportunities ?? 0} icon={<BriefcaseBusiness size={18} />} />
      <Metric label="Câștigate luna" value={summary?.wonThisMonth ?? 0} tone="success" icon={<Check size={18} />} />
    </section>

    <nav className="flex gap-1 overflow-x-auto rounded-lg border border-slate-700 bg-focus-navy/55 p-1" aria-label="Perspective CRM">
      {([
        ["today", "Astăzi", CalendarClock],
        ["prospecting", "Prospectare", Building2],
        ["opportunities", "Oportunități", BriefcaseBusiness],
        ["all", "Toate", SlidersHorizontal]
      ] as const).map(([value, label, Icon]) => <button
        className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md px-4 py-2 text-sm font-black transition ${view === value ? "bg-focus-yellow text-focus-ink" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}
        key={value} type="button" onClick={() => changeView(value)}><Icon size={16} /> {label}</button>)}
    </nav>

    <section className="rounded-lg border border-slate-700 bg-focus-navy/35 p-3 sm:p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_repeat(3,minmax(150px,220px))]">
        <label className="relative block min-w-0">
          <Search className="pointer-events-none absolute left-3 top-3 text-slate-500" size={17} />
          <input className={`${fieldClass} pl-10`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Caută firmă, CUI, contact..." aria-label="Căutare CRM" />
        </label>
        {canViewTeam ? <select className={fieldClass} value={ownerId} onChange={(event) => { setOwnerId(event.target.value); setPage(1); }} aria-label="Responsabil">
          <option value="">Toată echipa</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
        </select> : null}
        {view === "prospecting" || view === "all" ? <select className={fieldClass} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="Status prospect">
          <option value="">Toate statusurile</option>{CRM_PROSPECT_STATUS_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select> : null}
        {view === "opportunities" || view === "all" ? <select className={fieldClass} value={stage} onChange={(event) => { setStage(event.target.value); setPage(1); }} aria-label="Etapă oportunitate">
          <option value="">Etape active</option>{CRM_OPPORTUNITY_STAGE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select> : null}
        {view === "today" ? <select className={fieldClass} value={due} onChange={(event) => { setDue(event.target.value); setPage(1); }} aria-label="Scadență">
          <option value="all">Agenda completă</option><option value="overdue">Restante</option><option value="today">Astăzi</option><option value="upcoming">Următoarele</option>
        </select> : null}
      </div>
    </section>

    {notice ? <div className="fixed bottom-5 right-5 z-[100] max-w-sm rounded-md border border-emerald-400/30 bg-emerald-950 px-4 py-3 text-sm font-bold text-emerald-100 shadow-2xl"><Check className="mr-2 inline" size={17} />{notice}</div> : null}
    {error ? <ErrorState message={error} onRetry={() => void load()} /> : loading && !data ? <LoadingState /> : <WorkspaceBody view={view} data={data} onOpen={(kind, id) => setSelected({ kind, id })} />}

    {data && data.pagination.pages > 1 ? <Pagination pagination={data.pagination} onPage={setPage} /> : null}
    {canEdit && createMode ? <CreateDialog mode={createMode} owners={owners} canAssignOwners={canAssignOwners} sessionUserId={sessionUserId} onClose={() => setCreateMode(null)} onCreated={(message) => { setCreateMode(null); completed(message); }} /> : null}
    {selected ? <RecordDrawer selected={selected} canEdit={canEdit} onClose={() => setSelected(null)} onChanged={completed} /> : null}
  </main>;
}

function WorkspaceBody({ view, data, onOpen }: { view: View; data: WorkspaceData | null; onOpen: (kind: RecordKind, id: string) => void }) {
  if (!data) return null;
  if (view === "today") return <TodayView rows={data.records.actions} onOpen={onOpen} />;
  if (view === "prospecting") return <ProspectingView rows={data.records.prospects} onOpen={onOpen} />;
  if (view === "opportunities") return <OpportunityPipeline rows={data.records.opportunities} onOpen={onOpen} />;
  return <AllRecordsView prospects={data.records.prospects} opportunities={data.records.opportunities} onOpen={onOpen} />;
}

function TodayView({ rows, onOpen }: { rows: AgendaAction[]; onOpen: (kind: RecordKind, id: string) => void }) {
  if (!rows.length) return <EmptyState icon={<Check size={24} />} title="Agenda este curată" text="Nu există acțiuni în filtrul curent." />;
  return <section className="space-y-2" aria-label="Agenda de astăzi">{rows.map((row) => {
    const overdue = new Date(row.dueAt) < startToday();
    return <button className="grid w-full min-w-0 gap-3 rounded-lg border border-slate-700 bg-focus-navy/45 p-4 text-left transition hover:border-focus-yellow/45 hover:bg-focus-navy/70 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center" type="button" key={row.id} onClick={() => row.recordId && onOpen(row.kind, row.recordId)}>
      <span className="min-w-0"><span className="block truncate font-black text-white">{row.companyName}</span><span className="mt-1 block truncate text-sm text-slate-300">{row.label}{row.recordName ? ` / ${row.recordName}` : ""}</span></span>
      <span className={`inline-flex items-center gap-2 text-sm font-bold ${overdue ? "text-red-200" : "text-slate-300"}`}><Clock3 size={16} /> {dateTime(row.dueAt)}</span>
      <span className="text-sm font-bold text-slate-300">{row.owner?.name || "Nealocat"}<ArrowRight className="ml-2 inline" size={15} /></span>
    </button>;
  })}</section>;
}

function ProspectingView({ rows, onOpen }: { rows: Prospect[]; onOpen: (kind: RecordKind, id: string) => void }) {
  if (!rows.length) return <EmptyState icon={<Building2 size={24} />} title="Niciun prospect" text="Adaugă primul prospect Cold sau schimbă filtrele." />;
  return <section className="overflow-hidden rounded-lg border border-slate-700 bg-focus-navy/35">
    <div className="hidden grid-cols-[minmax(220px,1.4fr)_minmax(150px,.8fr)_minmax(160px,.8fr)_minmax(190px,1fr)_auto] gap-4 border-b border-slate-700 px-4 py-3 text-xs font-black uppercase text-slate-400 lg:grid"><span>Firmă</span><span>Status</span><span>Contact</span><span>Următoarea acțiune</span><span></span></div>
    {rows.map((row) => <button className="grid w-full min-w-0 gap-3 border-b border-slate-700/70 px-4 py-4 text-left transition last:border-0 hover:bg-white/[.035] lg:grid-cols-[minmax(220px,1.4fr)_minmax(150px,.8fr)_minmax(160px,.8fr)_minmax(190px,1fr)_auto] lg:items-center" key={row.id} type="button" onClick={() => onOpen("prospect", row.id)}>
      <span className="min-w-0"><strong className="block truncate text-white">{row.companyName}</strong><small className="block truncate text-slate-400">{row.industry || "Domeniu nesetat"} · {row.source || "Sursă nesetată"}</small></span>
      <StatusPill tone={row.status === "qualified" ? "green" : row.status === "prospecting" ? "yellow" : "neutral"}>{row.statusLabel}</StatusPill>
      <span className="min-w-0 text-sm text-slate-300"><span className="block truncate">{row.primaryContact?.name || "Contact de identificat"}</span><small className="block truncate text-slate-500">{row.primaryContact?.email || row.primaryContact?.phone || "-"}</small></span>
      <ActionSummary action={row.nextAction} />
      <ArrowRight className="text-slate-500" size={18} />
    </button>)}
  </section>;
}

function OpportunityPipeline({ rows, onOpen }: { rows: Opportunity[]; onOpen: (kind: RecordKind, id: string) => void }) {
  if (!rows.length) return <EmptyState icon={<BriefcaseBusiness size={24} />} title="Nicio oportunitate" text="Nu exista oportunitati in etapele si filtrele selectate." />;
  const stages = CRM_OPPORTUNITY_STAGE_OPTIONS.filter((stage) => rows.some((row) => row.stage === stage.value));
  const minWidth = Math.max(280, stages.length * 280);
  return <section className="overflow-x-auto pb-2" aria-label="Pipeline oportunități">
    <div className="grid gap-3" style={{ minWidth, gridTemplateColumns: `repeat(${stages.length}, minmax(260px, 1fr))` }}>{stages.map((stage) => {
      const stageRows = rows.filter((row) => row.stage === stage.value);
      return <div className="min-w-0 rounded-lg border border-slate-700 bg-focus-navy/30" key={stage.value}>
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3"><h2 className="text-sm font-black text-white">{stage.label}</h2><span className="rounded-full bg-white/5 px-2 py-1 text-xs font-black text-slate-300">{stageRows.length}</span></div>
        <div className="space-y-2 p-2">{stageRows.map((row) => <OpportunityCard key={row.id} row={row} onOpen={onOpen} />)}</div>
      </div>;
    })}</div>
  </section>;
}

function OpportunityCard({ row, onOpen }: { row: Opportunity; onOpen: (kind: RecordKind, id: string) => void }) {
  const overdue = row.nextAction && new Date(row.nextAction.dueAt) < startToday();
  return <button className="w-full min-w-0 rounded-lg border border-slate-700 bg-focus-ink/75 p-3 text-left shadow-sm transition hover:border-focus-yellow/50 hover:bg-focus-ink" type="button" onClick={() => onOpen("opportunity", row.id)}>
    <div className="flex min-w-0 items-start justify-between gap-2"><span className="min-w-0"><strong className="block truncate text-sm text-white">{row.companyName}</strong><span className="mt-1 block line-clamp-2 text-xs text-slate-300">{row.name}</span></span><StatusPill>{row.forecastLabel}</StatusPill></div>
    <p className="mt-4 text-xl font-black text-white">{money(row.value, row.currency)}</p>
    <div className="mt-3 space-y-1.5 text-xs text-slate-400">
      <p className={overdue ? "font-bold text-red-200" : ""}><CalendarClock className="mr-1.5 inline" size={14} />{row.nextAction ? `${row.nextAction.label} · ${date(row.nextAction.dueAt)}` : "Fără următor pas"}</p>
      <p><Target className="mr-1.5 inline" size={14} />Decizie {row.decisionDate ? date(row.decisionDate) : "nesetată"}</p>
      <p><UserRound className="mr-1.5 inline" size={14} />{row.owner?.name || "Nealocat"}</p>
    </div>
  </button>;
}

function AllRecordsView({ prospects, opportunities, onOpen }: { prospects: Prospect[]; opportunities: Opportunity[]; onOpen: (kind: RecordKind, id: string) => void }) {
  if (!prospects.length && !opportunities.length) return <EmptyState icon={<Search size={24} />} title="Niciun rezultat" text="Schimbă filtrele sau termenul de căutare." />;
  return <div className="space-y-5">
    {opportunities.length ? <section><SectionTitle title="Oportunități" count={opportunities.length} /><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{opportunities.map((row) => <OpportunityCard row={row} onOpen={onOpen} key={row.id} />)}</div></section> : null}
    {prospects.length ? <section><SectionTitle title="Prospectări" count={prospects.length} /><ProspectingView rows={prospects} onOpen={onOpen} /></section> : null}
  </div>;
}

function CreateDialog({ mode, owners, canAssignOwners, sessionUserId, onClose, onCreated }: { mode: "prospect" | "inbound"; owners: Owner[]; canAssignOwners: boolean; sessionUserId: string; onClose: () => void; onCreated: (message: string) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [duplicatePayload, setDuplicatePayload] = useState<Record<string, unknown> | null>(null);
  const [prospectStatus, setProspectStatus] = useState<(typeof CRM_PROSPECT_STATUS_OPTIONS)[number]["value"]>("prospecting");
  const qualifiedProspect = mode === "prospect" && prospectStatus === "qualified";

  async function submit(event: FormEvent<HTMLFormElement>, allowPotentialDuplicate = false) {
    event.preventDefault(); setPending(true); setError("");
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = duplicatePayload && allowPotentialDuplicate ? { ...duplicatePayload, allowPotentialDuplicate: true } : {
      action: mode === "prospect" ? "create_prospect" : "create_inbound",
      companyName: textValue(form, "companyName"), taxId: textValue(form, "taxId"), industry: textValue(form, "industry"), source: textValue(form, "source"),
      status: mode === "prospect" ? prospectStatus : undefined,
      ownerId: textValue(form, "ownerId") || sessionUserId, contactName: textValue(form, "contactName"), contactRole: textValue(form, "contactRole"),
      email: textValue(form, "email"), phone: textValue(form, "phone"), nextActionDueAt: textValue(form, "nextActionDueAt"),
      nextActionType: mode === "prospect" ? undefined : "request_full_brief",
      opportunityName: textValue(form, "opportunityName"), needSummary: textValue(form, "needSummary"),
      geography: textValue(form, "geography"), formats: textValue(form, "formats"), idempotencyKey: crypto.randomUUID()
    };
    try {
      const response = await fetch("/api/admin/crm/commands", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === "CRM_POSSIBLE_DUPLICATE") setDuplicatePayload(payload);
        throw new Error(result.error || "Înregistrarea nu a putut fi creată.");
      }
      onCreated(mode === "prospect" ? "Prospectul a fost creat." : "Oportunitatea inbound a fost creată.");
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Înregistrarea nu a putut fi creată."); }
    finally { setPending(false); }
  }

  return <ModalShell title={mode === "prospect" ? "Prospect nou" : "Oportunitate inbound"} onClose={onClose}>
    <form className="space-y-5" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Firmă *"><input className={fieldClass} name="companyName" required minLength={2} autoFocus /></Field>
        <Field label={mode === "inbound" || qualifiedProspect ? "CUI *" : "CUI (opțional)"}><input className={fieldClass} name="taxId" required={mode === "inbound" || qualifiedProspect} /></Field>
        {mode === "prospect" ? <Field label="Stadiu inițial"><select className={fieldClass} value={prospectStatus} onChange={(event) => setProspectStatus(event.target.value as (typeof CRM_PROSPECT_STATUS_OPTIONS)[number]["value"])}>{CRM_PROSPECT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field> : null}
        <Field label="Domeniu"><input className={fieldClass} name="industry" placeholder="Retail, betting, auto..." /></Field>
        <Field label="Sursă"><input className={fieldClass} name="source" placeholder="Prospectare proprie" /></Field>
        {canAssignOwners ? <Field label="Responsabil"><select className={fieldClass} name="ownerId" defaultValue={sessionUserId}><option value={sessionUserId}>Eu</option>{owners.filter((owner) => owner.id !== sessionUserId).map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></Field> : null}
        <Field label={mode === "inbound" || qualifiedProspect ? "Persoană de contact *" : "Persoană de contact"}><input className={fieldClass} name="contactName" required={mode === "inbound" || qualifiedProspect} /></Field>
        <Field label="Funcție"><input className={fieldClass} name="contactRole" /></Field>
        <Field label="Email"><input className={fieldClass} name="email" type="email" /></Field>
        <Field label="Telefon"><input className={fieldClass} name="phone" inputMode="tel" /></Field>
        <Field label="Următorul contact"><input className={fieldClass} name="nextActionDueAt" type="datetime-local" /></Field>
      </div>
      {qualifiedProspect ? <p className="rounded-md border border-emerald-400/25 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100">Un prospect calificat pornește cu CUI și persoană de contact obligatorii. Oportunitatea comercială se creează separat, când există o nevoie OOH concretă.</p> : null}
      {mode === "inbound" ? <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Oportunitate"><input className={fieldClass} name="opportunityName" placeholder="Firmă - OOH" /></Field>
        <Field label="Nevoie concretă *" wide><textarea className={`${fieldClass} min-h-24`} name="needSummary" required /></Field>
        <Field label="Geografie"><input className={fieldClass} name="geography" /></Field><Field label="Formate"><input className={fieldClass} name="formats" /></Field>
      </div> : null}
      {error ? <p className="rounded-md bg-red-950/60 px-3 py-2 text-sm font-bold text-red-100">{error}</p> : null}
      {duplicatePayload ? <button className={secondaryButton} type="button" disabled={pending} onClick={(event) => { const form = event.currentTarget.closest("form"); if (form) void submit({ preventDefault() {}, currentTarget: form } as FormEvent<HTMLFormElement>, true); }}>Am verificat, creează separat</button> : null}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-700 bg-focus-navy/95 pt-4"><button className={secondaryButton} type="button" onClick={onClose}>Renunță</button><button className={primaryButton} disabled={pending} type="submit">{pending ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />} Creează</button></div>
    </form>
  </ModalShell>;
}

function RecordDrawer({ selected, canEdit, onClose, onChanged }: { selected: { kind: RecordKind; id: string }; canEdit: boolean; onClose: () => void; onChanged: (message: string) => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/admin/crm/records/${selected.kind}/${selected.id}`, { cache: "no-store" });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Dosarul nu a putut fi încărcat.");
      setDetail(payload.record); setEvents(payload.events?.rows || []);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Dosarul nu a putut fi încărcat."); }
    finally { setLoading(false); }
  }, [selected]);
  useEffect(() => { void load(); }, [load]);

  async function command(payload: Record<string, unknown>, message: string) {
    setPending(true); setError("");
    try {
      const response = await fetch("/api/admin/crm/commands", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, idempotencyKey: crypto.randomUUID() }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Modificarea nu a putut fi salvată.");
      await load(); onChanged(message);
    } catch (commandError) { setError(commandError instanceof Error ? commandError.message : "Modificarea nu a putut fi salvată."); }
    finally { setPending(false); }
  }

  return <aside className="fixed inset-0 z-[90] flex justify-end bg-black/65" role="dialog" aria-modal="true" aria-label="Dosar CRM">
    <div className="h-full w-full max-w-3xl overflow-y-auto border-l border-slate-700 bg-focus-ink shadow-2xl">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-700 bg-focus-ink/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="min-w-0"><p className="text-xs font-black uppercase text-focus-yellow">Dosar {selected.kind === "prospect" ? "prospect" : "oportunitate"}</p><h2 className="mt-1 truncate text-xl font-black text-white">{detail?.companyName || "Se încarcă..."}</h2></div>
        <button className="rounded-md p-2 text-slate-300 hover:bg-white/10 hover:text-white" onClick={onClose} type="button" aria-label="Închide"><X size={22} /></button>
      </div>
      <div className="space-y-5 p-4 sm:p-6">
        {loading ? <LoadingState compact /> : error && !detail ? <ErrorState message={error} onRetry={() => void load()} /> : detail ? <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MiniMetric label="Etapă" value={detail.statusLabel || detail.stageLabel} />
            <MiniMetric label="Responsabil" value={detail.owner?.name || "Nealocat"} />
            {selected.kind === "opportunity" ? <><MiniMetric label="Valoare integrală" value={money(detail.value, detail.currency)} /><MiniMetric label="Forecast" value={detail.forecastLabel} /></> : <><MiniMetric label="Sursă" value={detail.source || "-"} /><MiniMetric label="Contact" value={detail.contactState || "-"} /></>}
          </section>
          {error ? <p className="rounded-md bg-red-950/60 px-3 py-2 text-sm font-bold text-red-100">{error}</p> : null}
          <section className="rounded-lg border border-slate-700 bg-focus-navy/35 p-4">
            <SectionTitle title="Următorul pas" count={detail.nextAction ? 1 : 0} />
            <ActionSummary action={detail.nextAction} />
          </section>
          {!canEdit ? <p className="rounded-md border border-slate-700 bg-focus-navy/40 px-4 py-3 text-sm text-slate-300">Ai acces complet la informații și istoric, fără drept de modificare.</p> : null}
          {canEdit && selected.kind === "prospect" && ["prospecting", "qualified"].includes(detail.status) ? <QualifyPanel detail={detail} pending={pending} onSubmit={(payload) => command(payload, payload.action === "qualify_prospect" ? "Prospectul a fost calificat." : "Oportunitatea a fost creată.")} /> : null}
          {canEdit && selected.kind === "opportunity" && ["opportunity", "quoted", "negotiation", "contracting"].includes(detail.stage) ? <OpportunityTransitionPanel detail={detail} pending={pending} onSubmit={(payload) => command(payload, "Etapa oportunității a fost actualizată.")} /> : null}
          {selected.kind === "opportunity" && detail.stage === "won" ? <section className="rounded-lg border border-emerald-400/25 bg-emerald-950/25 p-4">
            <SectionTitle title="Predare catre portofoliul comercial" count={0} />
            <p className="text-sm text-slate-300">CRM-ul si portofoliul de clienti raman separate. Clientul si campania se creeaza sau se confirma numai printr-o actiune explicita.</p>
            {canEdit ? <div className="mt-4 flex justify-end"><Link className={primaryButton} href={`/admin/clienti?crmOpportunityId=${encodeURIComponent(detail.id)}`}><ArrowRight size={17} /> Pregateste clientul si campania</Link></div> : null}
          </section> : null}
          {canEdit ? <ActivityPanel detail={detail} pending={pending} onSubmit={(payload) => command(payload, "Update-ul a fost adăugat în istoric.")} /> : null}
          <details className="rounded-lg border border-slate-700 bg-focus-navy/25"><summary className="cursor-pointer px-4 py-3 font-black text-white">Firmă și contacte</summary><div className="border-t border-slate-700 p-4"><CompanyContacts detail={detail} canEdit={canEdit} pending={pending} command={command} /></div></details>
          <section><SectionTitle title="Istoric" count={events.length} /><Timeline rows={events} /></section>
        </> : null}
      </div>
    </div>
  </aside>;
}

function QualifyPanel({ detail, pending, onSubmit }: { detail: any; pending: boolean; onSubmit: (payload: Record<string, unknown>) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value === "qualify_only") {
      onSubmit({ action: "qualify_prospect", prospectId: detail.id, version: detail.version,
        qualificationSummary: { needConfirmed: true, contextConfirmed: true }, nextActionDueAt: textValue(form, "nextActionDueAt") });
      return;
    }
    onSubmit({ action: "qualify_and_create_opportunity", prospectId: detail.id, version: detail.version,
      qualificationSummary: { needConfirmed: true, contextConfirmed: true }, opportunityName: textValue(form, "opportunityName"), needSummary: textValue(form, "needSummary"),
      geography: textValue(form, "geography"), formats: textValue(form, "formats"), nextActionType: "request_full_brief", nextActionDueAt: textValue(form, "nextActionDueAt") });
  }
  const ready = Boolean(detail.company?.taxId && detail.company?.contacts?.length);
  const alreadyQualified = detail.status === "qualified";
  return <section className="rounded-lg border border-focus-yellow/25 bg-focus-yellow/[.035] p-4"><SectionTitle title={alreadyQualified ? "Creează oportunitatea" : "Calificare OOH"} count={0} />
    {!ready ? <p className="mb-4 rounded-md bg-amber-950/60 px-3 py-2 text-sm text-amber-100">Completează CUI-ul și cel puțin un contact în secțiunea Firmă și contacte.</p> : null}
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}><Field label="Oportunitate"><input className={fieldClass} name="opportunityName" defaultValue={`${detail.companyName} - OOH`} /></Field><Field label="Nevoie concretă" wide><textarea className={`${fieldClass} min-h-20`} name="needSummary" /></Field><Field label="Geografie"><input className={fieldClass} name="geography" /></Field><Field label="Formate"><input className={fieldClass} name="formats" /></Field><Field label="Următorul pas *"><input className={fieldClass} name="nextActionDueAt" type="datetime-local" required defaultValue={localInputDate(addDays(new Date(), 2))} /></Field><div className="flex flex-wrap items-end justify-end gap-2 sm:col-span-2">{!alreadyQualified ? <button className={secondaryButton} disabled={pending || !ready} name="intent" type="submit" value="qualify_only">Califică fără oportunitate</button> : null}<button className={primaryButton} disabled={pending || !ready} name="intent" type="submit" value="qualify_and_create"><ArrowRight size={17} /> {alreadyQualified ? "Creează oportunitatea" : "Califică și creează oportunitatea"}</button></div></form>
  </section>;
}

function OpportunityTransitionPanel({ detail, pending, onSubmit }: { detail: any; pending: boolean; onSubmit: (payload: Record<string, unknown>) => void }) {
  const [toStage, setToStage] = useState(nextOpportunityStage(detail.stage));
  const active = ["opportunity", "quoted", "negotiation", "contracting"].includes(toStage);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    onSubmit({ action: "transition_opportunity", opportunityId: detail.id, version: detail.version, toStage,
      quotedValue: numberValue(form, "quotedValue"), revisedValue: numberValue(form, "revisedValue"), agreedValue: numberValue(form, "agreedValue"),
      currency: textValue(form, "currency") || detail.currency || "EUR", decisionDate: textValue(form, "decisionDate"), reason: textValue(form, "reason"),
      lostReasonCode: toStage === "lost" ? textValue(form, "lostReasonCode") || "other" : null,
      nextActionType: active ? textValue(form, "nextActionType") : null, nextActionDescription: textValue(form, "nextActionDescription"), nextActionDueAt: active ? textValue(form, "nextActionDueAt") : null });
  }
  const options = CRM_OPPORTUNITY_STAGE_OPTIONS.filter((option) => opportunityTargets(detail.stage).includes(option.value));
  const actions = CRM_NEXT_ACTION_CATALOG[toStage] || ["other"];
  return <section className="rounded-lg border border-slate-700 bg-focus-navy/35 p-4"><SectionTitle title="Avansează oportunitatea" count={0} />
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}><Field label="Etapa următoare"><select className={fieldClass} value={toStage} onChange={(event) => setToStage(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
      {(["quoted", "negotiation", "contracting", "won"].includes(toStage) || detail.value) ? <><Field label="Valoare ofertată"><input className={fieldClass} name="quotedValue" type="number" min="0" step="0.01" defaultValue={detail.value ?? ""} /></Field><Field label="Monedă"><select className={fieldClass} name="currency" defaultValue={detail.currency || "EUR"}><option>EUR</option><option>RON</option></select></Field><Field label="Data deciziei"><input className={fieldClass} name="decisionDate" type="date" defaultValue={dateInput(detail.decisionDate)} /></Field></> : null}
      {toStage === "won" ? <Field label="Valoare finală agreată *"><input className={fieldClass} name="agreedValue" type="number" min="0" step="0.01" required defaultValue={detail.value ?? ""} /></Field> : null}
      {toStage === "negotiation" ? <Field label="Valoare revizuită"><input className={fieldClass} name="revisedValue" type="number" min="0" step="0.01" defaultValue={detail.value ?? ""} /></Field> : null}
      {toStage === "lost" ? <><Field label="Categorie pierdere *"><select className={fieldClass} name="lostReasonCode" required><option value="budget">Buget</option><option value="timing">Perioadă</option><option value="competition">Concurență</option><option value="no_decision">Fără decizie</option><option value="other">Alt motiv</option></select></Field><Field label="Motiv detaliat *"><textarea className={fieldClass} name="reason" required /></Field></> : null}
      {active ? <><Field label="Următoarea acțiune *"><select className={fieldClass} name="nextActionType" required>{actions.map((action) => <option key={action} value={action}>{CRM_NEXT_ACTION_LABELS[action] || action}</option>)}</select></Field><Field label="Termen *"><input className={fieldClass} name="nextActionDueAt" type="datetime-local" required defaultValue={localInputDate(addDays(new Date(), 2))} /></Field><Field label="Detalii acțiune" wide><input className={fieldClass} name="nextActionDescription" /></Field></> : null}
      <div className="sm:col-span-2 flex justify-end"><button className={primaryButton} disabled={pending || !toStage} type="submit"><ArrowRight size={17} /> Confirmă etapa</button></div>
    </form>
  </section>;
}

function ActivityPanel({ detail, pending, onSubmit }: { detail: any; pending: boolean; onSubmit: (payload: Record<string, unknown>) => void }) {
  const stage = detail.stage || detail.status;
  const actions = CRM_NEXT_ACTION_CATALOG[stage] || ["other"];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    onSubmit({ action: "add_update", kind: detail.kind, id: detail.id, version: detail.version, type: textValue(form, "type"), summary: textValue(form, "summary"), result: textValue(form, "result"), nextActionType: textValue(form, "nextActionType"), nextActionDescription: textValue(form, "nextActionDescription"), nextActionDueAt: textValue(form, "nextActionDueAt") });
  }
  const active = ["prospecting", "qualified", "opportunity", "quoted", "negotiation", "contracting"].includes(stage);
  return <section className="rounded-lg border border-slate-700 bg-focus-navy/35 p-4"><SectionTitle title="Update comercial" count={0} /><form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
    <Field label="Tip"><select className={fieldClass} name="type"><option value="call">Apel</option><option value="email">Email</option><option value="meeting">Întâlnire</option><option value="message">Mesaj</option><option value="note">Observație</option><option value="feedback">Feedback</option></select></Field>
    <Field label="Rezumat *" wide><textarea className={`${fieldClass} min-h-20`} name="summary" required /></Field><Field label="Rezultat"><input className={fieldClass} name="result" /></Field>
    {active ? <><Field label="Următoarea acțiune *"><select className={fieldClass} name="nextActionType" required>{actions.map((action) => <option key={action} value={action}>{CRM_NEXT_ACTION_LABELS[action] || action}</option>)}</select></Field><Field label="Termen *"><input className={fieldClass} name="nextActionDueAt" type="datetime-local" required defaultValue={localInputDate(addDays(new Date(), 2))} /></Field><Field label="Detalii acțiune"><input className={fieldClass} name="nextActionDescription" /></Field></> : null}
    <div className="sm:col-span-2 flex justify-end"><button className={primaryButton} disabled={pending} type="submit"><MessageSquareText size={17} /> Salvează update</button></div>
  </form></section>;
}

function CompanyContacts({ detail, canEdit, pending, command }: { detail: any; canEdit: boolean; pending: boolean; command: (payload: Record<string, unknown>, message: string) => Promise<void> }) {
  const company = detail.company;
  function saveCompany(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); void command({ action: "update_company", companyId: company.id, version: company.version, name: textValue(form, "name"), taxId: textValue(form, "taxId"), industry: textValue(form, "industry"), website: textValue(form, "website") }, "Datele firmei au fost actualizate."); }
  function addContact(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); void command({ action: "add_contact", companyId: company.id, name: textValue(form, "name"), role: textValue(form, "role"), email: textValue(form, "email"), phone: textValue(form, "phone"), isPrimary: company.contacts.length === 0 }, "Contactul a fost adăugat."); event.currentTarget.reset(); }
  return <div className="space-y-5">{canEdit ? <form className="grid gap-3 sm:grid-cols-2" onSubmit={saveCompany}><Field label="Firmă"><input className={fieldClass} name="name" defaultValue={company.name} required /></Field><Field label="CUI"><input className={fieldClass} name="taxId" defaultValue={company.taxId || ""} /></Field><Field label="Domeniu"><input className={fieldClass} name="industry" defaultValue={company.industry || ""} /></Field><Field label="Website"><input className={fieldClass} name="website" defaultValue={company.website || ""} /></Field><div className="sm:col-span-2 flex justify-end"><button className={secondaryButton} disabled={pending}>Salvează firma</button></div></form> : <div className="grid gap-3 text-sm sm:grid-cols-2"><MiniMetric label="Firmă" value={company.name} /><MiniMetric label="CUI" value={company.taxId || "-"} /><MiniMetric label="Domeniu" value={company.industry || "-"} /><MiniMetric label="Website" value={company.website || "-"} /></div>}
    <div className="space-y-2">{company.contacts?.map((contact: any) => <div className="grid gap-2 rounded-md bg-white/[.035] p-3 text-sm sm:grid-cols-[1fr_auto]" key={contact.id}><span><strong className="text-white">{contact.name}</strong><small className="block text-slate-400">{contact.role || "Funcție nesetată"}</small></span><span className="text-slate-300">{contact.email ? <span className="block"><Mail className="mr-1 inline" size={13} />{contact.email}</span> : null}{contact.phone ? <span className="block"><Phone className="mr-1 inline" size={13} />{contact.phone}</span> : null}</span></div>)}</div>
    {canEdit ? <form className="grid gap-3 sm:grid-cols-2" onSubmit={addContact}><Field label="Contact nou *"><input className={fieldClass} name="name" required /></Field><Field label="Funcție"><input className={fieldClass} name="role" /></Field><Field label="Email"><input className={fieldClass} name="email" type="email" /></Field><Field label="Telefon"><input className={fieldClass} name="phone" /></Field><div className="sm:col-span-2 flex justify-end"><button className={secondaryButton} disabled={pending}><Plus size={16} /> Adaugă contact</button></div></form> : null}
  </div>;
}

function Timeline({ rows }: { rows: any[] }) {
  if (!rows.length) return <p className="rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">Istoricul este gol.</p>;
  return <ol className="space-y-0">{rows.map((row, index) => <li className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-3 pb-5" key={row.id}><span className="relative flex justify-center"><span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-focus-yellow"></span>{index < rows.length - 1 ? <span className="absolute bottom-0 top-4 w-px bg-slate-700"></span> : null}</span><span className="min-w-0"><strong className="block text-sm text-white">{row.summary}</strong><span className="mt-1 block text-xs text-slate-400">{row.actor?.name || "Sistem"} · {dateTime(row.occurredAt)}</span>{row.result ? <p className="mt-2 text-sm text-slate-300">{row.result}</p> : null}</span></li>)}</ol>;
}

function Metric({ label, value, hint, icon, tone = "normal" }: { label: string; value: string | number; hint?: string; icon: React.ReactNode; tone?: "normal" | "danger" | "success" }) {
  return <div className={`rounded-lg border p-4 ${tone === "danger" ? "border-red-400/30 bg-red-950/35" : tone === "success" ? "border-emerald-400/25 bg-emerald-950/25" : "border-slate-700 bg-focus-navy/40"}`}><div className="flex items-center justify-between text-slate-400"><p className="text-xs font-black uppercase">{label}</p>{icon}</div><p className="mt-3 break-words text-xl font-black text-white">{value}</p>{hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}</div>;
}
function MiniMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-md bg-white/[.035] p-3"><p className="text-xs font-black uppercase text-slate-500">{label}</p><p className="mt-1 truncate text-sm font-black text-white" title={value}>{value}</p></div>; }
function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "yellow" }) { return <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-black ${tone === "green" ? "bg-emerald-400/12 text-emerald-200" : tone === "yellow" ? "bg-focus-yellow/12 text-focus-yellow" : "bg-white/[.07] text-slate-300"}`}>{children}</span>; }
function ActionSummary({ action }: { action?: NextAction | null }) { if (!action) return <span className="text-sm font-bold text-red-200">Fără următor pas</span>; const overdue = new Date(action.dueAt) < startToday(); return <span className="min-w-0 text-sm"><strong className="block truncate text-slate-200">{action.label}</strong><small className={`block ${overdue ? "font-bold text-red-200" : "text-slate-500"}`}>{dateTime(action.dueAt)}</small></span>; }
function SectionTitle({ title, count }: { title: string; count: number }) { return <div className="mb-3 flex items-center gap-2"><h2 className="text-sm font-black text-white">{title}</h2>{count ? <span className="rounded-full bg-white/[.07] px-2 py-0.5 text-xs font-black text-slate-300">{count}</span> : null}</div>; }
function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) { return <label className={`block min-w-0 ${wide ? "sm:col-span-2" : ""}`}><span className="mb-1.5 block text-xs font-black uppercase text-slate-400">{label}</span>{children}</label>; }
function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="rounded-lg border border-dashed border-slate-700 px-5 py-12 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/5 text-focus-yellow">{icon}</span><h2 className="mt-4 font-black text-white">{title}</h2><p className="mt-1 text-sm text-slate-400">{text}</p></div>; }
function LoadingState({ compact = false }: { compact?: boolean }) { return <div className={`flex items-center justify-center gap-3 text-sm font-bold text-slate-400 ${compact ? "py-12" : "rounded-lg border border-slate-700 py-20"}`}><Loader2 className="animate-spin text-focus-yellow" size={20} /> Se încarcă...</div>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="rounded-lg border border-red-400/25 bg-red-950/25 p-5"><p className="font-bold text-red-100">{message}</p><button className={`${secondaryButton} mt-4`} onClick={onRetry} type="button">Reîncearcă</button></div>; }
function Pagination({ pagination, onPage }: { pagination: WorkspaceData["pagination"]; onPage: (page: number) => void }) { return <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-focus-navy/35 p-3 text-sm text-slate-300"><span>{pagination.total} înregistrări · pagina {pagination.page}/{pagination.pages}</span><span className="flex gap-2"><button className={secondaryButton} disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)} aria-label="Pagina anterioară"><ChevronLeft size={17} /></button><button className={secondaryButton} disabled={pagination.page >= pagination.pages} onClick={() => onPage(pagination.page + 1)} aria-label="Pagina următoare"><ChevronRight size={17} /></button></span></div>; }
function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true"><div className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-t-lg border border-slate-700 bg-focus-navy p-4 shadow-2xl sm:rounded-lg sm:p-6"><div className="mb-5 flex items-center justify-between gap-4"><h2 className="text-xl font-black text-white">{title}</h2><button className="rounded-md p-2 text-slate-300 hover:bg-white/10" onClick={onClose} type="button" aria-label="Închide"><X size={21} /></button></div>{children}</div></div>; }

function readInitialUrlState() {
  if (typeof window === "undefined") return { view: "today" as View, query: "", ownerId: "", status: "", stage: "", due: "all", page: 1, selected: null as { kind: RecordKind; id: string } | null };
  const params = new URLSearchParams(window.location.search); const candidate = params.get("view");
  const kind = params.get("kind"); const record = params.get("record");
  return { view: (["today", "prospecting", "opportunities", "all"].includes(candidate || "") ? candidate : "today") as View, query: params.get("q") || "", ownerId: params.get("owner") || "", status: params.get("status") || "", stage: params.get("stage") || "", due: params.get("due") || "all", page: Math.max(1, Number(params.get("page") || 1)), selected: record && (kind === "prospect" || kind === "opportunity") ? { kind: kind as RecordKind, id: record } : null };
}
function replaceUrl(params: URLSearchParams) { if (typeof window !== "undefined") window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`); }
function textValue(form: FormData, key: string) { return String(form.get(key) || "").trim() || null; }
function numberValue(form: FormData, key: string) { const value = textValue(form, key); if (!value) return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function formatCurrencyMap(values?: Record<string, number>) { const rows = Object.entries(values || {}); return rows.length ? rows.map(([currency, value]) => money(value, currency)).join(" · ") : "0"; }
function money(value?: number | null, currency?: string | null) { if (value == null) return "Nesetată"; return new Intl.NumberFormat("ro-RO", { style: "currency", currency: currency || "EUR", maximumFractionDigits: 2 }).format(value); }
function date(value?: string | null) { return value ? new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value)) : "-"; }
function dateTime(value?: string | null) { return value ? new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "-"; }
function startToday() { const value = new Date(); value.setHours(0, 0, 0, 0); return value; }
function addDays(value: Date, days: number) { return new Date(value.getTime() + days * 86_400_000); }
function localInputDate(value: Date) { const offset = value.getTimezoneOffset() * 60_000; return new Date(value.getTime() - offset).toISOString().slice(0, 16); }
function dateInput(value?: string | null) { return value ? new Date(value).toISOString().slice(0, 10) : ""; }
function nextOpportunityStage(stage: string) { return ({ opportunity: "quoted", quoted: "negotiation", negotiation: "contracting", contracting: "won" } as Record<string, string>)[stage] || ""; }
function opportunityTargets(stage: string) { return ({ opportunity: ["quoted", "lost", "on_hold", "inactive"], quoted: ["negotiation", "lost", "on_hold", "inactive"], negotiation: ["quoted", "contracting", "lost", "on_hold", "inactive"], contracting: ["negotiation", "won", "lost", "on_hold", "inactive"] } as Record<string, string[]>)[stage] || []; }
