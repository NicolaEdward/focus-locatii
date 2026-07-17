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
  Download,
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
import {
  CRM_INDUSTRY_OPTIONS,
  CRM_LOST_REASON_OPTIONS,
  CRM_QUALIFICATION_ITEMS,
  CRM_SOURCE_OPTIONS,
  CRM_STATUS_OPTIONS,
  crmDefaultProbability,
  crmForecastCategoryForStatus,
  crmForecastCategoryLabel,
  crmStatusDescription,
  isActiveCrmStatus,
  type CrmQualificationData,
  type CrmStatus
} from "@/lib/crm";

type Assignee = { id: string; name: string; email: string; role: string };
type Summary = {
  total: number;
  active: number;
  overdue: number;
  dueToday: number;
  missingNextStep: number;
  dormant: number;
  stalled: number;
  needsQualification: number;
  noResponseAttention: number;
  contacted: number;
  qualified: number;
  wonThisMonth: number;
  lostThisMonth: number;
  pipelineByCurrency: Record<string, number>;
  likelyByCurrency: Record<string, number>;
  bestCaseByCurrency: Record<string, number>;
  commitByCurrency: Record<string, number>;
};
type LeadSummary = {
  id: string;
  leadDate: string | null;
  companyName: string;
  taxId: string | null;
  industry: string | null;
  opportunityName: string | null;
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
  probability: number;
  forecastCategory: "pipeline" | "best_case" | "commit" | "closed" | "omitted";
  expectedCloseDate: string | null;
  nextFollowUpDate: string | null;
  nextStep: string | null;
  qualificationData: CrmQualificationData;
  qualification: { completed: number; total: number; percent: number; missing: string[] };
  locationsInterested: string | null;
  lostReason: string | null;
  lostReasonCode: string | null;
  stageChangedAt: string;
  firstContactedAt: string | null;
  qualifiedAt: string | null;
  lastContactAt: string | null;
  lastActivityAt: string | null;
  noResponseCount: number;
  stageAgeDays: number;
  stageStalled: boolean;
  priority: "urgent" | "high" | "normal";
  createdAt: string;
  updatedAt: string;
  attention: "missing" | "overdue" | "today" | "dormant" | null;
  classificationAttention: "cold" | "contacted" | null;
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
  companyHistory: Array<{
    id: string;
    isCurrent: boolean;
    companyName: string;
    opportunityName: string | null;
    status: string;
    assignedTo: { id: string; name: string } | null;
    createdAt: string;
    lastContactAt: string | null;
    lastActivityAt: string | null;
    latestActivity: { id: string; actionType: string | null; activityDate: string; user: { id: string; name: string } | null } | null;
    canOpen: boolean;
  }>;
};
type DuplicateResults = {
  clients: Array<{ id: string; companyName: string; taxId: string | null; status: string; clientType: string; accountOwner: { id: string; name: string } | null; exactTaxIdMatch: boolean }>;
  leads: Array<{ id: string; companyName: string; taxId: string | null; opportunityName: string | null; status: string; lastContactAt: string | null; lastActivityAt: string | null; assignedTo: { id: string; name: string } | null; canOpen: boolean; exactTaxIdMatch: boolean }>;
};
type DailyAgenda = {
  financialReport: { available: boolean; reportDate: string | null; uploadedAt: string | null };
  counts: { calls: number; receivables: number; opportunities: number };
  calls: LeadSummary[];
  receivables: Array<{
    id: string;
    clientId: string | null;
    clientName: string | null;
    companyName: string;
    invoiceNumber: string | null;
    dueDate: string | null;
    remainingAmount: number | null;
    currency: string | null;
    client: { id: string; companyName: string; accountOwner: { id: string; name: string } | null } | null;
  }>;
  opportunities: LeadSummary[];
};
type ViewMode = "today" | "pipeline" | "all";
type QuickActionKey = "contacted" | "no_answer" | "email_sent" | "qualified" | "brief_received" | "offer_sent" | "follow_up_7";

const emptySummary: Summary = {
  total: 0,
  active: 0,
  overdue: 0,
  dueToday: 0,
  missingNextStep: 0,
  dormant: 0,
  stalled: 0,
  needsQualification: 0,
  noResponseAttention: 0,
  contacted: 0,
  qualified: 0,
  wonThisMonth: 0,
  lostThisMonth: 0,
  pipelineByCurrency: {},
  likelyByCurrency: {},
  bestCaseByCurrency: {},
  commitByCurrency: {}
};

const actionTypes = [
  ["call_connected", "Apel - contactat"],
  ["call_no_answer", "Apel - fara raspuns"],
  ["email_sent", "E-mail trimis"],
  ["meeting_held", "Intalnire realizata"],
  ["qualification", "Calificare"],
  ["brief_received", "Brief primit"],
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
  currentUserRole,
  canViewTeam,
  initialLeadId
}: {
  currentUserId: string;
  currentUserRole: string;
  canViewTeam: boolean;
  initialLeadId: string | null;
}) {
  const [view, setView] = useState<ViewMode>("today");
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [agenda, setAgenda] = useState<DailyAgenda>({ financialReport: { available: false, reportDate: null, uploadedAt: null }, counts: { calls: 0, receivables: 0, opportunities: 0 }, calls: [], receivables: [], opportunities: [] });
  const [agendaLoading, setAgendaLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 30 });
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [industryFilter, setIndustryFilter] = useState("");
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
        limit: view === "all" ? "30" : "60",
        due
      });
      if (query) params.set("q", query);
      if (statusFilter) params.set("status", statusFilter);
      if (industryFilter) params.set("industry", industryFilter);
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
  }, [assigneeFilter, canViewTeam, due, industryFilter, page, query, statusFilter, view]);

  const loadAgenda = useCallback(async () => {
    if (view !== "today") return;
    setAgendaLoading(true);
    try {
      const params = new URLSearchParams();
      if (assigneeFilter && canViewTeam) params.set("assignee", assigneeFilter);
      const response = await fetch(`/api/admin/crm/agenda?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Agenda nu a putut fi incarcata.");
      setAgenda(payload);
    } catch (agendaError) {
      setError(agendaError instanceof Error ? agendaError.message : "Agenda nu a putut fi incarcata.");
    } finally {
      setAgendaLoading(false);
    }
  }, [assigneeFilter, canViewTeam, view]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  useEffect(() => {
    void loadAgenda();
  }, [loadAgenda]);

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
      if (!response.ok) throw new Error(payload.error || "Oportunitatea nu a putut fi deschisa.");
      setSelectedLead(payload.lead);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Oportunitatea nu a putut fi deschisa.");
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
      if (!response.ok) throw new Error(payload.error || "Oportunitatea nu a putut fi creata.");
      setShowCreate(false);
      setMessage("Oportunitatea a fost creata si are urmatorul pas programat.");
      await Promise.all([loadLeads(), loadAgenda()]);
      await openLead(payload.lead.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Oportunitatea nu a putut fi creata.");
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
      if (!response.ok) throw new Error(payload.error || "Oportunitatea nu a putut fi actualizata.");
      setMessage("Oportunitatea a fost actualizata.");
      await Promise.all([loadLeads(), loadAgenda(), openLead(id)]);
      return true;
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Oportunitatea nu a putut fi actualizata.");
      return false;
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
      await Promise.all([loadLeads(), loadAgenda(), openLead(id)]);
    } catch (activityError) {
      setError(activityError instanceof Error ? activityError.message : "Activitatea nu a putut fi salvata.");
    } finally {
      setBusy(null);
    }
  }

  async function addQuickActivity(id: string, input: Record<string, unknown>) {
    setBusy(`activity-${id}`);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/crm/leads/${id}/activities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Actiunea rapida nu a putut fi salvata.");
      setMessage("Activitatea a fost salvata, iar follow-up-ul a fost programat.");
      await Promise.all([loadLeads(), loadAgenda()]);
    } catch (activityError) {
      setError(activityError instanceof Error ? activityError.message : "Actiunea rapida nu a putut fi salvata.");
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
      setMessage(payload.alreadyCompleted
        ? `Oportunitatea era deja castigata si legata de ${payload.client.companyName}.`
        : `Oportunitate castigata. Client asociat: ${payload.client.companyName}.`);
      await Promise.all([loadLeads(), loadAgenda(), openLead(id)]);
      return true;
    } catch (convertError) {
      setError(convertError instanceof Error ? convertError.message : "Conversia nu a reusit.");
      return false;
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

  const todayGroups = useMemo(() => {
    const urgentAttention = new Set(["overdue", "today", "missing"]);
    const alreadyUrgent = (lead: LeadSummary) => urgentAttention.has(lead.attention || "");
    return {
      overdue: leads.filter((lead) => lead.attention === "overdue"),
      today: leads.filter((lead) => lead.attention === "today"),
      missing: leads.filter((lead) => lead.attention === "missing"),
      noResponse: leads.filter((lead) => lead.noResponseCount >= 3 && !alreadyUrgent(lead)),
      classification: leads.filter((lead) =>
        Boolean(lead.classificationAttention) && !alreadyUrgent(lead) && lead.noResponseCount < 3
      ),
      stalled: leads.filter((lead) =>
        lead.stageStalled && !alreadyUrgent(lead) && !lead.classificationAttention && lead.noResponseCount < 3
      ),
      dormant: leads.filter((lead) =>
        lead.attention === "dormant" && !lead.stageStalled && !lead.classificationAttention && lead.noResponseCount < 3
      )
    };
  }, [leads]);

  return (
    <main className="focus-shell overflow-x-clip py-6 sm:py-8">
      <div className="focus-container grid min-w-0 gap-5 sm:gap-6">
        <section className="relative overflow-hidden rounded-lg border border-white/10 bg-[linear-gradient(135deg,rgba(12,38,58,.98),rgba(4,20,32,.98))] px-5 py-6 shadow-[0_20px_55px_rgba(0,0,0,.22)] sm:px-7">
          <div className="absolute inset-y-0 left-0 w-1 bg-focus-yellow" />
          <div className="flex min-w-0 flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-focus-yellow">CRM Focus Media</p>
            <h1 className="mt-1 font-display text-2xl font-black uppercase text-white sm:text-4xl">Activitate comerciala OOH</h1>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-300">
              Urmatorul pas, valoarea integrala si sansele reale pentru fiecare oportunitate.
            </p>
            <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-1.5 text-xs font-black text-slate-200">
              <Users size={14} /> Perspectiva: {canViewTeam ? "echipa comerciala" : "portofoliul meu"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {["COO", "SUPER_ADMIN"].includes(currentUserRole) ? <a className="focus-button secondary" href="/api/admin/crm/export.xlsx"><Download size={18} /> Export CRM</a> : null}
            <button className="focus-button" type="button" onClick={() => setShowCreate(true)}>
              <Plus size={18} /> Oportunitate noua
            </button>
          </div>
          </div>
        </section>

        {message ? <Feedback tone="green" text={message} onClose={() => setMessage(null)} /> : null}
        {error ? <Feedback tone="red" text={error} onClose={() => setError(null)} /> : null}

        <section className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <Metric label="Pipeline total" value={formatCurrencyValues(summary.pipelineByCurrency)} icon={<BriefcaseBusiness size={18} />} hint="Valoare integrala a oportunitatilor active." />
          <Metric label="Sanse >=50% luna" value={formatCurrencyValues(summary.likelyByCurrency)} icon={<Target size={18} />} tone="yellow" hint="Suma valorilor integrale." />
          <Metric label="Sanse >=80% luna" value={formatCurrencyValues(summary.commitByCurrency)} icon={<Check size={18} />} tone="green" hint="Suma valorilor integrale." />
          <Metric label="Restante" value={summary.overdue} icon={<AlertTriangle size={18} />} tone={summary.overdue ? "red" : "green"} />
          <Metric label="Oportunitati active" value={summary.active} icon={<BriefcaseBusiness size={18} />} />
          <Metric label="Castigate luna" value={summary.wonThisMonth} icon={<Check size={18} />} tone="green" />
        </section>

        <section className="flex flex-wrap items-center gap-2 border-b border-focus-line pb-4" aria-label="Vederi CRM">
          <ViewButton active={view === "today"} onClick={() => changeView("today")} icon={<CalendarClock size={17} />}>Astazi</ViewButton>
          <ViewButton active={view === "pipeline"} onClick={() => changeView("pipeline")} icon={<Target size={17} />}>Pipeline</ViewButton>
          <ViewButton active={view === "all"} onClick={() => changeView("all")} icon={<Users size={17} />}>Toate oportunitatile</ViewButton>
        </section>

        <CrmFilters
          query={queryInput}
          onQuery={setQueryInput}
          status={statusFilter}
          onStatus={(value) => {
            setStatusFilter(value);
            setPagination((current) => ({ ...current, page: 1 }));
          }}
          industry={industryFilter}
          onIndustry={(value) => {
            setIndustryFilter(value);
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
          <TodayView agenda={agenda} agendaLoading={agendaLoading} groups={todayGroups} busy={busy} onOpen={openLead} onQuick={addQuickActivity} />
        ) : null}
        {!loading && view === "pipeline" ? (
          <PipelineView
            leads={leads}
            total={pagination.total}
            selectedStatus={statusFilter}
            busy={busy}
            onOpen={openLead}
            onStatus={updateLead}
          />
        ) : null}
        {!loading && view === "all" ? (
          <LeadList leads={leads} busy={busy} onOpen={openLead} />
        ) : null}

        {!loading && pagination.total === 0 ? (
          <EmptyState onCreate={() => setShowCreate(true)} />
        ) : null}

        {!loading && view !== "pipeline" && pagination.pages > 1 ? (
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
          currentUserRole={currentUserRole}
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
  industry,
  onIndustry,
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
  industry: string;
  onIndustry: (value: string) => void;
  attention: string;
  onAttention: (value: string) => void;
  assignee: string;
  onAssignee: (value: string) => void;
  assignees: Assignee[];
  canViewTeam: boolean;
  hideAttention: boolean;
}) {
  return <section className="grid min-w-0 gap-3 border-b border-focus-line pb-4 md:grid-cols-2 xl:grid-cols-5">
    <label className="relative min-w-0 md:col-span-2 xl:col-span-1">
      <span className="sr-only">Cauta</span>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input className="focus-input pl-10" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Companie, contact, email, telefon" />
    </label>
    <select className="focus-input" value={status} onChange={(event) => onStatus(event.target.value)} aria-label="Status CRM">
      <option value="">Toate etapele</option>
      {CRM_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <select className="focus-input" value={industry} onChange={(event) => onIndustry(event.target.value)} aria-label="Domeniu de activitate">
      <option value="">Toate domeniile</option>
      {CRM_INDUSTRY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
    {!hideAttention ? (
      <select className="focus-input" value={attention} onChange={(event) => onAttention(event.target.value)} aria-label="Urmatorul pas">
        <option value="all">Toate termenele</option>
        <option value="overdue">Restante</option>
        <option value="today">Astazi</option>
        <option value="upcoming">Viitoare</option>
        <option value="missing">Fara urmator pas</option>
      </select>
    ) : null}
    {canViewTeam ? (
      <select className="focus-input" value={assignee} onChange={(event) => onAssignee(event.target.value)} aria-label="Agent CRM">
        <option value="">Toti agentii</option>
        {assignees.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select>
    ) : null}
  </section>;
}

function TodayView({
  agenda,
  agendaLoading,
  groups,
  busy,
  onOpen,
  onQuick
}: {
  agenda: DailyAgenda;
  agendaLoading: boolean;
  groups: Record<"overdue" | "today" | "missing" | "noResponse" | "classification" | "stalled" | "dormant", LeadSummary[]>;
  busy: string | null;
  onOpen: (id: string) => void;
  onQuick: (id: string, input: Record<string, unknown>) => void;
}) {
  return <div className="grid gap-6">
    <section className="border-y border-focus-line py-5">
      <div className="mb-4">
        <p className="text-xs font-black uppercase text-focus-yellow">Agenda zilnica</p>
        <h2 className="text-xl font-black text-white">Ce necesita actiune acum</h2>
        <p className="mt-1 text-sm text-slate-400">Apeluri, incasari si oportunitati comerciale apropiate de termen.</p>
      </div>
      {agendaLoading ? <p className="py-8 text-center text-sm font-bold text-slate-400">Se incarca agenda...</p> : (
        <div className="grid min-w-0 gap-5">
          {!agenda.financialReport.available ? <div className="flex items-start gap-3 rounded-md border border-amber-300/35 bg-amber-400/10 px-4 py-3 text-sm text-amber-50">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p><strong>Datele de incasari nu sunt disponibile.</strong> Nu exista un raport financiar activ si confirmat; aplicatia nu afiseaza versiuni arhivate ca date curente.</p>
          </div> : null}
          <div className="grid min-w-0 gap-5 xl:grid-cols-3">
          <AgendaColumn title="De sunat" count={agenda.counts.calls} icon={<Phone size={17} />} empty="Nu ai apeluri restante pentru azi.">
            {agenda.calls.map((lead) => <article className="border-b border-focus-line py-3 last:border-b-0" key={lead.id}>
              <button className="w-full text-left" type="button" onClick={() => onOpen(lead.id)}>
                <strong className="block text-white">{lead.companyName}</strong>
                <small className="block text-slate-400">{lead.nextStep || "Follow-up comercial"} / {lead.nextFollowUpDate ? date(lead.nextFollowUpDate) : "restant"}</small>
              </button>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="focus-button secondary" type="button" disabled={busy === `activity-${lead.id}`} onClick={() => onQuick(lead.id, quickActionPayload("contacted", lead))}>Contactat</button>
                <button className="focus-button secondary" type="button" disabled={busy === `activity-${lead.id}`} onClick={() => onQuick(lead.id, quickActionPayload("no_answer", lead))}>Nu raspunde</button>
              </div>
            </article>)}
          </AgendaColumn>
          <AgendaColumn title="Incasari de urmarit" count={agenda.counts.receivables} icon={<CircleDollarSign size={17} />} empty={agenda.financialReport.available ? "Nu sunt incasari scadente in urmatoarele 7 zile." : "Activeaza si confirma raportul financiar curent pentru a vedea incasarile."}>
            {agenda.receivables.map((row) => <article className="border-b border-focus-line py-3 last:border-b-0" key={row.id}>
              <strong className="block text-white">{row.clientName || row.client?.companyName || row.companyName}</strong>
              <small className="block text-slate-400">{row.invoiceNumber || "Factura"} / {row.dueDate ? date(row.dueDate) : "fara termen"}</small>
              <p className="mt-1 text-sm font-black text-focus-yellow">{row.remainingAmount == null ? "-" : money(row.remainingAmount)} {row.currency || ""}</p>
              {row.clientId ? <a className="mt-2 inline-flex text-xs font-black text-white underline" href={`/admin/clienti?clientId=${encodeURIComponent(row.clientId)}`}>Deschide client</a> : null}
            </article>)}
          </AgendaColumn>
          <AgendaColumn title="Oportunitati de decis" count={agenda.counts.opportunities} icon={<Target size={17} />} empty="Nu sunt oportunitati apropiate de termen.">
            {agenda.opportunities.map((lead) => <button className="block w-full border-b border-focus-line py-3 text-left last:border-b-0" type="button" key={lead.id} onClick={() => onOpen(lead.id)}>
              <strong className="block text-white">{lead.companyName}</strong>
              <small className="block text-slate-400">{crmForecastCategoryLabel(lead.forecastCategory)} / inchidere {lead.expectedCloseDate ? date(lead.expectedCloseDate) : "nesetata"}</small>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-base font-black text-white">{lead.estimatedValue == null ? "Valoare nesetata" : `${money(lead.estimatedValue)} ${lead.currency || "EUR"}`}</p>
                <p className="text-sm font-black text-focus-yellow">{lead.probability}% sanse</p>
              </div>
            </button>)}
          </AgendaColumn>
          </div>
        </div>
      )}
    </section>

    {(groups.missing.length || groups.noResponse.length || groups.classification.length || groups.stalled.length || groups.dormant.length) ? <details className="border-y border-focus-line py-4">
      <summary className="cursor-pointer text-sm font-black uppercase text-focus-yellow">Semnale CRM suplimentare ({groups.missing.length + groups.noResponse.length + groups.classification.length + groups.stalled.length + groups.dormant.length})</summary>
      <div className="mt-5 grid gap-6">
        <LeadSection title="Fara urmator pas" description="Lead-uri active care trebuie planificate." rows={groups.missing} tone="red" busy={busy} onOpen={onOpen} onQuick={onQuick} />
        <LeadSection title="Fara raspuns" description="Cel putin trei tentative consecutive; schimba canalul sau decide urmatorul pas." rows={groups.noResponse} tone="red" busy={busy} onOpen={onOpen} onQuick={onQuick} />
        <LeadSection title="De clasificat" description="Prospecti Cold sau Contactati care asteapta o decizie comerciala." rows={groups.classification} tone="yellow" busy={busy} onOpen={onOpen} onQuick={onQuick} />
        <LeadSection title="Etape blocate" description="Oportunitati ramase prea mult in aceeasi etapa comerciala." rows={groups.stalled} tone="yellow" busy={busy} onOpen={onOpen} onQuick={onQuick} />
        {groups.dormant.length ? <LeadSection title="Fara activitate recenta" description="Lead-uri active neactualizate de peste 14 zile." rows={groups.dormant} tone="neutral" busy={busy} onOpen={onOpen} onQuick={onQuick} /> : null}
      </div>
    </details> : null}
    {!agendaLoading && !agenda.counts.calls && !agenda.counts.receivables && !agenda.counts.opportunities && !groups.missing.length && !groups.noResponse.length && !groups.classification.length && !groups.stalled.length && !groups.dormant.length ? (
      <section className="border-y border-focus-line py-10 text-center">
        <Check className="mx-auto h-10 w-10 text-emerald-300" />
        <h2 className="mt-3 text-xl font-black text-white">Agenda CRM este la zi</h2>
        <p className="mt-1 text-sm text-slate-400">Nu exista follow-up-uri restante sau lead-uri fara urmator pas.</p>
      </section>
    ) : null}
  </div>;
}

function AgendaColumn({ title, count, icon, empty, children }: { title: string; count: number; icon: React.ReactNode; empty: string; children: React.ReactNode }) {
  return <section className="min-w-0 border-t border-focus-line pt-3 xl:border-l xl:border-t-0 xl:pl-5 first:xl:border-l-0 first:xl:pl-0">
    <div className="flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-sm font-black uppercase text-white">{icon}{title}</h3>
      <span className="rounded-full border border-focus-line px-2 py-1 text-xs font-black text-focus-yellow">{count}</span>
    </div>
    <div className="mt-2 max-h-[30rem] overflow-y-auto pr-1">{count ? children : <p className="py-6 text-sm text-slate-400">{empty}</p>}</div>
  </section>;
}

function LeadSection({
  title,
  description,
  rows,
  tone,
  busy,
  onOpen,
  onQuick
}: {
  title: string;
  description: string;
  rows: LeadSummary[];
  tone: "red" | "yellow" | "neutral";
  busy: string | null;
  onOpen: (id: string) => void;
  onQuick: (id: string, input: Record<string, unknown>) => void;
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
      {rows.map((lead) => <LeadCard key={lead.id} lead={lead} tone={tone} busy={busy} onOpen={onOpen} onQuick={onQuick} />)}
    </div>
  </section>;
}

function LeadCard({
  lead,
  tone = "neutral",
  busy,
  onOpen,
  onQuick
}: {
  lead: LeadSummary;
  tone?: "red" | "yellow" | "neutral";
  busy: string | null;
  onOpen: (id: string) => void;
  onQuick?: (id: string, input: Record<string, unknown>) => void;
}) {
  return <article className={`grid min-h-40 gap-3 rounded-lg border p-4 shadow-[0_12px_30px_rgba(0,0,0,.12)] ${tone === "red" ? "border-red-300/30 bg-red-500/8" : tone === "yellow" ? "border-amber-200/25 bg-amber-300/5" : "border-white/10 bg-focus-ink/70"}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-lg font-black text-white">{lead.companyName}</p>
        <p className="truncate text-sm font-bold text-slate-200">{lead.opportunityName || "Oportunitate generala"}</p>
        <p className="truncate text-xs text-slate-400">{lead.industry || "Domeniu nesetat"} / {lead.contactName || "Fara contact"}{lead.assignedTo?.name ? ` / ${lead.assignedTo.name}` : ""}</p>
      </div>
      <div className="flex flex-wrap justify-end gap-2"><PriorityBadge priority={lead.priority} /><StatusBadge status={lead.status} /></div>
    </div>
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md bg-black/15 px-3 py-2">
      <strong className="text-lg font-black text-white">{lead.estimatedValue == null ? "Valoare nesetata" : `${money(lead.estimatedValue)} ${lead.currency || "EUR"}`}</strong>
      <span className="text-sm font-black text-focus-yellow">{lead.probability}% sanse</span>
      <span className="text-xs font-bold text-slate-400">{crmForecastCategoryLabel(lead.forecastCategory)}</span>
    </div>
    <div className="grid gap-2 text-xs sm:grid-cols-2">
      <InfoLine label="Follow-up" value={lead.nextFollowUpDate ? date(lead.nextFollowUpDate) : "Nesetat"} />
      <InfoLine label="Urmatorul pas" value={lead.nextStep || "Nesetat"} />
      <InfoLine label="Inchidere estimata" value={lead.expectedCloseDate ? date(lead.expectedCloseDate) : "Nesetata"} />
      <InfoLine label="Ultima activitate" value={lead.latestActivity ? dateTime(lead.latestActivity.activityDate) : "Fara activitate"} />
      <InfoLine label="Calificare" value={`${lead.qualification.completed}/${lead.qualification.total}`} />
      <InfoLine label="Timp in etapa" value={`${lead.stageAgeDays} zile`} />
    </div>
    <div className="mt-auto flex flex-wrap gap-2">
      {onQuick ? <>
        <button className="focus-button secondary" type="button" disabled={busy === `activity-${lead.id}`} onClick={() => onQuick(lead.id, quickActionPayload("contacted", lead))}>
          <Phone size={15} /> Contactat
        </button>
        <button className="focus-button secondary" type="button" disabled={busy === `activity-${lead.id}`} onClick={() => onQuick(lead.id, quickActionPayload("no_answer", lead))}>
          <Clock3 size={15} /> Nu raspunde
        </button>
      </> : null}
      <button className="focus-button" type="button" disabled={busy === `open-${lead.id}`} onClick={() => onOpen(lead.id)}>
        Deschide <ArrowRight size={16} />
      </button>
    </div>
  </article>;
}

function PipelineView({
  leads,
  total,
  selectedStatus,
  busy,
  onOpen,
  onStatus
}: {
  leads: LeadSummary[];
  total: number;
  selectedStatus: string;
  busy: string | null;
  onOpen: (id: string) => void;
  onStatus: (id: string, patch: Record<string, unknown>) => void;
}) {
  const columns = selectedStatus
    ? CRM_STATUS_OPTIONS.filter((option) => option.value === selectedStatus)
    : CRM_STATUS_OPTIONS.filter((option) => option.value !== "inactive");
  return <section className="min-w-0">
    {total > leads.length ? <p className="mb-3 text-xs font-bold text-focus-yellow">Sunt afisate primele {leads.length} din {total} lead-uri. Foloseste filtrele pentru un pipeline mai precis.</p> : null}
    <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {columns.map((column) => {
        const rows = leads.filter((lead) => lead.status === column.value);
        return <section className="min-h-56 min-w-0 overflow-hidden rounded-lg border border-white/10 bg-focus-ink/40 shadow-[0_12px_35px_rgba(0,0,0,.12)]" key={column.value}>
          <div className="flex items-center justify-between gap-3 border-b border-white/8 bg-focus-navy/90 px-3 py-3">
            <h2 className="text-xs font-black uppercase text-white">{column.label}</h2>
            <span className="rounded-full bg-focus-yellow px-2 py-0.5 text-xs font-black text-focus-navy">{rows.length}</span>
          </div>
          <div className="grid gap-2 p-2">
            {rows.map((lead) => <article className="rounded-md border border-white/10 bg-focus-navy/65 p-3 shadow-sm" key={lead.id}>
              <button className="block w-full text-left" type="button" onClick={() => onOpen(lead.id)}>
                <strong className="block truncate text-white">{lead.companyName}</strong>
                <span className="mt-1 block truncate text-xs font-bold text-slate-200">{lead.opportunityName || "Oportunitate generala"}</span>
                <span className="mt-1 block truncate text-xs text-slate-400">{lead.assignedTo?.name || "Nealocat"} / {lead.stageAgeDays} zile in etapa</span>
                <span className="mt-3 flex flex-wrap items-baseline gap-2 rounded-md bg-black/15 px-2.5 py-2">
                  <strong className="text-base font-black text-white">{lead.estimatedValue == null ? "Valoare nesetata" : `${money(lead.estimatedValue)} ${lead.currency || "EUR"}`}</strong>
                  <span className="text-xs font-black text-focus-yellow">{lead.probability}% sanse</span>
                </span>
                <span className="mt-2 block text-xs text-slate-300">Inchidere: {lead.expectedCloseDate ? date(lead.expectedCloseDate) : "nesetata"}</span>
                <span className="mt-1 block truncate text-xs text-slate-400">Follow-up: {lead.nextFollowUpDate ? date(lead.nextFollowUpDate) : "nesetat"}</span>
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
  return <section className="min-w-0 overflow-hidden border-y border-focus-line py-3 xl:py-0">
    <div className="grid gap-3 xl:hidden">
      {leads.map((lead) => <LeadCard key={lead.id} lead={lead} busy={busy} onOpen={onOpen} />)}
    </div>
    <div className="hidden overflow-x-auto xl:block">
      <table className="w-full min-w-[1280px] text-sm">
        <thead className="bg-focus-navy/80 text-left text-xs uppercase text-slate-400">
          <tr>
            <th className="px-3 py-3">Companie</th>
            <th className="px-3 py-3">Valoare oportunitate</th>
            <th className="px-3 py-3">Sanse</th>
            <th className="px-3 py-3">Nivel forecast</th>
            <th className="px-3 py-3">Etapa</th>
            <th className="px-3 py-3">Follow-up</th>
            <th className="px-3 py-3">Agent</th>
            <th className="px-3 py-3">Ultima activitate</th>
            <th className="px-3 py-3">Actiune</th>
          </tr>
        </thead>
        <tbody>{leads.map((lead) => <tr className="border-t border-focus-line" key={lead.id}>
          <td className="px-3 py-3"><strong className="text-white">{lead.companyName}</strong><small className="block font-bold text-slate-300">{lead.opportunityName || "Oportunitate generala"}</small><small className="block text-slate-400">{lead.industry || "Domeniu nesetat"} / {lead.contactName || lead.email || lead.phone || "Fara contact"}</small></td>
          <td className="px-3 py-3 font-black text-white">{lead.estimatedValue == null ? "-" : `${money(lead.estimatedValue)} ${lead.currency || "EUR"}`}</td>
          <td className="px-3 py-3 font-black text-focus-yellow">{lead.probability}%</td>
          <td className="px-3 py-3">{crmForecastCategoryLabel(lead.forecastCategory)}</td>
          <td className="px-3 py-3"><StatusBadge status={lead.status} /></td>
          <td className="px-3 py-3"><span className={lead.attention === "overdue" || lead.attention === "missing" ? "font-black text-red-100" : ""}>{lead.nextFollowUpDate ? date(lead.nextFollowUpDate) : "Nesetat"}</span></td>
          <td className="px-3 py-3">{lead.assignedTo?.name || "Nealocat"}</td>
          <td className="px-3 py-3">{lead.latestActivity ? `${activityLabel(lead.latestActivity.actionType)} / ${date(lead.latestActivity.activityDate)}` : "-"}</td>
          <td className="px-3 py-3"><button className="focus-button secondary" type="button" disabled={busy === `open-${lead.id}`} onClick={() => onOpen(lead.id)}>Deschide</button></td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function CreateLeadDialog({
  currentUserId,
  currentUserRole,
  canViewTeam,
  assignees,
  busy,
  onClose,
  onCreate,
  onOpenExisting
}: {
  currentUserId: string;
  currentUserRole: string;
  canViewTeam: boolean;
  assignees: Assignee[];
  busy: boolean;
  onClose: () => void;
  onCreate: (input: Record<string, unknown>) => void;
  onOpenExisting: (id: string) => void;
}) {
  const [form, setForm] = useState({
    companyName: "",
    taxId: "",
    industry: "",
    opportunityName: "",
    clientType: "direct_client",
    clientId: "",
    contactName: "",
    contactRole: "",
    phone: "",
    email: "",
    source: "Prospectare directa",
    assignedToUserId: canViewTeam ? assignees[0]?.id || "" : currentUserId,
    status: "cold",
    estimatedValue: "",
    currency: "EUR",
    probability: String(crmDefaultProbability("cold")),
    expectedCloseDate: "",
    nextFollowUpDate: tomorrowInput(),
    nextStep: "Contact initial",
    locationsInterested: "",
    notes: ""
  });
  const [probabilityTouched, setProbabilityTouched] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateResults>({ clients: [], leads: [] });

  useEffect(() => {
    if (!canViewTeam || form.assignedToUserId || !assignees[0]) return;
    setForm((current) => ({ ...current, assignedToUserId: assignees[0].id }));
  }, [assignees, canViewTeam, form.assignedToUserId]);

  useEffect(() => {
    const query = form.companyName.trim();
    const taxId = form.taxId.trim();
    if (query.length < 2 && taxId.length < 2) {
      setDuplicates({ clients: [], leads: [] });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query, taxId });
      fetch(`/api/admin/crm/duplicates?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
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
  }, [form.companyName, form.taxId]);

  const probability = Number(form.probability);
  const probabilityValid = form.probability.trim() !== "" && Number.isInteger(probability) && probability >= 0 && probability <= 100;
  const forecastReady = !probabilityValid || probability < 50
    || (Number(form.estimatedValue.replace(",", ".")) > 0 && Boolean(form.expectedCloseDate));
  const forecastCategory = crmForecastCategoryForStatus(form.status, probabilityValid ? probability : null);
  const ownershipConflict = currentUserRole === "SALES_AGENT"
    && duplicates.leads.some((lead) => lead.exactTaxIdMatch && !lead.canOpen);
  const valid = form.companyName.trim().length >= 2
    && form.taxId.trim().length >= 2
    && form.industry.trim().length >= 2
    && form.nextFollowUpDate
    && form.nextStep.trim().length >= 2
    && form.assignedToUserId
    && probabilityValid
    && forecastReady
    && !ownershipConflict;

  function changeInitialStatus(status: CrmStatus) {
    setForm({
      ...form,
      status,
      probability: probabilityTouched ? form.probability : String(crmDefaultProbability(status))
    });
  }

  return <ModalShell title="Oportunitate CRM noua" onClose={onClose}>
    <div className="grid gap-4">
      <p className="text-sm text-slate-300">Completeaza compania si urmatoarea actiune. Restul poate fi adaugat cand discutia avanseaza.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Companie"><input className="focus-input" value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value, clientId: "" })} autoFocus /></Field>
        <Field label="CUI / CIF"><input className="focus-input" value={form.taxId} onChange={(event) => setForm({ ...form, taxId: event.target.value.toUpperCase(), clientId: "" })} placeholder="Ex: RO12345678" /></Field>
        <Field label="Domeniu de activitate"><select className="focus-input" value={form.industry} onChange={(event) => setForm({ ...form, industry: event.target.value })}><option value="">Alege domeniul</option>{CRM_INDUSTRY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></Field>
        <Field label="Oportunitate / campanie"><input className="focus-input" value={form.opportunityName} onChange={(event) => setForm({ ...form, opportunityName: event.target.value })} placeholder="Ex: Lansare toamna 2026" /></Field>
        <Field label="Contact"><input className="focus-input" value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} /></Field>
        <Field label="Telefon"><input className="focus-input" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>
        <Field label="Sursa"><select className="focus-input" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}>{CRM_SOURCE_OPTIONS.map((source) => <option key={source}>{source}</option>)}</select></Field>
        <Field label="Urmatorul follow-up"><input className="focus-input" type="date" min={todayInput()} value={form.nextFollowUpDate} onChange={(event) => setForm({ ...form, nextFollowUpDate: event.target.value })} /></Field>
        <Field label="Urmatorul pas"><input className="focus-input" value={form.nextStep} onChange={(event) => setForm({ ...form, nextStep: event.target.value })} /></Field>
        {canViewTeam ? <Field label="Agent responsabil"><select className="focus-input" value={form.assignedToUserId} onChange={(event) => setForm({ ...form, assignedToUserId: event.target.value })}><option value="">Alege agent</option>{assignees.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field> : null}
      </div>

      <details className="rounded-lg border border-white/10 bg-white/[.025] p-4" open>
        <summary className="cursor-pointer text-sm font-black text-focus-yellow">Situatie comerciala</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Tip client"><select className="focus-input" value={form.clientType} onChange={(event) => setForm({ ...form, clientType: event.target.value })}><option value="direct_client">Client direct</option><option value="agency">Agentie</option></select></Field>
          <Field label="Functie contact"><input className="focus-input" value={form.contactRole} onChange={(event) => setForm({ ...form, contactRole: event.target.value })} /></Field>
          <Field label="E-mail"><input className="focus-input" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
          <Field label="Etapa initiala"><select className="focus-input" value={form.status} onChange={(event) => changeInitialStatus(event.target.value as CrmStatus)}>{CRM_STATUS_OPTIONS.filter((option) => isActiveCrmStatus(option.value)).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
          <Field label="Valoare oportunitate"><input className="focus-input" inputMode="decimal" value={form.estimatedValue} onChange={(event) => setForm({ ...form, estimatedValue: event.target.value })} placeholder="Ex: 4000" /></Field>
          <Field label="Moneda"><select className="focus-input" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}><option>EUR</option><option>RON</option></select></Field>
          <Field label="Sanse de castig (%)"><input className="focus-input" type="number" min={0} max={100} step={1} value={form.probability} onChange={(event) => { setProbabilityTouched(true); setForm({ ...form, probability: event.target.value }); }} /></Field>
          <Field label="Data estimata inchidere"><input className="focus-input" type="date" value={form.expectedCloseDate} onChange={(event) => setForm({ ...form, expectedCloseDate: event.target.value })} /></Field>
          <Field label="Interes OOH"><input className="focus-input" value={form.locationsInterested} onChange={(event) => setForm({ ...form, locationsInterested: event.target.value })} placeholder="Orase, formate, coduri" /></Field>
        </div>
        <p className="mt-3 text-xs text-slate-400">{crmStatusDescription(form.status)}</p>
        <p className="mt-2 rounded-md bg-focus-yellow/8 px-3 py-2 text-xs font-bold text-slate-200">Valoarea intra integral in forecast. Procentul indica doar sansele de castig. Nivel calculat: <strong className="text-focus-yellow">{crmForecastCategoryLabel(forecastCategory)}</strong>.</p>
        {!probabilityValid ? <p className="mt-2 text-xs font-bold text-red-100">Sansele trebuie sa fie un numar intreg intre 0 si 100.</p> : null}
        {!forecastReady ? <p className="mt-2 text-xs font-bold text-red-100">Pentru minimum 50% sanse completeaza valoarea integrala si data estimata de inchidere.</p> : null}
        <Field label="Note"><textarea className="focus-input mt-3 min-h-20" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
      </details>

      {(duplicates.clients.length || duplicates.leads.length) ? (
        <section className="rounded-md border border-focus-yellow/40 bg-focus-yellow/5 p-3">
          <h3 className="text-xs font-black uppercase text-focus-yellow">Posibile inregistrari existente</h3>
          <div className="mt-2 grid gap-2">
            {duplicates.clients.map((client) => <button className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm ${client.exactTaxIdMatch ? "border-focus-yellow bg-focus-yellow/10" : "border-focus-line"}`} type="button" key={client.id} onClick={() => setForm({ ...form, clientId: client.id, companyName: client.companyName, taxId: client.taxId || form.taxId })}><span><strong className="text-white">{client.companyName}</strong><small className="block text-slate-400">CUI {client.taxId || "nesetat"} / {client.accountOwner?.name || "fara owner"}</small></span><span className="text-focus-yellow">Leaga</span></button>)}
            {duplicates.leads.map((lead) => <button className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm ${lead.exactTaxIdMatch ? "border-red-300/60 bg-red-400/10" : "border-focus-line"}`} type="button" key={lead.id} disabled={!lead.canOpen} onClick={() => lead.canOpen && onOpenExisting(lead.id)}><span><strong className="text-white">{lead.companyName}</strong><small className="block text-slate-400">{lead.opportunityName || "Oportunitate activa"} / {lead.assignedTo?.name || "neacordat"}</small><small className="block text-slate-500">{lead.lastContactAt ? `Ultimul contact ${dateTime(lead.lastContactAt)}` : "Fara contact inregistrat"}</small></span><span className="text-focus-yellow">{lead.canOpen ? "Deschide" : "Exista la alt agent"}</span></button>)}
          </div>
          {currentUserRole === "SALES_AGENT" && duplicates.leads.some((lead) => lead.exactTaxIdMatch && !lead.canOpen) ? <p className="mt-3 text-xs font-bold text-red-100">CUI-ul este lucrat de alt vanzator. Crearea va fi oprita pentru a evita contactarea paralela.</p> : null}
        </section>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2 border-t border-focus-line pt-4">
        <button className="focus-button secondary" type="button" onClick={onClose}>Renunta</button>
        <button className="focus-button" type="button" disabled={!valid || busy} onClick={() => onCreate({
          ...form,
          clientId: form.clientId || null,
          opportunityName: form.opportunityName || null,
          nextStep: form.nextStep || "Contact initial",
          estimatedValue: form.estimatedValue ? Number(form.estimatedValue.replace(",", ".")) : null,
          probability,
          expectedCloseDate: form.expectedCloseDate || null
        })}>{busy ? "Se salveaza..." : "Creeaza oportunitate"}</button>
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
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<boolean>;
  onActivity: (id: string, input: Record<string, unknown>) => void;
  onContact: (id: string, input: Record<string, unknown>) => void;
  onRemoveContact: (leadId: string, contactId: string) => void;
  onConvert: (id: string, clientId?: string | null) => Promise<boolean>;
  onOpenLead: (id: string) => void;
}) {
  const [draft, setDraft] = useState({
    taxId: lead.taxId || "",
    industry: lead.industry || "",
    opportunityName: lead.opportunityName || "",
    status: lead.status,
    source: lead.source || "Prospectare directa",
    assignedToUserId: lead.assignedToUserId || "",
    estimatedValue: lead.estimatedValue == null ? "" : String(lead.estimatedValue),
    currency: lead.currency || "EUR",
    probability: String(lead.probability),
    expectedCloseDate: lead.expectedCloseDate?.slice(0, 10) || "",
    nextFollowUpDate: lead.nextFollowUpDate?.slice(0, 10) || "",
    nextStep: lead.nextStep || "",
    qualificationData: { ...lead.qualificationData },
    locationsInterested: lead.locationsInterested || "",
    notes: lead.notes || "",
    lostReason: lead.lostReason || "",
    lostReasonCode: lead.lostReasonCode || ""
  });
  const [activity, setActivity] = useState({
    actionType: "telefon",
    details: "",
    nextStep: lead.nextStep || "",
    nextFollowUpDate: lead.nextFollowUpDate?.slice(0, 10) || tomorrowInput(),
    locations: lead.locationsInterested || ""
  });
  const [contact, setContact] = useState({ name: "", role: "", phone: "", email: "", isPrimary: lead.contacts.length === 0 });
  const [duplicates, setDuplicates] = useState<DuplicateResults>({ clients: [], leads: [] });
  const [showCloseOpportunity, setShowCloseOpportunity] = useState(false);

  useEffect(() => {
    setDraft({
      taxId: lead.taxId || "",
      industry: lead.industry || "",
      opportunityName: lead.opportunityName || "",
      status: lead.status,
      source: lead.source || "Prospectare directa",
      assignedToUserId: lead.assignedToUserId || "",
      estimatedValue: lead.estimatedValue == null ? "" : String(lead.estimatedValue),
      currency: lead.currency || "EUR",
      probability: String(lead.probability),
      expectedCloseDate: lead.expectedCloseDate?.slice(0, 10) || "",
      nextFollowUpDate: lead.nextFollowUpDate?.slice(0, 10) || "",
      nextStep: lead.nextStep || "",
      qualificationData: { ...lead.qualificationData },
      locationsInterested: lead.locationsInterested || "",
      notes: lead.notes || "",
      lostReason: lead.lostReason || "",
      lostReasonCode: lead.lostReasonCode || ""
    });
  }, [lead]);

  useEffect(() => {
    setActivity((current) => ({
      ...current,
      nextStep: lead.nextStep || current.nextStep,
      nextFollowUpDate: lead.nextFollowUpDate?.slice(0, 10) || current.nextFollowUpDate,
      locations: lead.locationsInterested || current.locations
    }));
  }, [lead.id, lead.locationsInterested, lead.nextFollowUpDate, lead.nextStep]);

  useEffect(() => {
    if (lead.clientId) {
      setDuplicates({ clients: [], leads: [] });
      return;
    }
    const params = new URLSearchParams({ q: lead.companyName, taxId: lead.taxId || "" });
    fetch(`/api/admin/crm/duplicates?${params.toString()}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => payload && setDuplicates({ clients: payload.clients || [], leads: payload.leads || [] }))
      .catch(() => undefined);
  }, [lead.clientId, lead.companyName, lead.taxId]);

  const draftProbability = Number(draft.probability);
  const probabilityValid = draft.probability.trim() !== "" && Number.isInteger(draftProbability) && draftProbability >= 0 && draftProbability <= 100;
  const draftForecastCategory = crmForecastCategoryForStatus(draft.status, probabilityValid ? draftProbability : null);
  const forecastReady = !probabilityValid || draftProbability < 50
    || (Number(draft.estimatedValue.replace(",", ".")) > 0 && Boolean(draft.expectedCloseDate));
  const saveDisabled = draft.industry.trim().length < 2 || !probabilityValid || !forecastReady || (
    isActiveCrmStatus(draft.status)
    && (!draft.nextFollowUpDate || draft.nextStep.trim().length < 2)
  );

  function changeDraftStatus(status: CrmStatus) {
    setDraft({ ...draft, status });
  }

  const draftQualificationCompleted = qualificationCompleted(draft.qualificationData);

  return <>
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/65" role="dialog" aria-modal="true" aria-label={`Oportunitate ${lead.companyName}`}>
    <div className="h-full w-full max-w-[940px] overflow-y-auto border-l border-white/10 bg-focus-navy shadow-2xl">
      <div className="sticky top-0 z-20 flex items-start justify-between gap-4 border-b border-white/10 bg-focus-navy/95 px-5 py-4 backdrop-blur sm:px-7">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Dosar oportunitate</p>
          <h2 className="text-2xl font-black text-white">{lead.companyName}</h2>
          <p className="mt-1 text-sm font-bold text-slate-200">{lead.opportunityName || "Oportunitate generala"}</p>
          <p className="mt-1 text-xs text-slate-400">{lead.industry || "Domeniu nesetat"} / CUI {lead.taxId || "nesetat"} / {lead.assignedTo?.name || "Nealocat"} / actualizat {dateTime(lead.updatedAt)}</p>
        </div>
        <button className="focus-button secondary" type="button" onClick={onClose} aria-label="Inchide"><X size={18} /></button>
      </div>

      <div className="grid gap-6 p-5 sm:p-7">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Rezumat oportunitate">
          <MiniMetric label="Etapa" value={statusLabel(lead.status)} />
          <MiniMetric label="Vechime etapa" value={`${lead.stageAgeDays} zile`} tone={lead.stageStalled ? "red" : "neutral"} />
          <MiniMetric label="Calificare" value={`${lead.qualification.completed}/${lead.qualification.total}`} />
          <MiniMetric label="Valoare oportunitate" value={lead.estimatedValue == null ? "-" : `${money(lead.estimatedValue)} ${lead.currency || "EUR"}`} />
          <MiniMetric label="Sanse de castig" value={`${lead.probability}%`} />
          <MiniMetric label="Nivel forecast" value={crmForecastCategoryLabel(lead.forecastCategory)} />
          <MiniMetric label="Follow-up" value={lead.nextFollowUpDate ? date(lead.nextFollowUpDate) : "Nesetat"} tone={lead.attention === "overdue" || lead.attention === "missing" ? "red" : "neutral"} />
        </section>

        <section className="rounded-md border border-focus-yellow/40 bg-focus-yellow/5 p-4">
          <p className="text-xs font-black uppercase text-focus-yellow">Urmatorul pas</p>
          <p className="mt-2 text-base font-black text-white">{lead.nextStep || "Nesetat"}</p>
          <p className="mt-1 text-xs text-slate-400">{lead.nextFollowUpDate ? date(lead.nextFollowUpDate) : "Fara termen"}{lead.noResponseCount ? ` / ${lead.noResponseCount} tentative fara raspuns` : ""}</p>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[.025] p-4 sm:p-5" aria-label="Situatie comerciala">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black uppercase text-focus-yellow">Situatie comerciala</h3>
              <p className="mt-1 text-xs text-slate-400">Valoarea este integrala; procentul masoara doar increderea in castig.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {lead.clientId ? <span className="text-xs font-black text-emerald-200">Client asociat: {lead.client?.companyName}</span> : null}
              {isActiveCrmStatus(lead.status) ? <button className="focus-button" type="button" disabled={busy === `convert-${lead.id}`} onClick={() => setShowCloseOpportunity(true)}><Check size={17} /> Inchide oportunitatea</button> : null}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label="CUI / CIF"><input className="focus-input" value={draft.taxId} onChange={(event) => setDraft({ ...draft, taxId: event.target.value.toUpperCase() })} /></Field>
            <Field label="Domeniu de activitate"><select className="focus-input" value={draft.industry} onChange={(event) => setDraft({ ...draft, industry: event.target.value })}><option value="">Nesetat</option>{CRM_INDUSTRY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></Field>
            <Field label="Oportunitate / campanie"><input className="focus-input" value={draft.opportunityName} onChange={(event) => setDraft({ ...draft, opportunityName: event.target.value })} /></Field>
            <Field label="Etapa"><select className="focus-input" disabled={!isActiveCrmStatus(lead.status)} value={draft.status} onChange={(event) => changeDraftStatus(event.target.value as CrmStatus)}>{CRM_STATUS_OPTIONS.filter((option) => isActiveCrmStatus(option.value) || option.value === "inactive" || option.value === lead.status).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
            <Field label="Sursa"><select className="focus-input" value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })}>{CRM_SOURCE_OPTIONS.map((source) => <option key={source}>{source}</option>)}</select></Field>
            {canViewTeam ? <Field label="Agent"><select className="focus-input" value={draft.assignedToUserId} onChange={(event) => setDraft({ ...draft, assignedToUserId: event.target.value })}>{assignees.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field> : null}
            <Field label="Valoare oportunitate"><input className="focus-input" inputMode="decimal" value={draft.estimatedValue} onChange={(event) => setDraft({ ...draft, estimatedValue: event.target.value })} /></Field>
            <Field label="Moneda"><select className="focus-input" value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value })}><option>EUR</option><option>RON</option></select></Field>
            <Field label="Sanse de castig (%)"><input className="focus-input" type="number" min={0} max={100} step={1} value={draft.probability} onChange={(event) => setDraft({ ...draft, probability: event.target.value })} /></Field>
            <Field label="Data estimata inchidere"><input className="focus-input" type="date" value={draft.expectedCloseDate} onChange={(event) => setDraft({ ...draft, expectedCloseDate: event.target.value })} /></Field>
            <Field label="Urmatorul follow-up"><input className="focus-input" type="date" value={draft.nextFollowUpDate} onChange={(event) => setDraft({ ...draft, nextFollowUpDate: event.target.value })} /></Field>
            <Field label="Urmatorul pas"><input className="focus-input" value={draft.nextStep} onChange={(event) => setDraft({ ...draft, nextStep: event.target.value })} /></Field>
            <Field label="Interes OOH"><input className="focus-input" value={draft.locationsInterested} onChange={(event) => setDraft({ ...draft, locationsInterested: event.target.value })} /></Field>
          </div>
          <p className="mt-3 text-xs text-slate-400">{crmStatusDescription(draft.status)}</p>
          <p className="mt-2 rounded-md bg-focus-yellow/8 px-3 py-2 text-xs font-bold text-slate-200">Valoarea intra integral in forecast. Procentul indica doar sansele de castig. Nivel calculat: <strong className="text-focus-yellow">{crmForecastCategoryLabel(draftForecastCategory)}</strong>.</p>
          {!probabilityValid ? <p className="mt-2 text-xs font-bold text-red-100">Sansele trebuie sa fie un numar intreg intre 0 si 100.</p> : null}
          {!forecastReady ? <p className="mt-2 text-xs font-bold text-red-100">Pentru minimum 50% sanse completeaza valoarea integrala si data estimata de inchidere.</p> : null}

          <details className="mt-4 border-y border-focus-line py-3" open={lead.qualification.completed < 4}>
            <summary className="cursor-pointer text-sm font-black text-focus-yellow">Calificare OOH: {draftQualificationCompleted}/{CRM_QUALIFICATION_ITEMS.length}</summary>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-focus-ink">
              <span className="block h-full bg-focus-yellow" style={{ width: `${Math.round((draftQualificationCompleted / CRM_QUALIFICATION_ITEMS.length) * 100)}%` }} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {CRM_QUALIFICATION_ITEMS.map((item) => <label className="flex items-center gap-2 rounded-md border border-focus-line px-3 py-2 text-sm font-bold text-slate-200" key={item.key}>
                <input type="checkbox" checked={draft.qualificationData[item.key]} onChange={(event) => setDraft({
                  ...draft,
                  qualificationData: { ...draft.qualificationData, [item.key]: event.target.checked }
                })} />
                {item.label}
              </label>)}
            </div>
          </details>

          <Field label="Note interne"><textarea className="focus-input mt-3 min-h-24" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></Field>
          <div className="sticky bottom-0 z-10 mt-4 flex justify-end border-t border-white/10 bg-focus-navy/95 py-3 backdrop-blur">
            <button className="focus-button" type="button" disabled={saveDisabled || busy === `update-${lead.id}`} onClick={() => onUpdate(lead.id, {
              taxId: draft.taxId || undefined,
              industry: draft.industry || undefined,
              opportunityName: draft.opportunityName || null,
              status: draft.status,
              source: draft.source,
              assignedToUserId: draft.assignedToUserId,
              estimatedValue: draft.estimatedValue ? Number(draft.estimatedValue.replace(",", ".")) : null,
              currency: draft.currency,
              probability: draftProbability,
              expectedCloseDate: draft.expectedCloseDate || null,
              nextFollowUpDate: draft.nextFollowUpDate || null,
              nextStep: draft.nextStep || null,
              qualificationData: draft.qualificationData,
              locationsInterested: draft.locationsInterested || null,
              notes: draft.notes || null,
              lostReason: draft.lostReason || null,
              lostReasonCode: draft.lostReasonCode || null
            })}>{busy === `update-${lead.id}` ? "Se salveaza..." : "Salveaza oportunitate"}</button>
          </div>
        </section>

        {isActiveCrmStatus(lead.status) ? <section className="border-y border-focus-line py-5">
          <h3 className="text-sm font-black uppercase text-focus-yellow">Actiuni rapide</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="focus-button secondary" type="button" disabled={busy === `activity-${lead.id}`} onClick={() => onActivity(lead.id, quickActionPayload("contacted", lead))}><Phone size={16} /> Contactat</button>
            <button className="focus-button secondary" type="button" disabled={busy === `activity-${lead.id}`} onClick={() => onActivity(lead.id, quickActionPayload("no_answer", lead))}><Clock3 size={16} /> Nu raspunde</button>
            <button className="focus-button secondary" type="button" disabled={busy === `activity-${lead.id}`} onClick={() => onActivity(lead.id, quickActionPayload("email_sent", lead))}><Mail size={16} /> E-mail trimis</button>
            <button className="focus-button secondary" type="button" disabled={busy === `activity-${lead.id}`} onClick={() => onActivity(lead.id, quickActionPayload("qualified", lead))}><Target size={16} /> Calificat</button>
            <button className="focus-button secondary" type="button" disabled={busy === `activity-${lead.id}`} onClick={() => onActivity(lead.id, quickActionPayload("brief_received", lead))}><MessageSquareText size={16} /> Brief primit</button>
            <button className="focus-button secondary" type="button" disabled={busy === `activity-${lead.id}`} onClick={() => onActivity(lead.id, quickActionPayload("offer_sent", lead))}><BriefcaseBusiness size={16} /> Oferta trimisa</button>
            <button className="focus-button secondary" type="button" disabled={busy === `activity-${lead.id}`} onClick={() => onActivity(lead.id, quickActionPayload("follow_up_7", lead))}><CalendarClock size={16} /> Revino in 7 zile</button>
          </div>
        </section> : null}

        <section className="border-y border-focus-line py-5">
          <h3 className="text-sm font-black uppercase text-focus-yellow">Inregistreaza activitate</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="Tip"><select className="focus-input" value={activity.actionType} onChange={(event) => setActivity({ ...activity, actionType: event.target.value })}>{actionTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="Urmatorul follow-up"><input className="focus-input" type="date" value={activity.nextFollowUpDate} onChange={(event) => setActivity({ ...activity, nextFollowUpDate: event.target.value })} /></Field>
            <Field label="Urmatorul pas"><input className="focus-input" value={activity.nextStep} onChange={(event) => setActivity({ ...activity, nextStep: event.target.value })} /></Field>
            <Field label="Interes OOH"><input className="focus-input" value={activity.locations} onChange={(event) => setActivity({ ...activity, locations: event.target.value })} /></Field>
          </div>
          <Field label="Rezumat activitate"><textarea className="focus-input mt-3 min-h-24" value={activity.details} onChange={(event) => setActivity({ ...activity, details: event.target.value })} /></Field>
          <div className="mt-3 flex justify-end"><button className="focus-button" type="button" disabled={activity.details.trim().length < 2 || (isActiveCrmStatus(lead.status) && (!activity.nextFollowUpDate || activity.nextStep.trim().length < 2)) || busy === `activity-${lead.id}`} onClick={() => {
            onActivity(lead.id, activity);
            setActivity((current) => ({ ...current, details: "" }));
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

        {lead.companyHistory.length ? <section>
          <h3 className="text-sm font-black uppercase text-focus-yellow">Istoric companie</h3>
          <p className="mt-1 text-xs text-slate-400">Cine a lucrat firma si cand a fost ultimul contact. Notele altor agenti raman private.</p>
          <div className="mt-3 grid gap-2">
            {lead.companyHistory.map((row) => <button className="flex w-full flex-wrap items-center justify-between gap-3 border-b border-focus-line py-3 text-left disabled:cursor-default" type="button" disabled={!row.canOpen || row.isCurrent} key={row.id} onClick={() => row.canOpen && !row.isCurrent && onOpenLead(row.id)}>
              <span className="min-w-0">
                <strong className="block truncate text-white">{row.opportunityName || "Oportunitate generala"}{row.isCurrent ? " / curenta" : ""}</strong>
                <small className="block text-slate-400">{statusLabel(row.status)} / {row.assignedTo?.name || "neacordat"}</small>
              </span>
              <span className="text-right text-xs text-slate-400">
                {row.lastContactAt ? `Contact ${dateTime(row.lastContactAt)}` : row.lastActivityAt ? `Activitate ${dateTime(row.lastActivityAt)}` : `Creata ${dateTime(row.createdAt)}`}
                {row.latestActivity?.user?.name ? <small className="block">de {row.latestActivity.user.name}</small> : null}
              </span>
            </button>)}
          </div>
        </section> : null}

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
            <h3 className="text-sm font-black uppercase text-focus-yellow">Oportunitati similare</h3>
            <div className="mt-3 grid gap-2">
              {duplicates.leads.filter((row) => row.id !== lead.id).map((row) => <button className="rounded-md border border-focus-line px-3 py-3 text-left" type="button" disabled={!row.canOpen} key={row.id} onClick={() => row.canOpen && onOpenLead(row.id)}><strong className="text-white">{row.companyName}</strong><small className="block text-slate-300">{row.opportunityName || "Oportunitate generala"}</small><small className="block text-slate-400">{statusLabel(row.status)} / {row.assignedTo?.name || "neacordat"}</small></button>)}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  </div>
  {showCloseOpportunity ? <CloseOpportunityModal
    lead={lead}
    clients={duplicates.clients}
    busy={busy}
    onClose={() => setShowCloseOpportunity(false)}
    onWon={async (clientId) => {
      const succeeded = await onConvert(lead.id, clientId);
      if (succeeded) setShowCloseOpportunity(false);
    }}
    onLost={async (lostReasonCode, lostReason) => {
      const succeeded = await onUpdate(lead.id, {
        status: "lost",
        probability: 0,
        nextFollowUpDate: null,
        nextStep: null,
        lostReasonCode,
        lostReason
      });
      if (succeeded) setShowCloseOpportunity(false);
    }}
  /> : null}
  </>;
}

function CloseOpportunityModal({
  lead,
  clients,
  busy,
  onClose,
  onWon,
  onLost
}: {
  lead: LeadDetail;
  clients: DuplicateResults["clients"];
  busy: string | null;
  onClose: () => void;
  onWon: (clientId?: string | null) => Promise<void>;
  onLost: (reasonCode: string, reason: string) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState<"won" | "lost">("won");
  const [selectedClientId, setSelectedClientId] = useState(lead.clientId || clients[0]?.id || "");
  const [lostReasonCode, setLostReasonCode] = useState("");
  const [lostReason, setLostReason] = useState("");
  const pending = busy === `convert-${lead.id}` || busy === `update-${lead.id}`;
  const lossReady = Boolean(lostReasonCode) && lostReason.trim().length >= 2;
  const selectedClient = clients.find((client) => client.id === selectedClientId);

  return <ModalShell title="Inchide oportunitatea" onClose={onClose}>
    <div className="grid gap-5">
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Rezultatul oportunitatii">
        <button className={`rounded-md border p-4 text-left ${outcome === "won" ? "border-emerald-400 bg-emerald-400/10" : "border-focus-line"}`} type="button" onClick={() => setOutcome("won")}>
          <span className="flex items-center gap-2 font-black text-white"><Check size={18} /> Castigata</span>
          <small className="mt-1 block text-slate-300">Leaga firma de un client existent sau creeaza clientul.</small>
        </button>
        <button className={`rounded-md border p-4 text-left ${outcome === "lost" ? "border-red-300 bg-red-300/10" : "border-focus-line"}`} type="button" onClick={() => setOutcome("lost")}>
          <span className="flex items-center gap-2 font-black text-white"><X size={18} /> Pierduta</span>
          <small className="mt-1 block text-slate-300">Pastreaza motivul pentru analiza comerciala.</small>
        </button>
      </div>

      {outcome === "won" ? <section className="grid gap-3">
        <div className="rounded-md border border-focus-line bg-focus-ink/55 p-4">
          <p className="text-xs font-black uppercase text-focus-yellow">Firma</p>
          <p className="mt-2 font-black text-white">{lead.companyName}</p>
          <p className="mt-1 text-xs text-slate-400">Nu se creeaza rezervare, HOLD, campanie sau document financiar.</p>
        </div>
        {lead.clientId ? <p className="rounded-md border border-emerald-400/40 bg-emerald-400/10 p-3 text-sm font-bold text-emerald-100">Client existent asociat: {lead.client?.companyName}</p> : null}
        {!lead.clientId && clients.length ? <div className="grid gap-2">
          <p className="text-xs font-black uppercase text-slate-400">Clienti existenti similari</p>
          {clients.map((client) => <label className="flex cursor-pointer items-center gap-3 rounded-md border border-focus-line px-3 py-3" key={client.id}>
            <input type="radio" name="crm-client" checked={selectedClientId === client.id} onChange={() => setSelectedClientId(client.id)} />
            <span><strong className="text-white">{client.companyName}</strong><small className="block text-slate-400">Owner: {client.accountOwner?.name || "nesetat"}</small></span>
          </label>)}
          <label className="flex cursor-pointer items-center gap-3 rounded-md border border-focus-line px-3 py-3">
            <input type="radio" name="crm-client" checked={!selectedClientId} onChange={() => setSelectedClientId("")} />
            <span><strong className="text-white">Niciunul dintre acestia</strong><small className="block text-slate-400">Creeaza client nou numai daca firma este diferita.</small></span>
          </label>
        </div> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-focus-line pt-4">
          <button className="focus-button secondary" type="button" disabled={pending} onClick={onClose}>Renunta</button>
          <button className="focus-button" type="button" disabled={pending} onClick={() => void onWon(selectedClientId || null)}><UserPlus size={17} /> {pending ? "Se salveaza..." : lead.clientId || selectedClient ? "Leaga si marcheaza castigata" : "Creeaza client si marcheaza castigata"}</button>
        </div>
      </section> : <section className="grid gap-3">
        <Field label="Categorie pierdere"><select className="focus-input" value={lostReasonCode} onChange={(event) => setLostReasonCode(event.target.value)}><option value="">Alege motivul</option>{CRM_LOST_REASON_OPTIONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select></Field>
        <Field label="De ce s-a pierdut"><textarea className="focus-input min-h-24" value={lostReason} onChange={(event) => setLostReason(event.target.value)} placeholder="Context scurt si util pentru urmatoarea discutie." /></Field>
        <div className="flex flex-wrap justify-end gap-2 border-t border-focus-line pt-4">
          <button className="focus-button secondary" type="button" disabled={pending} onClick={onClose}>Renunta</button>
          <button className="focus-button" type="button" disabled={!lossReady || pending} onClick={() => void onLost(lostReasonCode, lostReason.trim())}>{pending ? "Se salveaza..." : "Marcheaza pierduta"}</button>
        </div>
      </section>}
    </div>
  </ModalShell>;
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/70 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className="my-4 min-w-0 w-full max-w-4xl overflow-hidden rounded-lg border border-white/10 bg-focus-navy shadow-2xl sm:my-8">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[.025] px-5 py-4">
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

function Metric({ label, value, icon, tone = "neutral", hint }: { label: string; value: string | number; icon: React.ReactNode; tone?: "neutral" | "green" | "yellow" | "red"; hint?: string }) {
  const toneClass = { neutral: "text-white", green: "text-emerald-200", yellow: "text-focus-yellow", red: "text-red-100" }[tone];
  return <article className="min-h-32 rounded-lg border border-white/10 bg-focus-ink/65 p-4 shadow-[0_12px_30px_rgba(0,0,0,.12)]">
    <div className="flex items-center justify-between gap-3 text-slate-400"><p className="text-[11px] font-black uppercase">{label}</p>{icon}</div>
    <p className={`mt-4 break-words text-xl font-black ${toneClass}`}>{value}</p>
    {hint ? <p className="mt-2 text-[11px] leading-4 text-slate-500">{hint}</p> : null}
  </article>;
}

function MiniMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "red" }) {
  return <div className="rounded-lg border border-white/10 bg-focus-ink/55 p-3 shadow-sm"><p className="text-[11px] font-black uppercase text-slate-400">{label}</p><p className={`mt-2 text-sm font-black ${tone === "red" ? "text-red-100" : "text-white"}`}>{value}</p></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid min-w-0 gap-1 text-xs font-black uppercase text-slate-400">{label}{children}</label>;
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

function PriorityBadge({ priority }: { priority: LeadSummary["priority"] }) {
  if (priority === "normal") return null;
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black uppercase ${priority === "urgent" ? "border-red-300/50 bg-red-400/10 text-red-100" : "border-focus-yellow/60 bg-focus-yellow/10 text-focus-yellow"}`}>
    {priority === "urgent" ? "Urgent" : "Prioritar"}
  </span>;
}

function Feedback({ tone, text, onClose }: { tone: "green" | "red"; text: string; onClose: () => void }) {
  return <div className={`flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm font-bold ${tone === "green" ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-red-300/30 bg-red-500/10 text-red-100"}`}><span>{text}</span><button type="button" onClick={onClose}><X size={16} /></button></div>;
}

function LoadingState() {
  return <section className="grid min-h-64 place-items-center border-y border-focus-line"><div className="text-center"><span className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-focus-line border-t-focus-yellow" /><p className="mt-3 text-sm font-bold text-slate-400">Se incarca agenda CRM...</p></div></section>;
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return <section className="grid min-h-64 place-items-center border-y border-focus-line py-10 text-center"><div><Users className="mx-auto h-10 w-10 text-focus-yellow" /><h2 className="mt-3 text-xl font-black text-white">CRM-ul este pregatit</h2><p className="mt-1 max-w-md text-sm text-slate-400">Creeaza prima oportunitate si stabileste urmatorul follow-up pentru a porni pipeline-ul.</p><button className="focus-button mx-auto mt-4" type="button" onClick={onCreate}><Plus size={17} /> Oportunitate noua</button></div></section>;
}

function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (page: number) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-focus-line pt-4"><p className="text-xs font-bold text-slate-400">{total} oportunitati / pagina {page} din {pages}</p><div className="flex gap-2"><button className="focus-button secondary" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}><ArrowLeft size={16} /> Inapoi</button><button className="focus-button secondary" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Inainte <ArrowRight size={16} /></button></div></div>;
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

function quickActionPayload(action: QuickActionKey, lead: Pick<LeadSummary, "status" | "locationsInterested">) {
  const common = {
    locations: lead.locationsInterested || null
  };
  if (action === "contacted") {
    return {
      ...common,
      actionType: "call_connected",
      details: "Contact comercial realizat.",
      nextStep: "Clarifica nevoia OOH, perioada si bugetul.",
      nextFollowUpDate: dateInputAfter(3),
      ...(lead.status === "cold" ? { status: "contacted" } : {})
    };
  }
  if (action === "no_answer") {
    return {
      ...common,
      actionType: "call_no_answer",
      details: "Apel efectuat, fara raspuns.",
      nextStep: "Revenire telefonica.",
      nextFollowUpDate: dateInputAfter(1)
    };
  }
  if (action === "email_sent") {
    return {
      ...common,
      actionType: "email_sent",
      details: "E-mail comercial trimis.",
      nextStep: "Verifica raspunsul clientului.",
      nextFollowUpDate: dateInputAfter(3),
      ...(lead.status === "cold" ? { status: "contacted" } : {})
    };
  }
  if (action === "qualified") {
    return {
      ...common,
      actionType: "qualification",
      details: "Oportunitate calificata comercial.",
      nextStep: "Colecteaza sau confirma brief-ul OOH.",
      nextFollowUpDate: dateInputAfter(3),
      ...(["cold", "contacted"].includes(lead.status) ? { status: "qualified" } : {})
    };
  }
  if (action === "brief_received") {
    return {
      ...common,
      actionType: "brief_received",
      details: "Brief OOH primit de la client.",
      nextStep: "Pregateste propunerea comerciala.",
      nextFollowUpDate: dateInputAfter(2),
      ...(["cold", "contacted", "qualified"].includes(lead.status) ? { status: "brief_received" } : {})
    };
  }
  if (action === "offer_sent") {
    return {
      ...common,
      actionType: "offer_sent",
      details: "Oferta comerciala a fost trimisa.",
      nextStep: "Confirma primirea si obtine feedback-ul clientului.",
      nextFollowUpDate: dateInputAfter(3),
      ...(["cold", "contacted", "qualified", "brief_received", "in_offer"].includes(lead.status) ? { status: "offer_sent" } : {})
    };
  }
  return {
    ...common,
    actionType: "follow_up",
    details: "Revenire comerciala reprogramata.",
    nextStep: "Reia discutia cu clientul.",
    nextFollowUpDate: dateInputAfter(7)
  };
}

function qualificationCompleted(data: CrmQualificationData) {
  return CRM_QUALIFICATION_ITEMS.filter((item) => data[item.key]).length;
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
  return dateInputAfter(0);
}

function tomorrowInput() {
  return dateInputAfter(1);
}

function dateInputAfter(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
