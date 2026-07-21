"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Building2, FileText, GitMerge, Plus, Save, Search, Upload, Users } from "lucide-react";
import type { AuthSession } from "@/lib/auth";
import type { AccountOwnerOption } from "@/lib/client-campaigns";
import type { CampaignListItem, ClientListItem, ClientOverview, FinanceSummary, WorkspaceDocument, WorkspacePage } from "@/lib/client-campaign-workspaces";
import type { CrmHandoffProposal } from "@/lib/crm-handoff-contract";
import { hasAnyPermission } from "@/lib/rbac";
import {
  Dialog, DocumentUploadDialog, DocumentsList, EmptyState, ErrorState, Feedback, Field, LoadingState,
  OwnerSelect, Pagination, Panel, SelectField, StatusBadge, Tabs, TextArea, WorkspaceHeader,
  dateLabel, emptyClientForm, moneyLabel, nullable, type ClientForm
} from "@/components/admin/client-campaigns/WorkspaceUi";

type Contact = { id: string; name: string; role: string | null; email: string | null; phone: string | null; isPrimary: boolean; notes: string | null };
type DetailTab = "overview" | "contacts" | "campaigns" | "documents" | "finance";
type SectionData = { contacts?: Contact[]; campaigns?: CampaignListItem[]; documents?: WorkspaceDocument[]; finance?: FinanceSummary };

export function ClientsWorkspace({ initialPage, initialClientId, handoffOpportunityId, initialPortfolioFinance = false, session, accountOwners }: { initialPage: WorkspacePage<ClientListItem>; initialClientId?: string | null; handoffOpportunityId?: string | null; initialPortfolioFinance?: boolean; session: AuthSession; accountOwners: AccountOwnerOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [page, setPage] = useState(initialPage);
  const [query, setQuery] = useState(initialPage.query);
  const [selectedId, setSelectedId] = useState(initialClientId || "");
  const [overview, setOverview] = useState<ClientOverview | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [sections, setSections] = useState<Record<string, SectionData>>({});
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingSection, setLoadingSection] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [cursorTrail, setCursorTrail] = useState<Array<string | null>>([null]);
  const [createOpen, setCreateOpen] = useState(false);
  const [clientForm, setClientForm] = useState<ClientForm>(emptyClientForm);
  const [contactForm, setContactForm] = useState({ name: "", role: "", email: "", phone: "", isPrimary: false, notes: "" });
  const [documentOpen, setDocumentOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [portfolioFinanceOpen, setPortfolioFinanceOpen] = useState(initialPortfolioFinance);
  const [portfolioFinance, setPortfolioFinance] = useState<FinanceSummary | null>(null);
  const [handoff, setHandoff] = useState<CrmHandoffProposal | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(Boolean(handoffOpportunityId));
  const initialQuery = useRef(initialPage.query);

  const canManageClients = hasAnyPermission(session.role, ["clients.manage", "clients.manage.own"]);
  const canConfirmHandoff = canManageClients && session.role !== "COO";
  const canUseExistingHandoffClient = Boolean(
    handoff?.existingClient
    && canConfirmHandoff
    && (["SALES_DIRECTOR", "SUPER_ADMIN"].includes(session.role) || handoff.existingClient.accountOwnerUserId === session.id)
  );
  const canChangeOwner = ["COO", "SALES_DIRECTOR", "SUPER_ADMIN"].includes(session.role);
  const canMerge = ["COO", "SUPER_ADMIN"].includes(session.role);
  const selectedSection = sections[selectedId] || {};

  useEffect(() => {
    if (initialQuery.current === query) { initialQuery.current = "__handled__"; return; }
    const timer = window.setTimeout(() => {
      setCursorTrail([null]);
      void loadPage(null, query);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!selectedId) { setOverview(null); return; }
    void loadOverview(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || tab === "overview") return;
    if (selectedSection[tab]) return;
    void loadSection(tab);
  }, [selectedId, tab]);

  useEffect(() => {
    if (!portfolioFinanceOpen || portfolioFinance) return;
    setLoadingSection(true);
    fetch("/api/admin/clients/finance", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Facturile nu au putut fi incarcate.");
        setPortfolioFinance(payload.finance);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Facturile nu au putut fi incarcate."))
      .finally(() => setLoadingSection(false));
  }, [portfolioFinanceOpen, portfolioFinance]);

  useEffect(() => {
    if (!handoffOpportunityId) return;
    let cancelled = false;
    setHandoffBusy(true);
    fetch(`/api/admin/crm/opportunities/${encodeURIComponent(handoffOpportunityId)}/handoff`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Predarea CRM nu a putut fi pregatita.");
        return payload.proposal as CrmHandoffProposal;
      })
      .then((proposal) => {
        if (cancelled) return;
        setHandoff(proposal);
        if (proposal.existingClient) {
          setSelectedId(proposal.existingClient.id);
          return;
        }
        if (!proposal.ready || !canConfirmHandoff) return;
        setClientForm({
          ...emptyClientForm,
          companyName: proposal.company.name,
          taxId: proposal.company.taxId || "",
          generalEmail: proposal.company.primaryContact?.email || "",
          generalPhone: proposal.company.primaryContact?.phone || "",
          website: proposal.company.website || "",
          accountOwnerUserId: proposal.owner?.id || ""
        });
        setCreateOpen(true);
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Predarea CRM nu a putut fi pregatita."); })
      .finally(() => { if (!cancelled) setHandoffBusy(false); });
    return () => { cancelled = true; };
  }, [canConfirmHandoff, handoffOpportunityId]);

  const updateUrl = (nextSelectedId: string, nextQuery = query) => {
    const params = new URLSearchParams();
    if (nextQuery) params.set("q", nextQuery);
    if (nextSelectedId) params.set("clientId", nextSelectedId);
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  };

  async function loadPage(cursor: string | null, search = query) {
    setLoadingList(true); setError("");
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (search.trim()) params.set("q", search.trim());
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/admin/clients?${params}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Lista clientilor nu a putut fi incarcata.");
      setPage(payload.page);
      updateUrl(selectedId, search);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Lista clientilor nu a putut fi incarcata."); }
    finally { setLoadingList(false); }
  }

  async function loadOverview(id: string) {
    setLoadingDetail(true); setError(""); setTab("overview"); setSections({});
    try {
      const response = await fetch(`/api/admin/clients/${id}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Clientul nu a putut fi incarcat.");
      setOverview(payload.client);
      setClientForm(formFromOverview(payload.client));
    } catch (cause) { setOverview(null); setError(cause instanceof Error ? cause.message : "Clientul nu a putut fi incarcat."); }
    finally { setLoadingDetail(false); }
  }

  async function loadSection(section: Exclude<DetailTab, "overview">, force = false) {
    if (!selectedId || (!force && sections[selectedId]?.[section])) return;
    setLoadingSection(true); setError("");
    try {
      const response = await fetch(`/api/admin/clients/${selectedId}/${section}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Sectiunea nu a putut fi incarcata.");
      const value = payload[section];
      setSections((current) => ({ ...current, [selectedId]: { ...(current[selectedId] || {}), [section]: value } }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sectiunea nu a putut fi incarcata."); }
    finally { setLoadingSection(false); }
  }

  async function saveClient(mode: "create" | "update") {
    setLoadingDetail(true); setError(""); setMessage("");
    try {
      const response = await fetch(mode === "create" ? "/api/admin/clients" : `/api/admin/clients/${selectedId}`, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...clientForm,
          taxId: nullable(clientForm.taxId), registryNumber: nullable(clientForm.registryNumber), billingAddress: nullable(clientForm.billingAddress),
          generalEmail: nullable(clientForm.generalEmail), generalPhone: nullable(clientForm.generalPhone), website: nullable(clientForm.website),
          accountOwnerUserId: nullable(clientForm.accountOwnerUserId), ownerChangeReason: nullable(clientForm.ownerChangeReason), notes: nullable(clientForm.notes)
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Clientul nu a putut fi salvat.");
      const id = payload.client.id as string;
      setMessage(mode === "create" ? "Clientul a fost creat." : "Clientul a fost actualizat.");
      setCreateOpen(false); setSelectedId(id); updateUrl(id); await loadPage(cursorTrail.at(-1) || null);
      await loadOverview(id);
      if (handoff?.ready && canConfirmHandoff) await continueHandoff(id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Clientul nu a putut fi salvat."); }
    finally { setLoadingDetail(false); }
  }

  async function continueHandoff(clientId: string) {
    if (!handoff || !handoffOpportunityId) return;
    setHandoffBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/crm/opportunities/${encodeURIComponent(handoffOpportunityId)}/handoff`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: handoff.version,
          targetType: "client_account",
          targetId: clientId,
          idempotencyKey: `crm-handoff-client-${handoffOpportunityId}-${clientId}`
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Predarea catre client nu a putut fi confirmata.");
      router.push(`/admin/campanii?create=1&clientId=${encodeURIComponent(clientId)}&crmOpportunityId=${encodeURIComponent(handoffOpportunityId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Predarea catre client nu a putut fi confirmata.");
    } finally { setHandoffBusy(false); }
  }

  async function addContact() {
    if (!selectedId) return;
    setLoadingSection(true); setError("");
    try {
      const response = await fetch(`/api/admin/clients/${selectedId}/contacts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...contactForm, role: nullable(contactForm.role), email: nullable(contactForm.email), phone: nullable(contactForm.phone), notes: nullable(contactForm.notes) }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Contactul nu a putut fi adaugat.");
      setContactForm({ name: "", role: "", email: "", phone: "", isPrimary: false, notes: "" });
      setMessage("Contactul a fost adaugat."); await loadSection("contacts", true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Contactul nu a putut fi adaugat."); }
    finally { setLoadingSection(false); }
  }

  const selectClient = (id: string) => { setPortfolioFinanceOpen(false); setSelectedId(id); setMessage(""); setError(""); updateUrl(id); };
  const nextPage = () => { if (!page.nextCursor) return; const next = page.nextCursor; setCursorTrail((current) => [...current, next]); void loadPage(next); };
  const previousPage = () => { if (cursorTrail.length <= 1) return; const nextTrail = cursorTrail.slice(0, -1); setCursorTrail(nextTrail); void loadPage(nextTrail.at(-1) || null); };

  return <main className="focus-container grid min-w-0 gap-5 py-6">
    <WorkspaceHeader eyebrow="Portofoliu comercial" title="Clienti" description="Lista rapida pentru verificare si deduplicare. Contactele, documentele, campaniile si soldurile se incarca numai cand deschizi dosarul." actions={<>{canManageClients ? <button className="focus-button" type="button" onClick={() => { setClientForm({ ...emptyClientForm, accountOwnerUserId: ["SALES_AGENT", "SALES_DIRECTOR"].includes(session.role) ? session.id : "" }); setCreateOpen(true); }}><Plus size={17} /> Client nou</button> : null}<button className="focus-button secondary" type="button" onClick={() => { setPortfolioFinanceOpen(true); setSelectedId(""); updateUrl("", query); router.replace(`${pathname}?tab=invoices${query ? `&q=${encodeURIComponent(query)}` : ""}`, { scroll: false }); }}><FileText size={16} /> Facturile mele</button><Link className="focus-button secondary" href="/admin/campanii">Campanii</Link></>} />
    {handoffBusy ? <Feedback tone="success">Verificam daca firma exista deja in portofoliu...</Feedback> : null}
    {handoff ? <Panel title="Predare explicita din CRM" action={handoff.ready && canUseExistingHandoffClient ? <button className="focus-button" type="button" disabled={handoffBusy} onClick={() => void continueHandoff(handoff.existingClient!.id)}><ArrowRight size={16} /> Continua cu campania</button> : undefined}>
      <p className="text-sm text-slate-300">Oportunitatea castigata nu creeaza automat date in portofoliu. {handoff.existingClient ? `Am identificat clientul ${handoff.existingClient.companyName}.` : "Verifica datele precompletate si salveaza clientul pentru a continua."}</p>
      {handoff.warnings.length ? <ul className="mt-2 grid gap-1 text-xs text-amber-200">{handoff.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
    </Panel> : null}
    {message ? <Feedback tone="success">{message}</Feedback> : null}
    {error ? <Feedback tone="error">{error}</Feedback> : null}
    {portfolioFinanceOpen ? <PortfolioFinancePanel finance={portfolioFinance} loading={loadingSection} onClose={() => { setPortfolioFinanceOpen(false); router.replace(pathname, { scroll: false }); }} /> : <section className="grid min-w-0 gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
      <Panel title={`Clienti (${page.total})`}>
        <label className="relative block"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><input className="focus-input w-full pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Companie sau CUI" /></label>
        <div className="mt-3 grid max-h-[calc(100vh-18rem)] gap-2 overflow-y-auto pr-1">
          {loadingList ? <LoadingState text="Actualizam lista..." /> : page.items.length ? page.items.map((client) => <button className={`rounded-lg border p-3 text-left ${selectedId === client.id ? "border-focus-yellow bg-focus-yellow/10" : "border-focus-line bg-focus-navy/30 hover:border-focus-yellow/50"}`} key={client.id} type="button" onClick={() => selectClient(client.id)}>
            <span className="block truncate font-black text-white">{client.companyName}</span><span className="mt-1 block text-xs text-slate-400">{client.accountOwnerName || "Fara responsabil"} / {client.campaignCount} campanii</span><span className="mt-2 flex items-center justify-between gap-2"><StatusBadge value={client.status} />{!client.canEdit && session.role === "SALES_AGENT" ? <span className="text-[11px] font-bold text-slate-500">Doar verificare</span> : null}</span>
          </button>) : <EmptyState>Nu exista clienti pentru cautarea curenta.</EmptyState>}
        </div>
        <Pagination total={page.total} showing={page.items.length} canPrevious={cursorTrail.length > 1} canNext={Boolean(page.nextCursor)} busy={loadingList} onPrevious={previousPage} onNext={nextPage} />
      </Panel>
      <div className="min-w-0">
        {!selectedId ? <EmptyState>Alege un client pentru a deschide dosarul.</EmptyState> : loadingDetail ? <Panel><LoadingState text="Deschidem dosarul clientului..." /></Panel> : overview ? <div className="grid min-w-0 gap-4">
          <Panel title={overview.companyName} action={<div className="flex flex-wrap gap-2">{canMerge ? <button className="focus-button secondary" type="button" onClick={() => setMergeOpen(true)}><GitMerge size={16} /> Combina</button> : null}<StatusBadge value={overview.status} /></div>}>
            <div className="mb-4 flex flex-wrap gap-3 text-xs text-slate-400"><span>Responsabil: <strong className="text-white">{overview.accountOwnerName || "Nesetat"}</strong></span><span>CUI: <strong className="text-white">{overview.taxId || "-"}</strong></span>{!overview.canViewSensitive ? <span className="font-bold text-focus-yellow">Vizibil doar pentru prevenirea duplicatelor</span> : null}</div>
            <Tabs value={tab} onChange={(value) => setTab(value as DetailTab)} items={[{ id: "overview", label: "Rezumat" }, { id: "contacts", label: "Contacte" }, { id: "campaigns", label: "Campanii" }, { id: "documents", label: "Documente" }, { id: "finance", label: "Financiar" }]} />
          </Panel>
          {tab === "overview" ? <ClientOverviewPanel overview={overview} form={clientForm} setForm={setClientForm} owners={accountOwners} canChangeOwner={canChangeOwner} busy={loadingDetail} onSave={() => saveClient("update")} /> : null}
          {tab !== "overview" && loadingSection ? <Panel><LoadingState /></Panel> : null}
          {tab === "contacts" && !loadingSection ? <ContactsPanel contacts={selectedSection.contacts || []} form={contactForm} setForm={setContactForm} canEdit={overview.canEdit} busy={loadingSection} onAdd={addContact} /> : null}
          {tab === "campaigns" && !loadingSection ? <CampaignsPanel campaigns={selectedSection.campaigns || []} clientId={overview.id} canEdit={overview.canEdit} /> : null}
          {tab === "documents" && !loadingSection ? <Panel title="Documente" action={overview.canEdit ? <button className="focus-button" type="button" onClick={() => setDocumentOpen(true)}><Upload size={16} /> Incarca</button> : null}><DocumentsList documents={selectedSection.documents || []} /></Panel> : null}
          {tab === "finance" && !loadingSection ? <FinancePanel finance={selectedSection.finance} clientId={overview.id} /> : null}
        </div> : <ErrorState text="Dosarul clientului nu este disponibil." onRetry={() => loadOverview(selectedId)} />}
      </div>
    </section>}
    {createOpen ? <Dialog title="Client nou" subtitle="Inregistrare in portofoliu" onClose={() => setCreateOpen(false)}><ClientEditor form={clientForm} setForm={setClientForm} owners={accountOwners} canChangeOwner={canChangeOwner} busy={loadingDetail} onSave={() => saveClient("create")} /></Dialog> : null}
    {documentOpen && overview ? <DocumentUploadDialog target={{ clientId: overview.id, label: overview.companyName }} onClose={() => setDocumentOpen(false)} onSaved={() => { setDocumentOpen(false); setMessage("Documentul a fost salvat."); void loadSection("documents", true); }} /> : null}
    {mergeOpen && overview ? <MergeDialog primary={overview} onClose={() => setMergeOpen(false)} onMerged={() => { setMergeOpen(false); setSelectedId(""); setOverview(null); setMessage("Clientii au fost combinati si operatiunea a fost auditata."); void loadPage(null); }} /> : null}
  </main>;
}

function ClientOverviewPanel({ overview, form, setForm, owners, canChangeOwner, busy, onSave }: { overview: ClientOverview; form: ClientForm; setForm: (form: ClientForm) => void; owners: AccountOwnerOption[]; canChangeOwner: boolean; busy: boolean; onSave: () => void }) {
  return <Panel title="Rezumat client" action={overview.canEdit ? <button className="focus-button" type="button" disabled={busy || form.companyName.trim().length < 2} onClick={onSave}><Save size={16} /> Salveaza</button> : null}>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><Field label="Companie" value={form.companyName} disabled={!overview.canEdit} onChange={(companyName) => setForm({ ...form, companyName })} /><SelectField label="Tip client" value={form.clientType} disabled={!overview.canEdit} onChange={(clientType) => setForm({ ...form, clientType })}><option value="direct_client">Client direct</option><option value="agency">Agentie</option></SelectField><Field label="CUI / CIF" value={form.taxId} disabled={!overview.canEdit} onChange={(taxId) => setForm({ ...form, taxId })} /><Field label="Registrul comertului" value={form.registryNumber} disabled={!overview.canEdit} onChange={(registryNumber) => setForm({ ...form, registryNumber })} /><SelectField label="Status" value={form.status} disabled={!overview.canEdit} onChange={(status) => setForm({ ...form, status })}><option value="prospect">Prospect</option><option value="active">Activ</option><option value="inactive">Inactiv</option><option value="archived">Arhivat</option></SelectField><OwnerSelect value={form.accountOwnerUserId} owners={owners} disabled={!overview.canEdit || !canChangeOwner} onChange={(accountOwnerUserId) => setForm({ ...form, accountOwnerUserId })} /><Field label="Email general" value={form.generalEmail} disabled={!overview.canEdit} onChange={(generalEmail) => setForm({ ...form, generalEmail })} /><Field label="Telefon general" value={form.generalPhone} disabled={!overview.canEdit} onChange={(generalPhone) => setForm({ ...form, generalPhone })} /><Field label="Website" value={form.website} disabled={!overview.canEdit} onChange={(website) => setForm({ ...form, website })} />{canChangeOwner ? <Field label="Motiv schimbare responsabil" value={form.ownerChangeReason} disabled={!overview.canEdit} onChange={(ownerChangeReason) => setForm({ ...form, ownerChangeReason })} /> : null}<div className="md:col-span-2 xl:col-span-3"><TextArea label="Adresa de facturare" value={form.billingAddress} disabled={!overview.canEdit} onChange={(billingAddress) => setForm({ ...form, billingAddress })} /></div><div className="md:col-span-2 xl:col-span-3"><TextArea label="Observatii" value={form.notes} disabled={!overview.canEdit} onChange={(notes) => setForm({ ...form, notes })} /></div></div>
    {!overview.canEdit ? <p className="mt-4 text-sm text-slate-400">Poti verifica existenta companiei, dar doar responsabilul ei poate modifica datele sensibile.</p> : null}
  </Panel>;
}

function ClientEditor({ form, setForm, owners, canChangeOwner, busy, onSave }: { form: ClientForm; setForm: (form: ClientForm) => void; owners: AccountOwnerOption[]; canChangeOwner: boolean; busy: boolean; onSave: () => void }) {
  return <><div className="grid gap-3 md:grid-cols-2"><Field label="Companie" value={form.companyName} onChange={(companyName) => setForm({ ...form, companyName })} /><Field label="CUI / CIF" value={form.taxId} onChange={(taxId) => setForm({ ...form, taxId })} /><SelectField label="Tip client" value={form.clientType} onChange={(clientType) => setForm({ ...form, clientType })}><option value="direct_client">Client direct</option><option value="agency">Agentie</option></SelectField><OwnerSelect value={form.accountOwnerUserId} owners={owners} disabled={!canChangeOwner} onChange={(accountOwnerUserId) => setForm({ ...form, accountOwnerUserId })} /><Field label="Email" value={form.generalEmail} onChange={(generalEmail) => setForm({ ...form, generalEmail })} /><Field label="Telefon" value={form.generalPhone} onChange={(generalPhone) => setForm({ ...form, generalPhone })} /></div><div className="mt-4 flex justify-end"><button className="focus-button" type="button" disabled={busy || form.companyName.trim().length < 2} onClick={onSave}><Save size={16} /> Creeaza client</button></div></>;
}

function ContactsPanel({ contacts, form, setForm, canEdit, busy, onAdd }: { contacts: Contact[]; form: { name: string; role: string; email: string; phone: string; isPrimary: boolean; notes: string }; setForm: (value: { name: string; role: string; email: string; phone: string; isPrimary: boolean; notes: string }) => void; canEdit: boolean; busy: boolean; onAdd: () => void }) {
  return <Panel title="Contacte"><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]"><div className="grid gap-2">{contacts.length ? contacts.map((contact) => <article className="rounded-lg border border-focus-line bg-focus-navy/30 p-3" key={contact.id}><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-white">{contact.name}</strong>{contact.isPrimary ? <StatusBadge value="Principal" /> : null}</div><p className="mt-1 text-sm text-slate-400">{contact.role || "Functie nespecificata"} / {contact.email || "fara email"} / {contact.phone || "fara telefon"}</p></article>) : <EmptyState>Nu exista contacte.</EmptyState>}</div>{canEdit ? <div className="rounded-lg border border-focus-line bg-focus-navy/25 p-4"><h3 className="mb-3 text-xs font-black uppercase text-focus-yellow">Contact nou</h3><div className="grid gap-3"><Field label="Nume" value={form.name} onChange={(name) => setForm({ ...form, name })} /><Field label="Functie" value={form.role} onChange={(role) => setForm({ ...form, role })} /><Field label="Email" value={form.email} onChange={(email) => setForm({ ...form, email })} /><Field label="Telefon" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} /><label className="flex items-center justify-between text-sm font-bold text-slate-200">Contact principal<input type="checkbox" checked={form.isPrimary} onChange={(event) => setForm({ ...form, isPrimary: event.target.checked })} /></label><button className="focus-button" type="button" disabled={busy || form.name.trim().length < 2} onClick={onAdd}><Plus size={16} /> Adauga</button></div></div> : null}</div></Panel>;
}

function CampaignsPanel({ campaigns, clientId, canEdit }: { campaigns: CampaignListItem[]; clientId: string; canEdit: boolean }) {
  return <Panel title="Campanii client" action={canEdit ? <Link className="focus-button" href={`/admin/campanii?clientId=${clientId}&create=1`}><Plus size={16} /> Campanie noua</Link> : null}><div className="grid gap-2">{campaigns.length ? campaigns.map((campaign) => <Link className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-focus-line bg-focus-navy/30 p-3 hover:border-focus-yellow/50" href={`/admin/campanii?campaignId=${campaign.id}`} key={campaign.id}><div><strong className="text-white">{campaign.campaignName}</strong><p className="text-xs text-slate-400">{dateLabel(campaign.startDate)} - {dateLabel(campaign.endDate)} / {campaign.reservationCount} locatii</p></div><StatusBadge value={campaign.status} /></Link>) : <EmptyState>Clientul nu are campanii vizibile.</EmptyState>}</div></Panel>;
}

function FinancePanel({ finance, clientId }: { finance?: FinanceSummary; clientId: string }) {
  if (!finance) return <Panel><EmptyState>Nu exista rezumat financiar.</EmptyState></Panel>;
  return <Panel title="Rezumat financiar" action={<Link className="focus-button secondary" href={`/admin/financiar/incasari?clientId=${clientId}`}>Facturi client</Link>}><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Sold RON" value={moneyLabel(finance.remainingRon, "RON")} /><Metric label="Sold EUR" value={moneyLabel(finance.remainingEur, "EUR")} /><Metric label="Restant RON" value={moneyLabel(finance.overdueRon, "RON")} /><Metric label="Restant EUR" value={moneyLabel(finance.overdueEur, "EUR")} /></div><div className="mt-4 grid gap-2">{finance.rows.slice(0, 12).map((row) => <article className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-focus-line p-3" key={row.id}><span><strong className="text-white">{row.invoiceNumber || "Factura fara numar"}</strong><small className="block text-slate-400">Scadenta {dateLabel(row.dueDate)}</small></span><span className="font-black text-white">{moneyLabel(row.remaining, row.currency)}</span></article>)}</div></Panel>;
}

function PortfolioFinancePanel({ finance, loading, onClose }: { finance: FinanceSummary | null; loading: boolean; onClose: () => void }) {
  if (loading && !finance) return <Panel><LoadingState text="Incarcam facturile portofoliului..." /></Panel>;
  if (!finance) return <Panel><EmptyState>Nu exista facturi vizibile in portofoliul tau.</EmptyState></Panel>;
  return <Panel title="Facturile clientilor mei" action={<button className="focus-button secondary" type="button" onClick={onClose}>Inapoi la clienti</button>}>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Sold RON" value={moneyLabel(finance.remainingRon, "RON")} /><Metric label="Sold EUR" value={moneyLabel(finance.remainingEur, "EUR")} /><Metric label="Restant RON" value={moneyLabel(finance.overdueRon, "RON")} /><Metric label="Restant EUR" value={moneyLabel(finance.overdueEur, "EUR")} /></div>
    <div className="mt-4 grid gap-2">{finance.rows.length ? finance.rows.map((row) => <article className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-focus-line bg-focus-navy/25 p-3" key={row.id}><span><strong className="text-white">{row.invoiceNumber || "Factura fara numar"}</strong><small className="block text-slate-400">Scadenta {dateLabel(row.dueDate)}</small></span><span className="font-black text-white">{moneyLabel(row.remaining, row.currency)}</span></article>) : <EmptyState>Nu exista facturi deschise.</EmptyState>}</div>
  </Panel>;
}

function Metric({ label, value }: { label: string; value: string }) { return <article className="rounded-lg border border-focus-line bg-focus-navy/30 p-3"><p className="text-xs font-black uppercase text-slate-400">{label}</p><p className="mt-1 text-xl font-black text-white">{value}</p></article>; }

function MergeDialog({ primary, onClose, onMerged }: { primary: ClientOverview; onClose: () => void; onMerged: () => void }) {
  const [query, setQuery] = useState(""); const [candidates, setCandidates] = useState<ClientListItem[]>([]); const [duplicateId, setDuplicateId] = useState(""); const [reason, setReason] = useState(""); const [preview, setPreview] = useState<any>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { if (query.trim().length < 2) { setCandidates([]); return; } const timer = window.setTimeout(async () => { const response = await fetch(`/api/admin/clients?q=${encodeURIComponent(query)}&limit=20`, { cache: "no-store" }); const payload = await response.json().catch(() => null); if (response.ok) setCandidates((payload?.clients || []).filter((item: ClientListItem) => item.id !== primary.id)); }, 300); return () => window.clearTimeout(timer); }, [query, primary.id]);
  async function previewMerge() { setBusy(true); setError(""); try { const response = await fetch(`/api/admin/clients/merge/preview?primaryClientId=${primary.id}&duplicateClientId=${duplicateId}`, { cache: "no-store" }); const payload = await response.json().catch(() => null); if (!response.ok) throw new Error(payload?.error || "Preview indisponibil."); setPreview(payload.preview); } catch (cause) { setError(cause instanceof Error ? cause.message : "Preview indisponibil."); } finally { setBusy(false); } }
  async function confirmMerge() { setBusy(true); setError(""); try { const response = await fetch("/api/admin/clients/merge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ primaryClientId: primary.id, duplicateClientId: duplicateId, reason: nullable(reason) }) }); const payload = await response.json().catch(() => null); if (!response.ok) throw new Error(payload?.error || "Merge-ul nu a reusit."); onMerged(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Merge-ul nu a reusit."); } finally { setBusy(false); } }
  return <Dialog title="Combina clienti" subtitle={`Principal: ${primary.companyName}`} onClose={onClose}><p className="mb-4 text-sm text-slate-400">Selecteaza duplicatul. Nicio modificare nu se face pana la confirmarea preview-ului.</p><div className="grid gap-3"><Field label="Cauta duplicat" value={query} onChange={setQuery} /><SelectField label="Client duplicat" value={duplicateId} onChange={(id) => { setDuplicateId(id); setPreview(null); }}><option value="">Alege</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.companyName}</option>)}</SelectField><TextArea label="Motiv" value={reason} onChange={setReason} />{preview ? <Feedback tone="info">Se muta: {preview.duplicate._count.contacts} contacte, {preview.duplicate._count.campaigns} campanii, {preview.duplicate._count.reservations} rezervari, {preview.duplicate._count.financialReceivables} facturi si {preview.duplicate._count.documents} documente.</Feedback> : null}{error ? <Feedback tone="error">{error}</Feedback> : null}<div className="flex justify-end gap-2">{!preview ? <button className="focus-button" type="button" disabled={busy || !duplicateId} onClick={previewMerge}>Verifica impactul</button> : <button className="focus-button" type="button" disabled={busy || !reason.trim()} onClick={confirmMerge}><GitMerge size={16} /> Confirma merge</button>}</div></div></Dialog>;
}

function formFromOverview(client: ClientOverview): ClientForm { return { companyName: client.companyName, clientType: client.clientType || "direct_client", taxId: client.taxId || "", registryNumber: client.registryNumber || "", billingAddress: client.billingAddress || "", generalEmail: client.generalEmail || "", generalPhone: client.generalPhone || "", website: client.website || "", status: client.status || "active", accountOwnerUserId: client.accountOwnerUserId || "", ownerChangeReason: "", notes: client.notes || "" }; }
