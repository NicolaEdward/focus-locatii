"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Archive, Plus, Save, Search, Upload, Wrench } from "lucide-react";
import type { AuthSession } from "@/lib/auth";
import type { AccountOwnerOption } from "@/lib/client-campaigns";
import type { CampaignDateFilter, CampaignListItem, CampaignOverview, ClientListItem, FinanceSummary, WorkspaceDocument, WorkspacePage } from "@/lib/client-campaign-workspaces";
import type { CrmHandoffProposal } from "@/lib/crm-handoff-contract";
import { hasAnyPermission } from "@/lib/rbac";
import { companyEntities } from "@/lib/company-entities";
import { CampaignPartyPicker } from "./CampaignPartyPicker";
import { useCommercialChoices } from "@/components/admin/use-commercial-choices";
import { bucharestDateKey, campaignEffectiveStatusLabel, type CampaignEffectiveStatus } from "@/lib/campaigns/campaign-effective-status";
import {
  Dialog, DocumentUploadDialog, DocumentsList, EmptyState, ErrorState, Feedback, Field, LoadingState,
  OwnerSelect, Pagination, Panel, SelectField, StatusBadge, Tabs, TextArea, WorkspaceHeader,
  dateLabel, emptyCampaignForm, moneyLabel, nullable, type CampaignForm
} from "@/components/admin/client-campaigns/WorkspaceUi";

type ReservationRow = { id: string; locationId: string; locationCode: string; locationName: string | null; city: string | null; status: string; periodStart: string; periodEnd: string; installationDate: string | null; neutralizationDate: string | null; monthlyRent: number; currency: string; productionNotes: string | null };
type DetailTab = "overview" | "reservations" | "documents" | "finance";
type SectionData = { reservations?: ReservationRow[]; documents?: WorkspaceDocument[]; finance?: FinanceSummary };
type ExecutiveCampaignContext = {
  entityCode: string | null;
  ownerUserId: string | null;
  snapshotDate: string | null;
  dateFilter: CampaignDateFilter | null;
};

export function CampaignsWorkspace({ initialPage, initialEffectiveStatus, initialCampaignId, initialClientId, handoffOpportunityId, openCreate, session, accountOwners, executiveContext }: { initialPage: WorkspacePage<CampaignListItem>; initialEffectiveStatus?: CampaignEffectiveStatus | null; initialCampaignId?: string | null; initialClientId?: string | null; handoffOpportunityId?: string | null; openCreate?: boolean; session: AuthSession; accountOwners: AccountOwnerOption[]; executiveContext?: ExecutiveCampaignContext }) {
  const router = useRouter(); const pathname = usePathname();
  const [page, setPage] = useState(initialPage); const [query, setQuery] = useState(initialPage.query);
  const [effectiveStatus, setEffectiveStatus] = useState<CampaignEffectiveStatus | "">(initialEffectiveStatus || "");
  const [selectedId, setSelectedId] = useState(initialCampaignId || ""); const [overview, setOverview] = useState<CampaignOverview | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview"); const [sections, setSections] = useState<Record<string, SectionData>>({});
  const [loadingList, setLoadingList] = useState(false); const [loadingDetail, setLoadingDetail] = useState(false); const [loadingSection, setLoadingSection] = useState(false);
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [cursorTrail, setCursorTrail] = useState<Array<string | null>>([null]);
  const [editorOpen, setEditorOpen] = useState(Boolean(openCreate)); const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CampaignForm>({ ...emptyCampaignForm, clientId: initialClientId || "", sellerUserId: ["SALES_AGENT", "SALES_DIRECTOR"].includes(session.role) ? session.id : "", accountOwnerUserId: ["SALES_AGENT", "SALES_DIRECTOR"].includes(session.role) ? session.id : "" });
  const [clientQuery, setClientQuery] = useState(""); const [clientOptions, setClientOptions] = useState<ClientListItem[]>([]);
  const [documentOpen, setDocumentOpen] = useState(false); const [operationTarget, setOperationTarget] = useState<ReservationRow | null>(null);
  const [handoff, setHandoff] = useState<CrmHandoffProposal | null>(null); const [handoffBusy, setHandoffBusy] = useState(Boolean(handoffOpportunityId));
  const initialQuery = useRef(initialPage.query);
  const canManage = hasAnyPermission(session.role, ["campaigns.manage", "reservations.manage", "reservations.manage.own"]);
  const canConfirmHandoff = canManage && session.role !== "COO";
  const canChangeOwner = ["COO", "SALES_DIRECTOR", "SUPER_ADMIN"].includes(session.role);
  const selectedSection = sections[selectedId] || {};

  useEffect(() => { if (initialQuery.current === query) { initialQuery.current = "__handled__"; return; } const timer = window.setTimeout(() => { setCursorTrail([null]); void loadPage(null, query); }, 350); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => { if (!selectedId) { setOverview(null); return; } void loadOverview(selectedId); }, [selectedId]);
  useEffect(() => { if (!selectedId || tab === "overview" || selectedSection[tab]) return; void loadSection(tab); }, [selectedId, tab]);
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
        if (proposal.existingCampaign) {
          setSelectedId(proposal.existingCampaign.id);
          setEditorOpen(false);
          setMessage("Campania exista deja. Am deschis dosarul existent fara a crea un duplicat.");
          return;
        }
        if (!proposal.ready || !canConfirmHandoff) return;
        const clientId = proposal.existingClient?.id || initialClientId || "";
        setForm({
          ...emptyCampaignForm,
          clientId,
          campaignName: proposal.campaign.name,
          sellerUserId: proposal.owner?.id || "",
          accountOwnerUserId: proposal.owner?.id || ""
        });
        setClientQuery(proposal.existingClient?.companyName || proposal.company.name);
        if (proposal.existingClient) setClientOptions([{ id: proposal.existingClient.id, companyName: proposal.existingClient.companyName } as ClientListItem]);
        setEditing(false);
        setEditorOpen(true);
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Predarea CRM nu a putut fi pregatita."); })
      .finally(() => { if (!cancelled) setHandoffBusy(false); });
    return () => { cancelled = true; };
  }, [canConfirmHandoff, handoffOpportunityId, initialClientId]);

  function updateUrl(nextId: string, nextQuery = query, nextStatus: CampaignEffectiveStatus | "" = effectiveStatus) { const params = executiveCampaignParams(executiveContext); if (nextQuery) params.set("q", nextQuery); if (nextStatus) params.set("effectiveStatus", nextStatus); if (nextId) params.set("campaignId", nextId); router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }); }

  async function loadPage(cursor: string | null, search = query, statusFilter: CampaignEffectiveStatus | "" = effectiveStatus) { setLoadingList(true); setError(""); try { const params = executiveCampaignParams(executiveContext); params.set("limit", "30"); if (search.trim()) params.set("q", search.trim()); if (statusFilter) params.set("effectiveStatus", statusFilter); if (cursor) params.set("cursor", cursor); const response = await fetch(`/api/admin/campaigns?${params}`, { cache: "no-store" }); const payload = await response.json().catch(() => null); if (!response.ok) throw new Error(payload?.error || "Lista campaniilor nu a putut fi incarcata."); setPage(payload.page); updateUrl(selectedId, search, statusFilter); } catch (cause) { setError(cause instanceof Error ? cause.message : "Lista campaniilor nu a putut fi incarcata."); } finally { setLoadingList(false); } }
  async function loadOverview(id: string) { setLoadingDetail(true); setError(""); setTab("overview"); setSections({}); try { const response = await fetch(`/api/admin/campaigns/${id}`, { cache: "no-store" }); const payload = await response.json().catch(() => null); if (!response.ok) throw new Error(payload?.error || "Campania nu a putut fi incarcata."); setOverview(payload.campaign); setForm(formFromOverview(payload.campaign)); } catch (cause) { setOverview(null); setError(cause instanceof Error ? cause.message : "Campania nu a putut fi incarcata."); } finally { setLoadingDetail(false); } }
  async function loadSection(section: Exclude<DetailTab, "overview">, force = false) { if (!selectedId || (!force && sections[selectedId]?.[section])) return; setLoadingSection(true); setError(""); try { const response = await fetch(`/api/admin/campaigns/${selectedId}/${section}`, { cache: "no-store" }); const payload = await response.json().catch(() => null); if (!response.ok) throw new Error(payload?.error || "Sectiunea nu a putut fi incarcata."); setSections((current) => ({ ...current, [selectedId]: { ...(current[selectedId] || {}), [section]: payload[section] } })); } catch (cause) { setError(cause instanceof Error ? cause.message : "Sectiunea nu a putut fi incarcata."); } finally { setLoadingSection(false); } }

  async function saveCampaign() { setLoadingDetail(true); setError(""); setMessage(""); try { const wasEditing = editing; const response = await fetch(wasEditing && selectedId ? `/api/admin/campaigns/${selectedId}` : "/api/admin/campaigns", { method: wasEditing && selectedId ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, currency: form.currency || undefined, campaignCode: nullable(form.campaignCode), campaignType: !wasEditing || form.campaignType !== overview?.campaignType ? form.campaignType : undefined, agencyClientId: !wasEditing || form.campaignType !== overview?.campaignType || form.agencyClientId !== (overview?.agencyClientId || "") ? nullable(form.agencyClientId) : undefined, endClientId: !wasEditing || form.campaignType !== overview?.campaignType || form.endClientId !== (overview?.endClientId || "") ? nullable(form.endClientId) : undefined, sellerUserId: nullable(form.sellerUserId), accountOwnerUserId: nullable(form.accountOwnerUserId), paymentTermDays: form.paymentTermDays ? Number(form.paymentTermDays) : null, notes: nullable(form.notes) }) }); const payload = await response.json().catch(() => null); if (!response.ok) throw new Error(payload?.error || "Campania nu a putut fi salvata."); const id = payload.campaign.id as string; setEditorOpen(false); setEditing(false); setSelectedId(id); updateUrl(id); setMessage(wasEditing ? "Campania a fost actualizata." : "Campania a fost creata."); await loadPage(cursorTrail.at(-1) || null); await loadOverview(id); if (!wasEditing && handoff?.ready && canConfirmHandoff) await confirmCampaignHandoff(id); } catch (cause) { setError(cause instanceof Error ? cause.message : "Campania nu a putut fi salvata."); } finally { setLoadingDetail(false); } }
  async function confirmCampaignHandoff(campaignId: string) { if (!handoff || !handoffOpportunityId) return; setHandoffBusy(true); try { const response = await fetch(`/api/admin/crm/opportunities/${encodeURIComponent(handoffOpportunityId)}/handoff`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: handoff.version, targetType: "campaign", targetId: campaignId, idempotencyKey: `crm-handoff-campaign-${handoffOpportunityId}-${campaignId}` }) }); const payload = await response.json().catch(() => null); if (!response.ok) { setError(`Campania este salvata, dar legatura CRM necesita reincercare: ${payload?.error || "eroare de audit"}`); return; } setMessage("Campania a fost confirmata explicit si legatura cu oportunitatea a fost auditata."); } catch (cause) { setError(`Campania este salvata, dar legatura CRM necesita reincercare: ${cause instanceof Error ? cause.message : "eroare de retea"}`); } finally { setHandoffBusy(false); } }
  async function archiveCampaign() { if (!selectedId || !overview) return; setLoadingDetail(true); setError(""); try { const response = await fetch(`/api/admin/campaigns/${selectedId}`, { method: "DELETE" }); const payload = await response.json().catch(() => null); if (!response.ok) throw new Error(payload?.error || "Campania nu a putut fi arhivata."); setSelectedId(""); setOverview(null); updateUrl(""); setMessage("Campania a fost arhivata."); await loadPage(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Campania nu a putut fi arhivata."); } finally { setLoadingDetail(false); } }

  function openCreateEditor() { setError(""); setEditing(false); setForm({ ...emptyCampaignForm, clientId: initialClientId || "", sellerUserId: ["SALES_AGENT", "SALES_DIRECTOR"].includes(session.role) ? session.id : "", accountOwnerUserId: ["SALES_AGENT", "SALES_DIRECTOR"].includes(session.role) ? session.id : "" }); setClientQuery(""); setEditorOpen(true); }
  function openEditEditor() { if (!overview) return; setError(""); setEditing(true); setForm(formFromOverview(overview)); setClientQuery(overview.clientName); setClientOptions([{ id: overview.clientId, companyName: overview.clientName } as ClientListItem]); setEditorOpen(true); }
  const nextPage = () => { if (!page.nextCursor) return; const next = page.nextCursor; setCursorTrail((current) => [...current, next]); void loadPage(next); };
  const previousPage = () => { if (cursorTrail.length <= 1) return; const trail = cursorTrail.slice(0, -1); setCursorTrail(trail); void loadPage(trail.at(-1) || null); };

  return <main className="focus-container grid min-w-0 gap-5 py-6">
    <WorkspaceHeader eyebrow="Portofoliu comercial" title="Campanii" description="Campaniile au propria lista si propriul dosar. Inchirierile, documentele si situatia financiara se incarca numai cand deschizi sectiunea respectiva." actions={<>{canManage ? <button className="focus-button" type="button" onClick={openCreateEditor}><Plus size={17} /> Campanie noua</button> : null}<Link className="focus-button secondary" href="/admin/clienti">Clienti</Link></>} />
    {executiveContext?.snapshotDate || executiveContext?.entityCode || executiveContext?.ownerUserId || executiveContext?.dateFilter ? (
      <div className="rounded-md border border-focus-yellow/30 bg-focus-yellow/5 px-3 py-2 text-xs text-slate-300">
        Filtru executiv aplicat:
        {executiveContext.entityCode ? ` entitate ${executiveContext.entityCode}` : " toate entitatile"}
        {executiveContext.ownerUserId ? " · portofoliul responsabilului selectat" : ""}
        {executiveContext.snapshotDate ? ` · snapshot ${executiveContext.snapshotDate}` : ""}
        {executiveContext.dateFilter === "STARTS_ON" ? " · campanii care incep la snapshot" : ""}
        {executiveContext.dateFilter === "ENDS_ON" ? " · campanii care se incheie la snapshot" : ""}
        {executiveContext.dateFilter === "STARTS_WITHIN_7_DAYS" ? " · campanii care incep in urmatoarele 7 zile" : ""}
        {executiveContext.dateFilter === "ENDS_WITHIN_7_DAYS" ? " · campanii care se incheie in urmatoarele 7 zile" : ""}
      </div>
    ) : null}
    {handoffBusy ? <Feedback tone="success">Pregatim datele oportunitatii castigate...</Feedback> : null}
    {handoff ? <Panel title="Predare explicita din CRM" action={handoff.ready && handoff.existingCampaign && canConfirmHandoff ? <button className="focus-button" type="button" disabled={handoffBusy} onClick={() => void confirmCampaignHandoff(handoff.existingCampaign!.id)}><Save size={16} /> Confirma campania existenta</button> : undefined}><p className="text-sm text-slate-300">Campania nu este creata automat. {handoff.existingCampaign ? `Am identificat campania ${handoff.existingCampaign.campaignName}; confirma asocierea fara a crea un duplicat.` : "Verifica clientul si responsabilul, apoi salveaza explicit. Perioada si valoarea din oportunitate raman context comercial; campania le calculeaza din locatiile BOOKED."}</p>{handoff.warnings.length ? <ul className="mt-2 grid gap-1 text-xs text-amber-200">{handoff.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}</Panel> : null}
    {message ? <Feedback tone="success">{message}</Feedback> : null}{error ? <Feedback tone="error">{error}</Feedback> : null}
    <section className="grid min-w-0 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Panel title={`Campanii (${page.total})`}><div className="grid gap-2"><label className="relative block"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><input className="focus-input w-full pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Campanie, client sau cod" /></label><select className="focus-input w-full" aria-label="Filtreaza dupa statusul efectiv" value={effectiveStatus} onChange={(event) => { const value = event.target.value as CampaignEffectiveStatus | ""; setEffectiveStatus(value); setCursorTrail([null]); void loadPage(null, query, value); }}><option value="">Toate statusurile</option>{(["ACTIVE", "SCHEDULED", "ENDED", "DRAFT", "INCOMPLETE", "CANCELLED"] as CampaignEffectiveStatus[]).map((status) => <option key={status} value={status}>{campaignEffectiveStatusLabel(status)}</option>)}</select></div><div className="mt-3 grid max-h-[calc(100vh-18rem)] gap-2 overflow-y-auto pr-1">{loadingList ? <LoadingState text="Actualizam lista..." /> : page.items.length ? page.items.map((campaign) => <button className={`rounded-lg border p-3 text-left ${selectedId === campaign.id ? "border-focus-yellow bg-focus-yellow/10" : "border-focus-line bg-focus-navy/30 hover:border-focus-yellow/50"}`} key={campaign.id} type="button" onClick={() => { setSelectedId(campaign.id); updateUrl(campaign.id); setError(""); setMessage(""); }}><span className="block truncate font-black text-white">{campaign.campaignName}</span><span className="mt-1 block truncate text-xs text-slate-400">{campaign.clientName} / {campaign.sellerName || "Fara agent"}</span><span className="mt-2 flex items-center justify-between gap-2"><StatusBadge value={campaign.effectiveStatus} /><span className="text-xs font-black text-white">{campaignCommercialValueLabel(campaign)}</span></span></button>) : <EmptyState>Nu exista campanii pentru cautarea curenta.</EmptyState>}</div><Pagination total={page.total} showing={page.items.length} canPrevious={cursorTrail.length > 1} canNext={Boolean(page.nextCursor)} busy={loadingList} onPrevious={previousPage} onNext={nextPage} /></Panel>
      <div className="min-w-0">{!selectedId ? <EmptyState>Alege o campanie pentru a deschide dosarul.</EmptyState> : loadingDetail ? <Panel><LoadingState text="Deschidem dosarul campaniei..." /></Panel> : overview ? <div className="grid min-w-0 gap-4"><Panel title={overview.campaignName} action={<div className="flex flex-wrap gap-2">{overview.canEdit ? <button className="focus-button secondary" type="button" onClick={openEditEditor}><Save size={16} /> Editeaza</button> : null}<StatusBadge value={overview.effectiveStatus} /></div>}><div className="mb-4 flex flex-wrap gap-3 text-xs text-slate-400"><span>Client contractual / facturat: <strong className="text-white">{overview.clientName}</strong></span>{overview.campaignType === "agency" ? <><span>Agenție: <strong className="text-white">{overview.agencyClientName || "De verificat"}</strong></span><span>Beneficiar final: <strong className="text-white">{overview.endClientName || "De completat"}</strong></span></> : null}<span>Agent: <strong className="text-white">{overview.sellerName || "Nesetat"}</strong></span><span>Perioada din locatiile BOOKED: <strong className="text-white">{dateLabel(overview.startDate)} - {dateLabel(overview.endDate)}</strong></span></div>{overview.relationshipDataQualityReasons.length ? <p role="status" className="mb-3 rounded-md border border-amber-300/40 bg-amber-400/10 p-3 text-sm text-amber-100">Părțile comerciale necesită verificare: agenția ori beneficiarul final lipsesc sau nu sunt disponibile în portofoliul autorizat. Verifică dosarul înainte de o închiriere nouă.</p> : null}<Tabs value={tab} onChange={(value) => setTab(value as DetailTab)} items={[{ id: "overview", label: "Rezumat" }, { id: "reservations", label: "Locatii inchiriate" }, { id: "documents", label: "Documente" }, { id: "finance", label: "Financiar" }]} /></Panel>{tab === "overview" ? <OverviewPanel campaign={overview} onArchive={archiveCampaign} busy={loadingDetail} /> : null}{tab !== "overview" && loadingSection ? <Panel><LoadingState /></Panel> : null}{tab === "reservations" && !loadingSection ? <ReservationsPanel rows={selectedSection.reservations || []} canEdit={overview.canEdit} onOperation={setOperationTarget} /> : null}{tab === "documents" && !loadingSection ? <Panel title="Documente campanie" action={overview.canEdit ? <button className="focus-button" type="button" onClick={() => setDocumentOpen(true)}><Upload size={16} /> Incarca</button> : null}><DocumentsList documents={selectedSection.documents || []} /></Panel> : null}{tab === "finance" && !loadingSection ? <FinancePanel finance={selectedSection.finance} campaignId={overview.id} /> : null}</div> : <ErrorState text="Dosarul campaniei nu este disponibil." onRetry={() => loadOverview(selectedId)} />}</div>
    </section>
    {editorOpen ? <CampaignEditorDialog form={form} setForm={setForm} owners={accountOwners} clients={clientOptions} clientQuery={clientQuery} setClientQuery={setClientQuery} canChangeOwner={canChangeOwner} editing={editing} error={error} busy={loadingDetail} onClose={() => setEditorOpen(false)} onSave={saveCampaign} /> : null}
    {documentOpen && overview ? <DocumentUploadDialog target={{ clientId: overview.clientId, campaignId: overview.id, label: `${overview.campaignName} / ${overview.clientName}` }} onClose={() => setDocumentOpen(false)} onSaved={() => { setDocumentOpen(false); setMessage("Documentul a fost salvat."); void loadSection("documents", true); }} /> : null}
    {operationTarget ? <OperationDialog reservation={operationTarget} onClose={() => setOperationTarget(null)} onSaved={() => { setOperationTarget(null); setMessage("Redecorarea a fost trimisa in operational."); }} /> : null}
  </main>;
}

function OverviewPanel({ campaign, onArchive, busy }: { campaign: CampaignOverview; onArchive: () => void; busy: boolean }) { return <Panel title="Rezumat comercial" action={campaign.canEdit ? <button className="focus-button secondary" type="button" disabled={busy} onClick={onArchive}><Archive size={16} /> Arhiveaza</button> : null}><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Valoare pro-rata" value={campaignCommercialValueLabel(campaign)} /><Metric label="Perioada calculata" value={campaign.bookedReservationCount ? `${dateLabel(campaign.startDate)} - ${dateLabel(campaign.endDate)}` : "Dupa prima locatie BOOKED"} /><Metric label="Termen plata" value={campaign.paymentTermDays != null ? `${campaign.paymentTermDays} zile` : "Nesetat"} /><Metric label="Entitate" value={campaign.companyEntity || "Nesetata"} /></div><p className="mt-3 text-xs text-slate-400">Perioada si valoarea sunt calculate automat din {campaign.bookedReservationCount} {campaign.bookedReservationCount === 1 ? "locatie" : "locatii"} BOOKED, folosind chiria lunara si pro-rata pe zile.</p>{campaign.commercialDataQualityReasons.length ? <p className="mt-2 text-xs font-bold text-amber-200">Verificare necesara: {campaign.commercialDataQualityReasons.map(campaignCommercialDataQualityLabel).join(" ")}</p> : null}{campaign.notes ? <p className="mt-4 rounded-lg border border-focus-line bg-focus-navy/25 p-3 text-sm text-slate-300">{campaign.notes}</p> : null}</Panel>; }

function ReservationsPanel({ rows, canEdit, onOperation }: { rows: ReservationRow[]; canEdit: boolean; onOperation: (row: ReservationRow) => void }) { return <Panel title="Locatii inchiriate"><div className="grid gap-2">{rows.length ? rows.map((row) => <article className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-focus-line bg-focus-navy/30 p-3" key={row.id}><div><strong className="text-white">{row.locationCode}</strong><p className="text-xs text-slate-400">{row.city || row.locationName || "-"} / {dateLabel(row.periodStart)} - {dateLabel(row.periodEnd)}</p></div><div className="flex flex-wrap items-center gap-2"><StatusBadge value={row.status} /><Link className="focus-button secondary" href={`/admin/locatii?reservationId=${row.id}`}>Detalii</Link>{canEdit && row.status === "BOOKED" ? <button className="focus-button secondary" type="button" onClick={() => onOperation(row)}><Wrench size={15} /> Redecorare</button> : null}</div></article>) : <EmptyState>Campania nu are inchirieri.</EmptyState>}</div></Panel>; }

function FinancePanel({ finance, campaignId }: { finance?: FinanceSummary; campaignId: string }) {
  if (!finance) return <Panel><EmptyState>Nu există rezumat financiar.</EmptyState></Panel>;
  const quality = finance as FinanceSummary & { source?: string; dataQualityReasons?: string[]; unattributedInvoiceCount?: number; unknownCurrencyCount?: number };
  const qualityLabels: Record<string, string> = {
    UNKNOWN_INVOICE_CURRENCY: "Există documente cu monedă nevalidată; nu sunt însumate automat în RON sau EUR.",
    CAMPAIGN_INVOICE_ALLOCATION_MISSING: "Unele facturi nu au o alocare explicită pe campanie.",
    CAMPAIGN_RECEIPTS_NOT_ATTRIBUTABLE: "Încasările și soldul facturilor comune nu pot fi atribuite acestei campanii fără o alocare verificată.",
    CAMPAIGN_INVOICE_ALLOCATION_INVALID: "O alocare necesită verificare după storno sau revizuirea facturii.",
    FISCAL_DATA_UNVERIFIED: "Baza și TVA nu sunt încă susținute de date fiscale verificate.",
  };
  return <Panel title="Rezumat financiar" action={<Link className="focus-button secondary" href={`/admin/financiar/incasari?campaignId=${campaignId}`}>Facturi campanie</Link>}>
    {quality.dataQualityReasons?.length ? <div role="status" className="mb-4 rounded-lg border border-amber-300/40 bg-amber-400/10 p-3 text-sm text-amber-100"><strong>Raportul necesită verificare</strong><ul className="mt-2 grid gap-1">{quality.dataQualityReasons.map((reason) => <li key={reason}>{qualityLabels[reason] || "O parte din datele financiare nu poate fi verificată încă."}</li>)}</ul><Link className="mt-2 inline-block underline" href={`/admin/financiar/alocari?campaignId=${campaignId}`}>Verifică alocările facturilor</Link></div> : null}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Facturat alocat RON" value={moneyLabel(finance.invoicedRon, "RON")} /><Metric label="Facturat alocat EUR" value={moneyLabel(finance.invoicedEur, "EUR")} /><Metric label="Sold atribuibil RON" value={moneyLabel(finance.remainingRon, "RON")} /><Metric label="Sold atribuibil EUR" value={moneyLabel(finance.remainingEur, "EUR")} /></div>
    <div className="mt-4 grid gap-2">{finance.rows.slice(0, 12).map((row) => <article className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-focus-line p-3" key={row.id}><span><strong className="text-white">{row.invoiceNumber || "Factură fără număr"}</strong><small className="block text-slate-400">Scadență {dateLabel(row.dueDate)}</small></span><span className="font-black text-white">{moneyLabel(row.remaining, row.currency)}</span></article>)}</div>
  </Panel>;
}

function CampaignEditorDialog({ form, setForm, owners, clients, clientQuery, setClientQuery, canChangeOwner, editing, error, busy, onClose, onSave }: { form: CampaignForm; setForm: (value: CampaignForm) => void; owners: AccountOwnerOption[]; clients: ClientListItem[]; clientQuery: string; setClientQuery: (value: string) => void; canChangeOwner: boolean; editing: boolean; error: string; busy: boolean; onClose: () => void; onSave: () => void }) {
  const [clientPage, setClientPage] = useState(1);
  const clientChoices = useCommercialChoices("clients", clients, form.clientId, clientQuery, clientPage);
  const agencyIncomplete = form.campaignType === "agency" && (!form.agencyClientId || !form.endClientId);
  return <Dialog title={editing ? "Editeaza campanie" : "Campanie noua"} subtitle="Date comerciale" onClose={onClose}>
    <div className="grid gap-3 md:grid-cols-2">
      <SelectField label="Tip relație comercială" value={form.campaignType} onChange={(campaignType) => setForm({ ...form, campaignType, ...(campaignType === "direct_client" ? { agencyClientId: "", endClientId: "" } : {}) })}><option value="direct_client">Client direct</option><option value="agency">Prin agenție</option></SelectField>
      <div className="rounded-md border border-focus-line p-3 text-xs text-slate-300">Clientul selectat mai jos este partea contractuală și clientul facturat. Agenția și beneficiarul final sunt roluri distincte; alegerea lor nu schimbă automat partea facturată.</div>
      <Field label="Cauta client" value={clientQuery} onChange={(value) => { setClientQuery(value); setClientPage(1); }} placeholder="Nume sau cod fiscal" />
      <SelectField label="Client" value={form.clientId} onChange={(clientId) => setForm({ ...form, clientId })}><option value="">Alege clientul contractual / facturat</option>{clientChoices.rows.map((client) => <option key={client.id} value={client.id}>{client.companyName}</option>)}</SelectField>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 md:col-span-2">
        {clientChoices.error ? <span role="alert" className="text-rose-200">{clientChoices.error}</span> : clientChoices.loading ? <span role="status">Se caută clienții...</span> : clientChoices.page ? <span>{clientChoices.page.total} clienți · pagina {clientChoices.page.page}/{clientChoices.page.totalPages}</span> : null}
        {clientChoices.page && clientChoices.page.totalPages > 1 ? <><button type="button" className="focus-button secondary" aria-label="Pagina precedentă de clienți contractuali" disabled={clientChoices.loading || clientChoices.page.page <= 1} onClick={() => setClientPage(clientPage - 1)}>Înapoi</button><button type="button" className="focus-button secondary" aria-label="Pagina următoare de clienți contractuali" disabled={clientChoices.loading || clientChoices.page.page >= clientChoices.page.totalPages} onClick={() => setClientPage(clientPage + 1)}>Înainte</button></> : null}
      </div>
      {form.campaignType === "agency" ? <>
        <div className="grid min-w-0 gap-2"><button type="button" className="focus-button secondary" disabled={!form.clientId} onClick={() => setForm({ ...form, agencyClientId: form.clientId })}>Folosește clientul contractual ca agenție</button><CampaignPartyPicker label="Agenție intermediară" value={form.agencyClientId} onChange={(agencyClientId) => setForm({ ...form, agencyClientId })} /></div>
        <CampaignPartyPicker label="Beneficiar final" value={form.endClientId} onChange={(endClientId) => setForm({ ...form, endClientId })} />
        <p className="text-xs text-amber-200 md:col-span-2">{agencyIncomplete ? "Poți salva ciorna cu părțile necompletate, dar o închiriere nouă nu poate fi confirmată înainte de verificarea agenției și a beneficiarului final. " : ""}Comisionul și rebate-ul se verifică separat în condițiile negociate. Aplicația nu le calculează automat din discountul chiriei.</p>
      </> : null}
      <Field label="Nume campanie" value={form.campaignName} onChange={(campaignName) => setForm({ ...form, campaignName })} />
      <Field label="Cod campanie" value={form.campaignCode} onChange={(campaignCode) => setForm({ ...form, campaignCode })} />
      <SelectField label="Moneda propunerii comerciale" value={form.currency} onChange={(currency) => setForm({ ...form, currency })}><option value="">Alege moneda verificată</option><option value="EUR">EUR</option><option value="RON">RON</option></SelectField>
      <SelectField label="Status" value={form.status} onChange={(status) => setForm({ ...form, status })}><option value="draft">Ciorna</option><option value="planned">Planificata</option><option value="active">Activa</option><option value="completed">Finalizata</option><option value="cancelled">Anulata</option></SelectField>
      <SelectField label="Entitate contractuala" value={form.companyEntity} onChange={(companyEntity) => setForm({ ...form, companyEntity })}>{companyEntities.map((entity) => <option key={entity.value} value={entity.value}>{entity.label}</option>)}</SelectField>
      <OwnerSelect label="Agent de vanzari" value={form.sellerUserId} owners={owners} disabled={!canChangeOwner} onChange={(sellerUserId) => setForm({ ...form, sellerUserId, accountOwnerUserId: form.accountOwnerUserId || sellerUserId })} />
      <OwnerSelect label="Responsabil campanie" value={form.accountOwnerUserId} owners={owners} disabled={!canChangeOwner} onChange={(accountOwnerUserId) => setForm({ ...form, accountOwnerUserId })} />
      <SelectField label="Termen de plată verificat" value={form.paymentTermType} onChange={(paymentTermType) => setForm({ ...form, paymentTermType, paymentTermDays: ({ advance: "0", "7_days": "7", "15_days": "15", "30_days": "30", "45_days": "45" } as Record<string, string>)[paymentTermType] || "" })}><option value="">De completat înainte de aprobare</option><option value="advance">În avans / 0 zile</option><option value="7_days">7 zile</option><option value="15_days">15 zile</option><option value="30_days">30 zile</option><option value="45_days">45 zile</option><option value="custom">Personalizat</option></SelectField>
      <Field label="Termen plata (zile)" type="number" value={form.paymentTermDays} onChange={(paymentTermDays) => setForm({ ...form, paymentTermDays, paymentTermType: paymentTermDays ? "custom" : "" })} />
      <SelectField label="Facturare" value={form.billingRule} onChange={(billingRule) => setForm({ ...form, billingRule })}><option value="">De completat înainte de aprobare</option><option value="manual_per_contract">Conform contract</option><option value="campaign_start">La inceputul campaniei</option><option value="monthly_in_advance">Lunar in avans</option><option value="monthly_after_service">Lunar dupa prestare</option></SelectField>
      <SelectField label="Frecvența facturării" value={form.billingFrequency} onChange={(billingFrequency) => setForm({ ...form, billingFrequency })}><option value="">De completat înainte de aprobare</option><option value="monthly">Lunar</option><option value="once">Integral o singură dată</option><option value="custom">Conform calendarului contractual</option></SelectField>
      <div className="md:col-span-2"><TextArea label="Observatii" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} /></div>
    </div>
    <p className="mt-3 rounded-md border border-focus-line bg-focus-navy/30 p-3 text-xs text-slate-300">Alege moneda înainte de ofertare. Perioada și valoarea realizată se calculează din închirierile confirmate. Moneda unei campanii cu închirieri trebuie să corespundă contractelor existente. Finalizarea sau anularea campaniei cere rezolvarea explicită a închirierilor și hold-urilor curente ori viitoare.</p>
    {error ? <Feedback tone="error">{error}</Feedback> : null}
    <div className="mt-4 flex justify-end"><button className="focus-button" type="button" disabled={busy || !form.clientId || !form.campaignName.trim() || !form.sellerUserId || !form.accountOwnerUserId} onClick={onSave}><Save size={16} /> Salveaza</button></div>
  </Dialog>;
}

function OperationDialog({ reservation, onClose, onSaved }: { reservation: ReservationRow; onClose: () => void; onSaved: () => void }) {
  const [taskId] = useState(() => crypto.randomUUID());
  const [date, setDate] = useState(() => bucharestDateKey());
  const [cost, setCost] = useState(""); const [currency, setCurrency] = useState("");
  const [note, setNote] = useState(""); const [briefUrl, setBriefUrl] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit() {
    const amount = cost.trim() ? Number(cost.replace(",", ".")) : null;
    if (amount != null && (!Number.isFinite(amount) || amount < 0 || !["RON", "EUR"].includes(currency))) {
      setError("Completează un cost valid, pozitiv sau zero, și moneda verificată. Lasă suma necompletată dacă nu este cunoscută."); return;
    }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/reservations/${reservation.id}/operations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId, kind: "decoration", taskType: "redecoration", requestedDate: date, cost: amount, currency: amount == null ? null : currency, costOwner: "client", note: nullable(note), briefUrl: nullable(briefUrl) }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Redecorarea nu a putut fi salvata.");
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Redecorarea nu a putut fi salvata."); }
    finally { setBusy(false); }
  }
  return <Dialog title="Redecorare" subtitle={reservation.locationCode} onClose={onClose}>
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="Data solicitata" type="date" value={date} onChange={setDate} />
      <Field label="Cost estimat" value={cost} onChange={setCost} />
      <SelectField label="Moneda costului" value={currency} onChange={setCurrency}><option value="">De verificat</option><option value="RON">RON</option><option value="EUR">EUR</option></SelectField>
      <Field label="Link brief" value={briefUrl} onChange={setBriefUrl} />
      <p className="text-xs text-slate-400 md:col-span-2">Lasă costul necompletat dacă valoarea nu este încă verificată. Zero înseamnă cost cunoscut zero.</p>
      <div className="md:col-span-2"><TextArea label="Nota operationala" value={note} onChange={(value) => setNote(value)} /></div>
    </div>
    {error ? <Feedback tone="error">{error}</Feedback> : null}
    <div className="mt-4 flex justify-end"><button className="focus-button" type="button" disabled={busy || !date} onClick={submit}><Wrench size={16} /> Trimite in operational</button></div>
  </Dialog>;
}

function Metric({ label, value }: { label: string; value: string }) { return <article className="rounded-lg border border-focus-line bg-focus-navy/30 p-3"><p className="text-xs font-black uppercase text-slate-400">{label}</p><p className="mt-1 text-xl font-black text-white">{value}</p></article>; }
function formFromOverview(campaign: CampaignOverview): CampaignForm { return { currency: campaign.currency || "", clientId: campaign.clientId, campaignType: campaign.campaignType || "direct_client", agencyClientId: campaign.agencyClientId || "", endClientId: campaign.endClientId || "", campaignName: campaign.campaignName, campaignCode: campaign.campaignCode || "", status: campaign.status, companyEntity: campaign.companyEntity || "Focus Media", sellerUserId: campaign.sellerUserId || "", accountOwnerUserId: campaign.accountOwnerUserId || "", paymentTermType: campaign.paymentTermType || "", paymentTermDays: campaign.paymentTermDays != null ? String(campaign.paymentTermDays) : "", billingRule: campaign.billingRule || "", billingFrequency: campaign.billingFrequency || "", notes: campaign.notes || "" }; }

function campaignCommercialValueLabel(campaign: {
  totalsByCurrency: { RON: number; EUR: number };
  startDate?: string | null;
  bookedReservationCount?: number;
}) {
  const values = [
    campaign.totalsByCurrency.EUR > 0 ? moneyLabel(campaign.totalsByCurrency.EUR, "EUR") : null,
    campaign.totalsByCurrency.RON > 0 ? moneyLabel(campaign.totalsByCurrency.RON, "RON") : null
  ].filter(Boolean);
  if (values.length) return values.join(" + ");
  return campaign.startDate || campaign.bookedReservationCount
    ? "Date comerciale incomplete"
    : "Se calculeaza dupa BOOKED";
}

function campaignCommercialDataQualityLabel(reason: string) {
  if (reason === "BOOKED_MONTHLY_RENT_MISSING") {
    return "Lipseste chiria lunara pentru cel putin o locatie BOOKED.";
  }
  if (reason === "BOOKED_CURRENCY_MISSING") {
    return "Lipseste moneda pentru cel putin o locatie BOOKED.";
  }
  if (reason === "MIXED_CAMPAIGN_CURRENCIES") {
    return "Campania contine locatii in RON si EUR; totalurile raman separate.";
  }
  return reason;
}

function executiveCampaignParams(context?: ExecutiveCampaignContext) {
  const params = new URLSearchParams();
  if (context?.entityCode) params.set("entity", context.entityCode);
  if (context?.ownerUserId) params.set("owner", context.ownerUserId);
  if (context?.snapshotDate) params.set("snapshot", context.snapshotDate);
  if (context?.dateFilter) params.set("dateFilter", context.dateFilter);
  return params;
}
