"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CircleDollarSign,
  Clock3,
  Mail,
  MessageSquareText,
  Phone,
  Plus,
  Search,
  Target,
  UserPlus,
  Users,
  X
} from "lucide-react";
import { CRM_STATUS_OPTIONS, type CrmStatus } from "@/lib/crm";

type Assignee = { id: string; name: string; email: string; role: string };
type Summary = {
  total: number;
  active: number;
  overdue: number;
  dueToday: number;
  missingNextStep: number;
  dormant: number;
  wonThisMonth: number;
  lostThisMonth: number;
  pipelineByCurrency: Record<string, number>;
  weightedByCurrency: Record<string, number>;
};
type LeadSummary = {
  id: string;
  leadDate: string | null;
  companyName: string;
  clientType: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  clientId: string | null;
  status: CrmStatus;
  assignedToUserId: string | null;
  estimatedValue: number | null;
  currency: string | null;
  probability: number | null;
  expectedCloseDate: string | null;
  nextFollowUpDate: string | null;
  locationsInterested: string | null;
  lostReason: string | null;
  createdAt: string;
  updatedAt: string;
  attention: "missing" | "overdue" | "today" | "dormant" | null;
  assignedTo: Assignee | null;
  client: { id: string; companyName: string; status: string } | null;
  _count: { contacts: number; activities: number };
  latestActivity: {
    id: string;
    actionType: string | null;
    activityDate: string;
    details: string | null;
    nextStep: string | null;
    nextFollowUpDate: string | null;
  } | null;
};
type LeadDetail = LeadSummary & {
  notes: string | null;
  contacts: Array<{
    id: string;
    name: string;
    role: string | null;
    phone: string | null;
    email: string | null;
    isPrimary: boolean;
    notes: string | null;
  }>;
  activities: Array<{
    id: string;
    actionType: string | null;
    type: string;
    activityDate: string;
    statusAtTime: string | null;
    details: string | null;
    locations: string | null;
    nextStep: string | null;
    nextFollowUpDate: string | null;
    note: string | null;
    user?: { id: string; name: string; role: string } | null;
  }>;
  campaigns: Array<{
    id: string;
    campaignName: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    totalContractValue: number | null;
    currency: string | null;
  }>;
};
type DuplicateResults = {
  clients: Array<{ id: string; companyName: string; status: string; clientType: string; accountOwner: { id: string; name: string } | null }>;
  leads: Array<{ id: string; companyName: string; status: string; assignedTo: { id: string; name: string } | null; canOpen: boolean }>;
};
type ViewMode = "today" | "pipeline" | "all";

const emptySummary: Summary = {
  total: 0,
  active: 0,
  overdue: 0,
  dueToday: 0,
  missingNextStep: 0,
  dormant: 0,
  wonThisMonth: 0,
  lostThisMonth: 0,
  pipelineByCurrency: {},
  weightedByCurrency: {}
};

const actionTypes = [
  ["telefon", "Apel"],
  ["email", "E-mail"],
  ["whatsapp", "WhatsApp"],
  ["meeting", "Meeting"],
  ["vizita", "Vizita"],
  ["offer_sent", "Oferta trimisa"],
  ["follow_up", "Follow-up"],
  ["note", "Nota"]
] as const;

export function CrmWorkspace({
  currentUserId,
  canViewTeam,
  initialLeadId
}: {
  currentUserId: string;
  canViewTeam: boolean;
  initialLeadId: string | null;
}) {
  const [view, setView] = useState<ViewMode>("today");
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 30 });
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [attentionFilter, setAttentionFilter] = useState("all");
  const [selectedLead, setSelectedLead] = useState<LeadDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const page = pagination.page;
  const due = view === "today" ? "attention" : attentionFilter;

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: view === "pipeline" ? "60" : "30",
        due
      });
      if (query) params.set("q", query);
      if (statusFilter) params.set("status", statusFilter);
      if (assigneeFilter && canViewTeam) params.set("assignee", assigneeFilter);
      const response = await fetch(`/api/admin/crm/leads?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "CRM-ul nu a putut fi incarcat.");
      setLeads(payload.leads || []);
      setSummary(payload.summary || emptySummary);
      setPagination(payload.pagination || { page: 1, pages: 1, total: 0, limit: 30 });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "CRM-ul nu a putut fi incarcat.");
    } finally {
      setLoading(false);
    }
  }, [assigneeFilter, canViewTeam, due, page, query, statusFilter, view]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  useEffect(() => {
    if (!canViewTeam) {
      setAssignees([]);
      return;
    }
    fetch("/api/admin/crm/assignees", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setAssignees(Array.isArray(payload?.assignees) ? payload.assignees : []))
      .catch(() => setAssignees([]));
  }, [canViewTeam]);

  useEffect(() => {
    if (initialLeadId) void openLead(initialLeadId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLeadId]);

  async function openLead(id: string) {
    setBusy(`open-${id}`);
    setError(null);
    try {
      const response = await fetch(`/api/admin/crm/leads/${id}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Lead-ul nu a putut fi deschis.");
      setSelectedLead(payload.lead);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Lead-ul nu a putut fi deschis.");
    } finally {
      setBusy(null);
    }
  }

  async function createLead(input: Record<string, unknown>) {
    setBusy("create");
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
      setShowCreate(false);
      setMessage("Lead-ul a fost creat si are urmatorul pas programat.");
      await loadLeads();
      await openLead(payload.lead.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Lead-ul nu a putut fi creat.");
    } finally {
      setBusy(null);
    }
  }

  async function updateLead(id: string, patch: Record<string, unknown>) {
    setBusy(`update-${id}`);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/crm/leads/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Lead-ul nu a putut fi actualizat.");
      setMessage("Lead-ul a fost actualizat.");
      await Promise.all([loadLeads(), openLead(id)]);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Lead-ul nu a putut fi actualizat.");
    } finally {
      setBusy(null);
    }
  }

  async function addActivity(id: string, input: Record<string, unknown>) {
    setBusy(`activity-${id}`);
    setError(null);
    try {
      const response = await fetch(`/api/admin/crm/leads/${id}/activities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Activitatea nu a putut fi salvata.");
      setMessage("Activitatea si urmatorul follow-up au fost salvate.");
      await Promise.all([loadLeads(), openLead(id)]);
    } catch (activityError) {
      setError(activityError instanceof Error ? activityError.message : "Activitatea nu a putut fi salvata.");
    } finally {
      setBusy(null);
    }
  }

  async function addContact(id: string, input: Record<string, unknown>) {
    setBusy(`contact-${id}`);
    setError(null);
    try {
      const response = await fetch(`/api/admin/crm/leads/${id}/contacts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Contactul nu a putut fi adaugat.");
      setMessage("Contactul a fost adaugat.");
      await openLead(id);
    } catch (contactError) {
      setError(contactError instanceof Error ? contactError.message : "Contactul nu a putut fi adaugat.");
    } finally {
      setBusy(null);
    }
  }

  async function removeContact(leadId: string, contactId: string) {
    if (!window.confirm("Elimini acest contact din lead?")) return;
    setBusy(`contact-delete-${contactId}`);
    try {
      const response = await fetch(`/api/admin/crm/leads/${leadId}/contacts/${contactId}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Contactul nu a putut fi eliminat.");
      await openLead(leadId);
    } catch (contactError) {
      setError(contactError instanceof Error ? contactError.message : "Contactul nu a putut fi eliminat.");
    } finally {
      setBusy(null);
    }
  }

  async function convertLead(id: string, clientId?: string | null) {
    if (!window.confirm("Confirmi conversia lead-ului in client? Nu se creeaza rezervare sau HOLD.")) return;
    setBusy(`convert-${id}`);
    setError(null);
    try {
      const response = await fetch(`/api/admin/crm/leads/${id}/convert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: clientId || null })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Conversia nu a reusit.");
      setMessage(`Lead convertit in client: ${payload.client.companyName}.`);
      await Promise.all([loadLeads(), openLead(id)]);
    } catch (convertError) {
      setError(convertError instanceof Error ? convertError.message : "Conversia nu a reusit.");
    } finally {
      setBusy(null);
    }
  }

  function changeView(nextView: ViewMode) {
    setView(nextView);
    setPagination((current) => ({ ...current, page: 1 }));
    setStatusFilter("");
    setAttentionFilter("all");
  }

  const todayGroups = useMemo(() => ({
    overdue: leads.filter((lead) => lead.attention === "overdue"),
    today: leads.filter((lead) => lead.attention === "today"),
    missing: leads.filter((lead) => lead.attention === "missing"),
    dormant: leads.filter((lead) => lead.attention === "dormant")
  }), [leads]);

  return (
    <main className="focus-shell py-7">
      <div className="focus-container grid gap-5">
        <section className="flex flex-wrap items-end justify-between gap-4 border-b border-focus-line pb-5">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">CRM Focus Media</p>
            <h1 className="font-display text-4xl font-black uppercase text-white">Activitate comerciala OOH</h1>
            <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-slate-300">
              Prioritati zilnice, pipeline, contacte si istoric comercial pentru fiecare agent.
            </p>
          </div>
          <button className="focus-button" type="button" onClick={() => setShowCreate(true)}>
            <Plus size={18} /> Lead nou
          </button>
        </section>

        {message ? <Feedback tone="green" text={message} onClose={() => setMessage(null)} /> : null}
        {error ? <Feedback tone="red" text={error} onClose={() => setError(null)} /> : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label="Lead-uri active" value={summary.active} icon={<BriefcaseBusiness size={18} />} />
          <Metric label="Restante" value={summary.overdue} icon={<AlertTriangle size={18} />} tone={summary.overdue ? "red" : "green"} />
          <Metric label="Pentru azi" value={summary.dueToday} icon={<CalendarClock size={18} />} tone="yellow" />
          <Metric label="Fara urmator pas" value={summary.missingNextStep} icon={<Clock3 size={18} />} tone={summary.missingNextStep ? "red" : "green"} />
          <Metric label="Castigate luna" value={summary.wonThisMonth} icon={<Check size={18} />} tone="green" />
          <Metric label="Forecast ponderat" value={formatCurrencyValues(summary.weightedByCurrency)} icon={<Target size={18} />} />
        </section>

        <section className="flex flex-wrap items-center gap-2 border-b border-focus-line pb-4" aria-label="Vederi CRM">
          <ViewButton active={view === "today"} onClick={() => changeView("today")} icon={<CalendarClock size={17} />}>Astazi</ViewButton>
          <ViewButton active={view === "pipeline"} onClick={() => changeView("pipeline")} icon={<Target size={17} />}>Pipeline</ViewButton>
          <ViewButton active={view === "all"} onClick={() => changeView("all")} icon={<Users size={17} />}>Toate lead-urile</ViewButton>
        </section>

        <CrmFilters
          query={queryInput}
          onQuery={setQueryInput}
          status={statusFilter}
          onStatus={(value) => {
            setStatusFilter(value);
            setPagination((current) => ({ ...current, page: 1 }));
          }}
          attention={attentionFilter}
          onAttention={(value) => {
            setAttentionFilter(value);
            setPagination((current) => ({ ...current, page: 1 }));
          }}
          assignee={assigneeFilter}
          onAssignee={(value) => {
            setAssigneeFilter(value);
            setPagination((current) => ({ ...current, page: 1 }));
          }}
          assignees={assignees}
          canViewTeam={canViewTeam}
          hideAttention={view === "today"}
        />

        {loading ? <LoadingState /> : null}
        {!loading && view === "today" ? (
          <TodayView groups={todayGroups} busy={busy} onOpen={openLead} />
        ) : null}
        {!loading && view === "pipeline" ? (
          <PipelineView leads={leads} total={pagination.total} busy={busy} onOpen={openLead} onStatus={updateLead} />
        ) : null}
        {!loading && view === "all" ? (
          <LeadList leads={leads} busy={busy} onOpen={openLead} />
        ) : null}

        {!loading && pagination.total === 0 ? (
          <EmptyState onCreate={() => setShowCreate(true)} />
        ) : null}

        {!loading && view === "all" && pagination.pages > 1 ? (
          <Pagination
            page={pagination.page}
            pages={pagination.pages}
            total={pagination.total}
            onPage={(nextPage) => setPagination((current) => ({ ...current, page: nextPage }))}
          />
        ) : null}
      </div>

      {showCreate ? (
        <CreateLeadDialog
          currentUserId={currentUserId}
          canViewTeam={canViewTeam}
          assignees={assignees}
          busy={busy === "create"}
          onClose={() => setShowCreate(false)}
          onCreate={createLead}
          onOpenExisting={(id) => {
            setShowCreate(false);
            void openLead(id);
          }}
        />
      ) : null}

      {selectedLead ? (
        <LeadDrawer
          lead={selectedLead}
          assignees={assignees}
          canViewTeam={canViewTeam}
          busy={busy}
          onClose={() => setSelectedLead(null)}
          onUpdate={updateLead}
          onActivity={addActivity}
          onContact={addContact}
          onRemoveContact={removeContact}
          onConvert={convertLead}
          onOpenLead={openLead}
        />
      ) : null}
    </main>
  );
}

function CrmFilters({
  query,
  onQuery,
  status,
  onStatus,
  attention,
  onAttention,
  assignee,
  onAssignee,
  assignees,
  canViewTeam,
  hideAttention
}: {
  query: string;
  onQuery: (value: string) => void;
  status: string;
  onStatus: (value: string) => void;
  attention: string;
  onAttention: (value: string) => void;
  assignee: string;
  onAssignee: (value: string) => void;
  assignees: Assignee[];
  canViewTeam: boolean;
  hideAttention: boolean;
}) {
  return <section className="grid gap-3 border-b border-focus-line pb-4 lg:grid-cols-[minmax(260px,1fr)_220px_220px_220px]">
    <label className="relative">
      <span className="sr-only">Cauta</span>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input className="focus-input pl-10" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Companie, contact, email, telefon" />
    </label>
    <select className="focus-input" value={status} onChange={(event) => onStatus(event.target.value)} aria-label="Status CRM">
      <option value="">Toate etapele</option>
      {CRM_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {!hideAttention ? (
      <select className="focus-input" value={attention} onChange={(event) => onAttention(event.target.value)} aria-label="Urmatorul pas">
        <option value="all">Toate termenele</option>
        <option value="overdue">Restante</option>
        <option value="today">Astazi</option>
        <option value="upcoming">Viitoare</option>
        <option value="missing">Fara urmator pas</option>
      </select>
    ) : <div />}
    {canViewTeam ? (
      <select className="focus-input" value={assignee} onChange={(event) => onAssignee(event.target.value)} aria-label="Agent CRM">
        <option value="">Toti agentii</option>
        {assignees.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select>
    ) : null}
  </section>;
}

function TodayView({
  groups,
  busy,
  onOpen
}: {
  groups: Record<"overdue" | "today" | "missing" | "dormant", LeadSummary[]>;
  busy: string | null;
  onOpen: (id: string) => void;
}) {
  return <div className="grid gap-6">
    <LeadSection title="Restante" description="Follow-up-uri care trebuiau deja facute." rows={groups.overdue} tone="red" busy={busy} onOpen={onOpen} />
    <LeadSection title="Astazi" description="Discutii si actiuni programate pentru azi." rows={groups.today} tone="yellow" busy={busy} onOpen={onOpen} />
    <LeadSection title="Fara urmator pas" description="Lead-uri active care trebuie planificate." rows={groups.missing} tone="red" busy={busy} onOpen={onOpen} />
    {groups.dormant.length ? <LeadSection title="Fara activitate recenta" description="Lead-uri active neactualizate de peste 14 zile." rows={groups.dormant} tone="neutral" busy={busy} onOpen={onOpen} /> : null}
    {!groups.overdue.length && !groups.today.length && !groups.missing.length && !groups.dormant.length ? (
      <section className="border-y border-focus-line py-10 text-center">
        <Check className="mx-auto h-10 w-10 text-emerald-300" />
        <h2 className="mt-3 text-xl font-black text-white">Agenda CRM este la zi</h2>
        <p className="mt-1 text-sm text-slate-400">Nu exista follow-up-uri restante sau lead-uri fara urmator pas.</p>
      </section>
    ) : null}
  </div>;
}

function LeadSection({
  title,
  description,
  rows,
  tone,
  busy,
  onOpen
}: {
  title: string;
  description: string;
  rows: LeadSummary[];
  tone: "red" | "yellow" | "neutral";
  busy: string | null;
  onOpen: (id: string) => void;
}) {
  if (!rows.length) return null;
  return <section>
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-sm font-black uppercase text-focus-yellow">{title}</h2>
        <p className="mt-1 text-xs text-slate-400">{description}</p>
      </div>
      <span className="text-sm font-black text-white">{rows.length}</span>
    </div>
    <div className="grid gap-3 xl:grid-cols-2">
      {rows.map((lead) => <LeadCard key={lead.id} lead={lead} tone={tone} busy={busy} onOpen={onOpen} />)}
    </div>
  </section>;
}

function LeadCard({
  lead,
  tone = "neutral",
  busy,
  onOpen
}: {
  lead: LeadSummary;
  tone?: "red" | "yellow" | "neutral";
  busy: string | null;
  onOpen: (id: string) => void;
}) {
  return <article className={`grid min-h-40 gap-3 rounded-md border p-4 ${tone === "red" ? "border-red-300/35 bg-red-500/8" : tone === "yellow" ? "border-focus-yellow/35 bg-focus-yellow/5" : "border-focus-line bg-focus-ink/65"}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-lg font-black text-white">{lead.companyName}</p>
        <p className="truncate text-xs text-slate-400">{lead.contactName || "Fara contact"}{lead.assignedTo?.name ? ` / ${lead.assignedTo.name}` : ""}</p>
      </div>
      <StatusBadge status={lead.status} />
    </div>
    <div className="grid gap-2 text-xs sm:grid-cols-2">
      <InfoLine label="Follow-up" value={lead.nextFollowUpDate ? date(lead.nextFollowUpDate) : "Nesetat"} />
      <InfoLine label="Valoare" value={lead.estimatedValue ? `${money(lead.estimatedValue)} ${lead.currency || "EUR"}` : "Nesetata"} />
      <InfoLine label="Ultima activitate" value={lead.latestActivity ? dateTime(lead.latestActivity.activityDate) : "Fara activitate"} />
      <InfoLine label="Probabilitate" value={lead.probability == null ? "-" : `${lead.probability}%`} />
    </div>
    <button className="focus-button mt-auto justify-self-start" type="button" disabled={busy === `open-${lead.id}`} onClick={() => onOpen(lead.id)}>
      Deschide lead <ArrowRight size={16} />
    </button>
  </article>;
}

function PipelineView({
  leads,
  total,
  busy,
  onOpen,
  onStatus
}: {
  leads: LeadSummary[];
  total: number;
  busy: string | null;
  onOpen: (id: string) => void;
  onStatus: (id: string, patch: Record<string, unknown>) => void;
}) {
  const columns = CRM_STATUS_OPTIONS.filter((option) => option.value !== "inactive");
  return <section>
    {total > leads.length ? <p className="mb-3 text-xs font-bold text-focus-yellow">Sunt afisate primele {leads.length} din {total} lead-uri. Foloseste filtrele pentru un pipeline mai precis.</p> : null}
    <div className="grid auto-cols-[minmax(260px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-3">
      {columns.map((column) => {
        const rows = leads.filter((lead) => lead.status === column.value);
        return <section className="min-h-[420px] rounded-md border border-focus-line bg-focus-ink/45" key={column.value}>
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-focus-line bg-focus-navy px-3 py-3">
            <h2 className="text-xs font-black uppercase text-white">{column.label}</h2>
            <span className="rounded-full bg-focus-yellow px-2 py-0.5 text-xs font-black text-focus-navy">{rows.length}</span>
          </div>
          <div className="grid gap-2 p-2">
            {rows.map((lead) => <article className="rounded-md border border-focus-line bg-focus-navy/55 p-3" key={lead.id}>
              <button className="block w-full text-left" type="button" onClick={() => onOpen(lead.id)}>
                <strong className="block truncate text-white">{lead.companyName}</strong>
                <span className="mt-1 block truncate text-xs text-slate-400">{lead.contactName || lead.assignedTo?.name || "Fara contact"}</span>
                <span className={`mt-2 block text-xs font-black ${lead.attention === "overdue" || lead.attention === "missing" ? "text-red-100" : lead.attention === "today" ? "text-focus-yellow" : "text-slate-300"}`}>
                  {attentionLabel(lead)}
                </span>
              </button>
              {!["won", "lost"].includes(lead.status) ? (
                <select
                  className="focus-input mt-3 text-xs"
                  value={lead.status}
                  disabled={busy === `update-${lead.id}`}
                  onChange={(event) => onStatus(lead.id, { status: event.target.value })}
                  aria-label={`Schimba etapa pentru ${lead.companyName}`}
                >
                  {CRM_STATUS_OPTIONS.filter((option) => !["won", "lost", "inactive"].includes(option.value)).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : null}
            </article>)}
            {!rows.length ? <p className="px-2 py-8 text-center text-xs text-slate-500">Niciun lead</p> : null}
          </div>
        </section>;
      })}
    </div>
  </section>;
}

function LeadList({ leads, busy, onOpen }: { leads: LeadSummary[]; busy: string | null; onOpen: (id: string) => void }) {
  return <section className="overflow-hidden border-y border-focus-line">
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] text-sm">
        <thead className="bg-focus-navy/80 text-left text-xs uppercase text-slate-400">
          <tr>
            <th className="px-3 py-3">Companie</th>
            <th className="px-3 py-3">Etapa</th>
            <th className="px-3 py-3">Agent</th>
            <th className="px-3 py-3">Follow-up</th>
            <th className="px-3 py-3">Valoare</th>
            <th className="px-3 py-3">Ultima activitate</th>
            <th className="px-3 py-3">Actiune</th>
          </tr>
        </thead>
        <tbody>{leads.map((lead) => <tr className="border-t border-focus-line" key={lead.id}>
          <td className="px-3 py-3"><strong className="text-white">{lead.companyName}</strong><small className="block text-slate-400">{lead.contactName || lead.email || lead.phone || "Fara contact"}</small></td>
          <td className="px-3 py-3"><StatusBadge status={lead.status} /></td>
          <td className="px-3 py-3">{lead.assignedTo?.name || "Nealocat"}</td>
          <td className="px-3 py-3"><span className={lead.attention === "overdue" || lead.attention === "missing" ? "font-black text-red-100" : ""}>{lead.nextFollowUpDate ? date(lead.nextFollowUpDate) : "Nesetat"}</span></td>
          <td className="px-3 py-3">{lead.estimatedValue ? `${money(lead.estimatedValue)} ${lead.currency || "EUR"}` : "-"}</td>
          <td className="px-3 py-3">{lead.latestActivity ? `${activityLabel(lead.latestActivity.actionType)} / ${date(lead.latestActivity.activityDate)}` : "-"}</td>
          <td className="px-3 py-3"><button className="focus-button secondary" type="button" disabled={busy === `open-${lead.id}`} onClick={() => onOpen(lead.id)}>Deschide</button></td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function CreateLeadDialog({
  currentUserId,
  canViewTeam,
  assignees,
  busy,
  onClose,
  onCreate,
  onOpenExisting
}: {
  currentUserId: string;
  canViewTeam: boolean;
  assignees: Assignee[];
  busy: boolean;
  onClose: () => void;
  onCreate: (input: Record<string, unknown>) => void;
  onOpenExisting: (id: string) => void;
}) {
  const [form, setForm] = useState({
    companyName: "",
    clientType: "direct_client",
    clientId: "",
    contactName: "",
    contactRole: "",
    phone: "",
    email: "",
    source: "Prospectare directa",
    assignedToUserId: canViewTeam ? assignees[0]?.id || "" : currentUserId,
    status: "new",
    estimatedValue: "",
    currency: "EUR",
    probability: "20",
    expectedCloseDate: "",
    nextFollowUpDate: tomorrowInput(),
    locationsInterested: "",
    notes: ""
  });
  const [duplicates, setDuplicates] = useState<DuplicateResults>({ clients: [], leads: [] });

  useEffect(() => {
    if (!canViewTeam || form.assignedToUserId || !assignees[0]) return;
    setForm((current) => ({ ...current, assignedToUserId: assignees[0].id }));
  }, [assignees, canViewTeam, form.assignedToUserId]);

  useEffect(() => {
    const query = form.companyName.trim();
    if (query.length < 2) {
      setDuplicates({ clients: [], leads: [] });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/admin/crm/duplicates?q=${encodeURIComponent(query)}`, { signal: controller.signal, cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((payload) => {
          if (payload) setDuplicates({ clients: payload.clients || [], leads: payload.leads || [] });
        })
        .catch(() => undefined);
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [form.companyName]);

  const valid = form.companyName.trim().length >= 2 && form.nextFollowUpDate && form.assignedToUserId;

  return <ModalShell title="Lead CRM nou" onClose={onClose}>
    <div className="grid gap-4">
      <p className="text-sm text-slate-300">Adauga informatia minima si stabileste urmatorul pas. Detaliile pot fi completate ulterior in dosarul lead-ului.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Companie"><input className="focus-input" value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value, clientId: "" })} autoFocus /></Field>
        <Field label="Tip client"><select className="focus-input" value={form.clientType} onChange={(event) => setForm({ ...form, clientType: event.target.value })}><option value="direct_client">Client direct</option><option value="agency">Agentie</option></select></Field>
        <Field label="Contact"><input className="focus-input" value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} /></Field>
        <Field label="Functie"><input className="focus-input" value={form.contactRole} onChange={(event) => setForm({ ...form, contactRole: event.target.value })} /></Field>
        <Field label="Telefon"><input className="focus-input" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>
        <Field label="E-mail"><input className="focus-input" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
        <Field label="Sursa"><input className="focus-input" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} /></Field>
        {canViewTeam ? <Field label="Agent responsabil"><select className="focus-input" value={form.assignedToUserId} onChange={(event) => setForm({ ...form, assignedToUserId: event.target.value })}><option value="">Alege agent</option>{assignees.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field> : null}
        <Field label="Valoare estimata"><input className="focus-input" inputMode="decimal" value={form.estimatedValue} onChange={(event) => setForm({ ...form, estimatedValue: event.target.value })} /></Field>
        <Field label="Moneda"><select className="focus-input" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}><option>EUR</option><option>RON</option></select></Field>
        <Field label="Probabilitate"><input className="focus-input" type="number" min="0" max="100" value={form.probability} onChange={(event) => setForm({ ...form, probability: event.target.value })} /></Field>
        <Field label="Data estimata inchidere"><input className="focus-input" type="date" value={form.expectedCloseDate} onChange={(event) => setForm({ ...form, expectedCloseDate: event.target.value })} /></Field>
        <Field label="Urmatorul follow-up"><input className="focus-input" type="date" min={todayInput()} value={form.nextFollowUpDate} onChange={(event) => setForm({ ...form, nextFollowUpDate: event.target.value })} /></Field>
        <Field label="Interes OOH"><input className="focus-input" value={form.locationsInterested} onChange={(event) => setForm({ ...form, locationsInterested: event.target.value })} placeholder="Orase, formate, coduri" /></Field>
      </div>
      <Field label="Brief / urmator pas"><textarea className="focus-input min-h-24" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>

      {(duplicates.clients.length || duplicates.leads.length) ? (
        <section className="rounded-md border border-focus-yellow/40 bg-focus-yellow/5 p-3">
          <h3 className="text-xs font-black uppercase text-focus-yellow">Posibile inregistrari existente</h3>
          <div className="mt-2 grid gap-2">
            {duplicates.clients.map((client) => <button className="flex items-center justify-between gap-3 rounded-md border border-focus-line px-3 py-2 text-left text-sm" type="button" key={client.id} onClick={() => setForm({ ...form, clientId: client.id, companyName: client.companyName })}><span><strong className="text-white">{client.companyName}</strong><small className="block text-slate-400">Client existent / {client.accountOwner?.name || "fara owner"}</small></span><span className="text-focus-yellow">Leaga</span></button>)}
            {duplicates.leads.map((lead) => <button className="flex items-center justify-between gap-3 rounded-md border border-focus-line px-3 py-2 text-left text-sm" type="button" key={lead.id} disabled={!lead.canOpen} onClick={() => lead.canOpen && onOpenExisting(lead.id)}><span><strong className="text-white">{lead.companyName}</strong><small className="block text-slate-400">Lead activ / {lead.assignedTo?.name || "neacordat"}</small></span><span className="text-focus-yellow">{lead.canOpen ? "Deschide" : "Exista la alt agent"}</span></button>)}
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2 border-t border-focus-line pt-4">
        <button className="focus-button secondary" type="button" onClick={onClose}>Renunta</button>
        <button className="focus-button" type="button" disabled={!valid || busy} onClick={() => onCreate({
          ...form,
          clientId: form.clientId || null,
          estimatedValue: form.estimatedValue ? Number(form.estimatedValue.replace(",", ".")) : null,
          probability: form.probability ? Number(form.probability) : null,
          expectedCloseDate: form.expectedCloseDate || null
        })}>{busy ? "Se salveaza..." : "Creeaza lead"}</button>
      </div>
    </div>
  </ModalShell>;
}

function LeadDrawer({
  lead,
  assignees,
  canViewTeam,
  busy,
  onClose,
  onUpdate,
  onActivity,
  onContact,
  onRemoveContact,
  onConvert,
  onOpenLead
}: {
  lead: LeadDetail;
  assignees: Assignee[];
  canViewTeam: boolean;
  busy: string | null;
  onClose: () => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  onActivity: (id: string, input: Record<string, unknown>) => void;
  onContact: (id: string, input: Record<string, unknown>) => void;
  onRemoveContact: (leadId: string, contactId: string) => void;
  onConvert: (id: string, clientId?: string | null) => void;
  onOpenLead: (id: string) => void;
}) {
  const [draft, setDraft] = useState({
    status: lead.status,
    assignedToUserId: lead.assignedToUserId || "",
    estimatedValue: lead.estimatedValue == null ? "" : String(lead.estimatedValue),
    currency: lead.currency || "EUR",
    probability: lead.probability == null ? "" : String(lead.probability),
    expectedCloseDate: lead.expectedCloseDate?.slice(0, 10) || "",
    nextFollowUpDate: lead.nextFollowUpDate?.slice(0, 10) || "",
    locationsInterested: lead.locationsInterested || "",
    notes: lead.notes || "",
    lostReason: lead.lostReason || ""
  });
  const [activity, setActivity] = useState({
    actionType: "telefon",
    details: "",
    nextStep: "",
    nextFollowUpDate: lead.nextFollowUpDate?.slice(0, 10) || tomorrowInput(),
    locations: lead.locationsInterested || ""
  });
  const [contact, setContact] = useState({ name: "", role: "", phone: "", email: "", isPrimary: lead.contacts.length === 0 });
  const [duplicates, setDuplicates] = useState<DuplicateResults>({ clients: [], leads: [] });

  useEffect(() => {
    setDraft({
      status: lead.status,
      assignedToUserId: lead.assignedToUserId || "",
      estimatedValue: lead.estimatedValue == null ? "" : String(lead.estimatedValue),
      currency: lead.currency || "EUR",
      probability: lead.probability == null ? "" : String(lead.probability),
      expectedCloseDate: lead.expectedCloseDate?.slice(0, 10) || "",
      nextFollowUpDate: lead.nextFollowUpDate?.slice(0, 10) || "",
      locationsInterested: lead.locationsInterested || "",
      notes: lead.notes || "",
      lostReason: lead.lostReason || ""
    });
  }, [lead]);

  useEffect(() => {
    if (lead.clientId) {
      setDuplicates({ clients: [], leads: [] });
      return;
    }
    fetch(`/api/admin/crm/duplicates?q=${encodeURIComponent(lead.companyName)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => payload && setDuplicates({ clients: payload.clients || [], leads: payload.leads || [] }))
      .catch(() => undefined);
  }, [lead.clientId, lead.companyName]);

  const saveDisabled = ["new", "qualified", "brief_received", "in_offer", "offer_sent", "in_negotiation", "on_hold"].includes(draft.status) && !draft.nextFollowUpDate;

  return <div className="fixed inset-0 z-[70] flex justify-end bg-black/65" role="dialog" aria-modal="true" aria-label={`Lead ${lead.companyName}`}>
    <div className="h-full w-full max-w-[860px] overflow-y-auto border-l border-focus-line bg-focus-navy shadow-2xl">
      <div className="sticky top-0 z-20 flex items-start justify-between gap-4 border-b border-focus-line bg-focus-navy/98 px-5 py-4">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Dosar CRM</p>
          <h2 className="text-2xl font-black text-white">{lead.companyName}</h2>
          <p className="mt-1 text-xs text-slate-400">{lead.assignedTo?.name || "Nealocat"} / actualizat {dateTime(lead.updatedAt)}</p>
        </div>
        <button className="focus-button secondary" type="button" onClick={onClose} aria-label="Inchide"><X size={18} /></button>
      </div>

      <div className="grid gap-6 p-5">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MiniMetric label="Etapa" value={statusLabel(lead.status)} />
          <MiniMetric label="Valoare" value={lead.estimatedValue ? `${money(lead.estimatedValue)} ${lead.currency || "EUR"}` : "-"} />
          <MiniMetric label="Probabilitate" value={lead.probability == null ? "-" : `${lead.probability}%`} />
          <MiniMetric label="Follow-up" value={lead.nextFollowUpDate ? date(lead.nextFollowUpDate) : "Nesetat"} tone={lead.attention === "overdue" || lead.attention === "missing" ? "red" : "neutral"} />
        </section>

        <section className="border-y border-focus-line py-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black uppercase text-focus-yellow">Situatie comerciala</h3>
              <p className="mt-1 text-xs text-slate-400">Actualizeaza etapa, valoarea si urmatorul pas.</p>
            </div>
            {!lead.clientId ? <button className="focus-button" type="button" disabled={busy === `convert-${lead.id}`} onClick={() => onConvert(lead.id)}><UserPlus size={17} /> Converteste in client</button> : <span className="text-xs font-black text-emerald-200">Client asociat: {lead.client?.companyName}</span>}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Etapa"><select className="focus-input" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as CrmStatus })}>{CRM_STATUS_OPTIONS.filter((option) => option.value !== "won" || lead.clientId).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
            {canViewTeam ? <Field label="Agent"><select className="focus-input" value={draft.assignedToUserId} onChange={(event) => setDraft({ ...draft, assignedToUserId: event.target.value })}>{assignees.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field> : null}
            <Field label="Valoare"><input className="focus-input" inputMode="decimal" value={draft.estimatedValue} onChange={(event) => setDraft({ ...draft, estimatedValue: event.target.value })} /></Field>
            <Field label="Moneda"><select className="focus-input" value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value })}><option>EUR</option><option>RON</option></select></Field>
            <Field label="Probabilitate"><input className="focus-input" type="number" min="0" max="100" value={draft.probability} onChange={(event) => setDraft({ ...draft, probability: event.target.value })} /></Field>
            <Field label="Data estimata inchidere"><input className="focus-input" type="date" value={draft.expectedCloseDate} onChange={(event) => setDraft({ ...draft, expectedCloseDate: event.target.value })} /></Field>
            <Field label="Urmatorul follow-up"><input className="focus-input" type="date" value={draft.nextFollowUpDate} onChange={(event) => setDraft({ ...draft, nextFollowUpDate: event.target.value })} /></Field>
            <Field label="Interes OOH"><input className="focus-input" value={draft.locationsInterested} onChange={(event) => setDraft({ ...draft, locationsInterested: event.target.value })} /></Field>
          </div>
          {draft.status === "lost" ? <Field label="Motiv pierdere"><textarea className="focus-input mt-3 min-h-20" value={draft.lostReason} onChange={(event) => setDraft({ ...draft, lostReason: event.target.value })} /></Field> : null}
          <Field label="Note interne"><textarea className="focus-input mt-3 min-h-24" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></Field>
          <div className="mt-4 flex justify-end">
            <button className="focus-button" type="button" disabled={saveDisabled || busy === `update-${lead.id}`} onClick={() => onUpdate(lead.id, {
              status: draft.status,
              assignedToUserId: draft.assignedToUserId,
              estimatedValue: draft.estimatedValue ? Number(draft.estimatedValue.replace(",", ".")) : null,
              currency: draft.currency,
              probability: draft.probability ? Number(draft.probability) : null,
              expectedCloseDate: draft.expectedCloseDate || null,
              nextFollowUpDate: draft.nextFollowUpDate || null,
              locationsInterested: draft.locationsInterested || null,
              notes: draft.notes || null,
              lostReason: draft.lostReason || null
            })}>{busy === `update-${lead.id}` ? "Se salveaza..." : "Salveaza lead"}</button>
          </div>
        </section>

        {!lead.clientId && duplicates.clients.length ? (
          <section>
            <h3 className="text-sm font-black uppercase text-focus-yellow">Clienti existenti similari</h3>
            <div className="mt-3 grid gap-2">
              {duplicates.clients.map((client) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-focus-line px-3 py-3" key={client.id}><span><strong className="text-white">{client.companyName}</strong><small className="block text-slate-400">Owner: {client.accountOwner?.name || "nesetat"}</small></span><button className="focus-button secondary" type="button" onClick={() => onConvert(lead.id, client.id)}>Leaga si castiga</button></div>)}
            </div>
          </section>
        ) : null}

        <section className="border-y border-focus-line py-5">
          <h3 className="text-sm font-black uppercase text-focus-yellow">Inregistreaza activitate</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="Tip"><select className="focus-input" value={activity.actionType} onChange={(event) => setActivity({ ...activity, actionType: event.target.value })}>{actionTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="Urmatorul follow-up"><input className="focus-input" type="date" value={activity.nextFollowUpDate} onChange={(event) => setActivity({ ...activity, nextFollowUpDate: event.target.value })} /></Field>
            <Field label="Urmatorul pas"><input className="focus-input" value={activity.nextStep} onChange={(event) => setActivity({ ...activity, nextStep: event.target.value })} /></Field>
            <Field label="Interes OOH"><input className="focus-input" value={activity.locations} onChange={(event) => setActivity({ ...activity, locations: event.target.value })} /></Field>
          </div>
          <Field label="Rezumat activitate"><textarea className="focus-input mt-3 min-h-24" value={activity.details} onChange={(event) => setActivity({ ...activity, details: event.target.value })} /></Field>
          <div className="mt-3 flex justify-end"><button className="focus-button" type="button" disabled={activity.details.trim().length < 2 || !activity.nextFollowUpDate || busy === `activity-${lead.id}`} onClick={() => {
            onActivity(lead.id, activity);
            setActivity((current) => ({ ...current, details: "", nextStep: "" }));
          }}>{busy === `activity-${lead.id}` ? "Se salveaza..." : "Salveaza activitate"}</button></div>
        </section>

        <section>
          <h3 className="text-sm font-black uppercase text-focus-yellow">Contacte</h3>
          <div className="mt-3 grid gap-2">
            {lead.contacts.map((row) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-focus-line px-3 py-3" key={row.id}><span><strong className="text-white">{row.name}</strong>{row.isPrimary ? <small className="ml-2 text-focus-yellow">Principal</small> : null}<small className="block text-slate-400">{[row.role, row.phone, row.email].filter(Boolean).join(" / ") || "-"}</small></span><button className="focus-button secondary" type="button" disabled={busy === `contact-delete-${row.id}`} onClick={() => onRemoveContact(lead.id, row.id)}>Elimina</button></div>)}
          </div>
          <div className="mt-3 grid gap-3 rounded-md border border-focus-line p-3 md:grid-cols-2">
            <Field label="Nume"><input className="focus-input" value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} /></Field>
            <Field label="Functie"><input className="focus-input" value={contact.role} onChange={(event) => setContact({ ...contact, role: event.target.value })} /></Field>
            <Field label="Telefon"><input className="focus-input" value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} /></Field>
            <Field label="E-mail"><input className="focus-input" type="email" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-300"><input type="checkbox" checked={contact.isPrimary} onChange={(event) => setContact({ ...contact, isPrimary: event.target.checked })} /> Contact principal</label>
            <button className="focus-button justify-self-start" type="button" disabled={contact.name.trim().length < 2 || busy === `contact-${lead.id}`} onClick={() => {
              onContact(lead.id, contact);
              setContact({ name: "", role: "", phone: "", email: "", isPrimary: false });
            }}><Plus size={16} /> Adauga contact</button>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-black uppercase text-focus-yellow">Istoric activitate</h3>
          <div className="mt-3 grid gap-3">
            {lead.activities.length ? lead.activities.map((row) => <article className="grid gap-2 border-l-2 border-focus-yellow/50 pl-4" key={row.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <strong className="text-white">{activityLabel(row.actionType || row.type)}</strong>
                <time className="text-xs text-slate-400">{dateTime(row.activityDate)}</time>
              </div>
              <p className="text-sm text-slate-300">{row.details || row.note || "-"}</p>
              <p className="text-xs text-slate-500">{row.user?.name || "Sistem"}{row.nextStep ? ` / Urmator pas: ${row.nextStep}` : ""}{row.nextFollowUpDate ? ` / Follow-up: ${date(row.nextFollowUpDate)}` : ""}</p>
            </article>) : <p className="py-6 text-center text-sm text-slate-400">Nu exista activitati.</p>}
          </div>
        </section>

        {lead.campaigns.length ? (
          <section>
            <h3 className="text-sm font-black uppercase text-focus-yellow">Campanii asociate clientului</h3>
            <div className="mt-3 grid gap-2">
              {lead.campaigns.map((campaign) => <div className="rounded-md border border-focus-line px-3 py-3" key={campaign.id}><strong className="text-white">{campaign.campaignName}</strong><small className="block text-slate-400">{campaign.status} / {campaign.startDate ? date(campaign.startDate) : "-"} - {campaign.endDate ? date(campaign.endDate) : "-"}</small></div>)}
            </div>
          </section>
        ) : null}

        {duplicates.leads.filter((row) => row.id !== lead.id).length ? (
          <section>
            <h3 className="text-sm font-black uppercase text-focus-yellow">Lead-uri similare</h3>
            <div className="mt-3 grid gap-2">
              {duplicates.leads.filter((row) => row.id !== lead.id).map((row) => <button className="rounded-md border border-focus-line px-3 py-3 text-left" type="button" disabled={!row.canOpen} key={row.id} onClick={() => row.canOpen && onOpenLead(row.id)}><strong className="text-white">{row.companyName}</strong><small className="block text-slate-400">{statusLabel(row.status)} / {row.assignedTo?.name || "neacordat"}</small></button>)}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  </div>;
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className="my-8 w-full max-w-4xl rounded-md border border-focus-line bg-focus-navy shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-focus-line px-5 py-4">
        <h2 className="text-xl font-black text-white">{title}</h2>
        <button className="focus-button secondary" type="button" onClick={onClose} aria-label="Inchide"><X size={18} /></button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>;
}

function ViewButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return <button className={`focus-button ${active ? "" : "secondary"}`} type="button" onClick={onClick}>{icon}{children}</button>;
}

function Metric({ label, value, icon, tone = "neutral" }: { label: string; value: string | number; icon: React.ReactNode; tone?: "neutral" | "green" | "yellow" | "red" }) {
  const toneClass = { neutral: "text-white", green: "text-emerald-200", yellow: "text-focus-yellow", red: "text-red-100" }[tone];
  return <article className="min-h-28 rounded-md border border-focus-line bg-focus-ink/65 p-4">
    <div className="flex items-center justify-between gap-3 text-slate-400"><p className="text-xs font-black uppercase">{label}</p>{icon}</div>
    <p className={`mt-4 text-2xl font-black ${toneClass}`}>{value}</p>
  </article>;
}

function MiniMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "red" }) {
  return <div className="rounded-md border border-focus-line bg-focus-ink/55 p-3"><p className="text-[11px] font-black uppercase text-slate-400">{label}</p><p className={`mt-2 text-sm font-black ${tone === "red" ? "text-red-100" : "text-white"}`}>{value}</p></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-xs font-black uppercase text-slate-400">{label}{children}</label>;
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return <p><span className="text-slate-500">{label}: </span><strong className="text-slate-200">{value}</strong></p>;
}

function StatusBadge({ status }: { status: string }) {
  const option = CRM_STATUS_OPTIONS.find((row) => row.value === status);
  const tone = option?.tone || "gray";
  const className = {
    green: "border-emerald-300/50 bg-emerald-400/10 text-emerald-100",
    red: "border-red-300/50 bg-red-400/10 text-red-100",
    yellow: "border-focus-yellow/60 bg-focus-yellow/10 text-focus-yellow",
    blue: "border-sky-300/50 bg-sky-400/10 text-sky-100",
    gray: "border-slate-400/40 bg-slate-400/10 text-slate-200"
  }[tone];
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black uppercase ${className}`}>{option?.label || status}</span>;
}

function Feedback({ tone, text, onClose }: { tone: "green" | "red"; text: string; onClose: () => void }) {
  return <div className={`flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm font-bold ${tone === "green" ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-red-300/30 bg-red-500/10 text-red-100"}`}><span>{text}</span><button type="button" onClick={onClose}><X size={16} /></button></div>;
}

function LoadingState() {
  return <section className="grid min-h-64 place-items-center border-y border-focus-line"><div className="text-center"><span className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-focus-line border-t-focus-yellow" /><p className="mt-3 text-sm font-bold text-slate-400">Se incarca agenda CRM...</p></div></section>;
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return <section className="grid min-h-64 place-items-center border-y border-focus-line py-10 text-center"><div><Users className="mx-auto h-10 w-10 text-focus-yellow" /><h2 className="mt-3 text-xl font-black text-white">CRM-ul este pregatit</h2><p className="mt-1 max-w-md text-sm text-slate-400">Creeaza primul lead si stabileste urmatorul follow-up pentru a porni pipeline-ul.</p><button className="focus-button mx-auto mt-4" type="button" onClick={onCreate}><Plus size={17} /> Lead nou</button></div></section>;
}

function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (page: number) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-focus-line pt-4"><p className="text-xs font-bold text-slate-400">{total} lead-uri / pagina {page} din {pages}</p><div className="flex gap-2"><button className="focus-button secondary" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}><ArrowLeft size={16} /> Inapoi</button><button className="focus-button secondary" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Inainte <ArrowRight size={16} /></button></div></div>;
}

function attentionLabel(lead: LeadSummary) {
  if (lead.attention === "overdue") return `Restant din ${lead.nextFollowUpDate ? date(lead.nextFollowUpDate) : ""}`;
  if (lead.attention === "today") return "Follow-up astazi";
  if (lead.attention === "missing") return "Fara urmator pas";
  if (lead.attention === "dormant") return "Fara activitate recenta";
  return lead.nextFollowUpDate ? `Follow-up ${date(lead.nextFollowUpDate)}` : "Fara termen";
}

function statusLabel(status: string) {
  return CRM_STATUS_OPTIONS.find((row) => row.value === status)?.label || status;
}

function activityLabel(value?: string | null) {
  return actionTypes.find(([key]) => key === value)?.[1] || value || "Activitate";
}

function formatCurrencyValues(values: Record<string, number>) {
  const entries = Object.entries(values).filter(([, value]) => value !== 0);
  return entries.length ? entries.map(([currency, value]) => `${money(value)} ${currency}`).join(" / ") : "0";
}

function date(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" }).format(new Date(value));
}

function money(value: number) {
  return new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 0 }).format(value || 0);
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowInput() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
