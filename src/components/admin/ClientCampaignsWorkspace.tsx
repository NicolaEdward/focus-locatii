"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Archive,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  FileArchive,
  GitMerge,
  Pencil,
  PlusCircle,
  ReceiptText,
  Save,
  Search,
  Upload,
} from "lucide-react";
import type {
  AccountOwnerOption,
  ClientCampaignRow,
  ClientCampaignsData,
  ClientCampaignSummary,
  ClientReceivableRow
} from "@/lib/client-campaigns";
import type { AuthSession } from "@/lib/auth";
import { hasAnyPermission } from "@/lib/rbac";
import { companyEntities, normalizeCompanyEntity } from "@/lib/company-entities";
import { EscapeCloseHandler } from "@/hooks/use-escape-close";

export type ClientCampaignsWorkspaceTab = "clients" | "campaigns" | "invoices" | "cleanup" | "documents";
type WorkspaceTab = ClientCampaignsWorkspaceTab;

type ClientForm = {
  companyName: string;
  clientType: string;
  taxId: string;
  registryNumber: string;
  billingAddress: string;
  generalEmail: string;
  generalPhone: string;
  website: string;
  status: string;
  accountOwnerUserId: string;
  ownerChangeReason: string;
  notes: string;
};

type ContactForm = {
  name: string;
  role: string;
  email: string;
  phone: string;
  isPrimary: boolean;
  notes: string;
};

type CampaignForm = {
  campaignName: string;
  status: string;
  companyEntity: string;
  sellerUserId: string;
  accountOwnerUserId: string;
  startDate: string;
  endDate: string;
  currency: string;
  totalContractValue: string;
  paymentTermType: string;
  paymentTermDays: string;
  billingRule: string;
  billingFrequency: string;
  notes: string;
};

type DocumentTarget = {
  clientId?: string | null;
  campaignId?: string | null;
  reservationId?: string | null;
  billingItemId?: string | null;
  financialReceivableId?: string | null;
  label: string;
};

type RedecorationTarget = {
  campaign: ClientCampaignRow;
  rental: ClientCampaignRow["rentals"][number];
};

type RedecorationForm = {
  requestedDate: string;
  cost: string;
  currency: string;
  costOwner: string;
  note: string;
  briefUrl: string;
};

type RefreshOptions = {
  signal?: AbortSignal;
  q?: string;
  preferredClientId?: string | null;
  preferredKey?: string | null;
  fallbackClient?: SavedClientPayload | null;
  showBusy?: boolean;
};

type SavedClientPayload = {
  id: string;
  companyName: string;
  normalizedName?: string | null;
  clientType?: string | null;
  status?: string | null;
  taxId?: string | null;
  registryNumber?: string | null;
  billingAddress?: string | null;
  generalEmail?: string | null;
  generalPhone?: string | null;
  website?: string | null;
  accountOwnerUserId?: string | null;
  notes?: string | null;
  accountOwner?: { name?: string | null; email?: string | null } | null;
};

const emptyClientForm: ClientForm = {
  companyName: "",
  clientType: "direct_client",
  taxId: "",
  registryNumber: "",
  billingAddress: "",
  generalEmail: "",
  generalPhone: "",
  website: "",
  status: "active",
  accountOwnerUserId: "",
  ownerChangeReason: "",
  notes: ""
};

const emptyContactForm: ContactForm = {
  name: "",
  role: "",
  email: "",
  phone: "",
  isPrimary: false,
  notes: ""
};

const emptyCampaignForm: CampaignForm = {
  campaignName: "",
  status: "draft",
  companyEntity: "Focus Media",
  sellerUserId: "",
  accountOwnerUserId: "",
  startDate: "",
  endDate: "",
  currency: "EUR",
  totalContractValue: "",
  paymentTermType: "30_days",
  paymentTermDays: "30",
  billingRule: "manual_per_contract",
  billingFrequency: "monthly",
  notes: ""
};

const emptyRedecorationForm: RedecorationForm = {
  requestedDate: new Date().toISOString().slice(0, 10),
  cost: "",
  currency: "RON",
  costOwner: "client",
  note: "",
  briefUrl: ""
};

export function ClientCampaignsWorkspace({
  initialData,
  session,
  initialTab = "clients"
}: {
  initialData: ClientCampaignsData;
  session: AuthSession;
  initialTab?: WorkspaceTab;
}) {
  const searchParams = useSearchParams();
  const focusedClientId = searchParams.get("clientId");
  const focusedCampaignId = searchParams.get("campaignId");
  const [data, setData] = useState(initialData);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [clientForm, setClientForm] = useState<ClientForm>(emptyClientForm);
  const [contactForm, setContactForm] = useState<ContactForm>(emptyContactForm);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [campaignForm, setCampaignForm] = useState<CampaignForm>(emptyCampaignForm);
  const [redecorationTarget, setRedecorationTarget] = useState<RedecorationTarget | null>(null);
  const [redecorationForm, setRedecorationForm] = useState<RedecorationForm>(emptyRedecorationForm);
  const [documentTarget, setDocumentTarget] = useState<DocumentTarget | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManageClients = hasAnyPermission(session.role, ["clients.manage", "clients.manage.own"]);
  const canManageCampaigns = hasAnyPermission(session.role, ["campaigns.manage", "reservations.manage", "reservations.manage.own"]);
  const canChangeOwner = ["COO", "SALES_DIRECTOR", "SUPER_ADMIN"].includes(session.role);
  const canRecordPayments = hasAnyPermission(session.role, ["finance.validate", "finance.manage"]);

  const selected = useMemo(
    () => data.clients.find((client) => client.key === selectedKey) || null,
    [data.clients, selectedKey]
  );

  useEffect(() => {
    if (focusedClientId) {
      const focusedClient = data.clients.find((client) => client.clientId === focusedClientId);
      setActiveTab("clients");
      if (focusedClient) {
        setSelectedKey(focusedClient.key);
        setQuery(focusedClient.companyName);
      } else {
        setQuery(focusedClientId);
      }
      return;
    }
    if (focusedCampaignId) {
      const focusedCampaign = data.campaigns.find((campaign) => campaign.id === focusedCampaignId);
      setActiveTab("campaigns");
      if (focusedCampaign) {
        setSelectedKey(focusedCampaign.clientKey);
        setQuery(focusedCampaign.campaignName || focusedCampaign.clientName || focusedCampaignId);
      } else {
        setQuery(focusedCampaignId);
      }
    }
  }, [data.campaigns, data.clients, focusedCampaignId, focusedClientId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void refreshData({ signal: controller.signal, q: query, showBusy: false });
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (!selected) {
      setClientForm(emptyClientForm);
      return;
    }
    setClientForm({
      companyName: selected.companyName,
      clientType: selected.clientType || "direct_client",
      taxId: selected.taxId || "",
      registryNumber: selected.registryNumber || "",
      billingAddress: selected.billingAddress || "",
      generalEmail: selected.generalEmail || "",
      generalPhone: selected.generalPhone || "",
      website: selected.website || "",
      status: selected.status || "active",
      accountOwnerUserId: selected.accountOwnerUserId || "",
      ownerChangeReason: "",
      notes: selected.notes || ""
    });
    setContactForm(emptyContactForm);
    setCampaignForm(emptyCampaignForm);
    setEditingCampaignId(null);
    setCampaignOpen(false);
  }, [selected?.clientId, selected?.key]);

  async function refreshData(options: RefreshOptions = {}) {
    const { signal, q = query, preferredClientId, preferredKey, fallbackClient, showBusy = true } = options;
    if (showBusy) setBusy(true);
    try {
      const response = await fetch(`/api/admin/client-campaigns?q=${encodeURIComponent(q)}`, { cache: "no-store", signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Datele nu au putut fi incarcate.");
      let nextData = payload.data as ClientCampaignsData;
      if (fallbackClient?.id && !nextData.clients.some((client) => client.clientId === fallbackClient.id)) {
        nextData = upsertSavedClient(nextData, fallbackClient);
      }
      setData(nextData);
      setSelectedKey((current) => {
        const preferred =
          preferredKey ||
          (preferredClientId ? nextData.clients.find((client) => client.clientId === preferredClientId)?.key : null);
        if (preferred && nextData.clients.some((client) => client.key === preferred)) return preferred;
        return nextData.clients.some((client: ClientCampaignSummary) => client.key === current) ? current : "";
      });
      return nextData;
    } catch (refreshError) {
      if (!signal?.aborted) setError(refreshError instanceof Error ? refreshError.message : "Datele nu au putut fi incarcate.");
      return null;
    } finally {
      if (!signal?.aborted && showBusy) setBusy(false);
    }
  }

  async function createClient() {
    const saved = await saveClient("/api/admin/clients", "POST", "Clientul a fost creat.");
    if (saved) setCreateOpen(false);
  }

  async function updateClient() {
    if (!selected?.clientId) return;
    await saveClient(`/api/admin/clients/${selected.clientId}`, "PATCH", "Clientul a fost actualizat.");
  }

  async function saveClient(url: string, method: "POST" | "PATCH", successMessage: string) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyName: clientForm.companyName,
          clientType: clientForm.clientType,
          taxId: nullable(clientForm.taxId),
          registryNumber: nullable(clientForm.registryNumber),
          billingAddress: nullable(clientForm.billingAddress),
          generalEmail: nullable(clientForm.generalEmail),
          generalPhone: nullable(clientForm.generalPhone),
          website: nullable(clientForm.website),
          status: clientForm.status,
          accountOwnerUserId: nullable(clientForm.accountOwnerUserId),
          ownerChangeReason: nullable(clientForm.ownerChangeReason),
          notes: nullable(clientForm.notes)
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Clientul nu a putut fi salvat.");
      const savedClient = payload?.client as SavedClientPayload | undefined;
      const nextQuery = method === "POST" ? "" : query;
      if (savedClient?.id) {
        setData((current) => upsertSavedClient(current, savedClient));
        setSelectedKey(clientKeyFromId(savedClient.id));
      }
      setMessage(successMessage);
      setQuery(nextQuery);
      await refreshData({ q: nextQuery, preferredClientId: savedClient?.id || selected?.clientId || null, fallbackClient: savedClient || null });
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Clientul nu a putut fi salvat.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addContact() {
    if (!selected?.clientId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/clients/${selected.clientId}/contacts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: contactForm.name,
          role: nullable(contactForm.role),
          email: nullable(contactForm.email),
          phone: nullable(contactForm.phone),
          isPrimary: contactForm.isPrimary,
          notes: nullable(contactForm.notes)
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Contactul nu a putut fi salvat.");
      setContactForm(emptyContactForm);
      setMessage("Contactul a fost adaugat.");
      await refreshData();
    } catch (contactError) {
      setError(contactError instanceof Error ? contactError.message : "Contactul nu a putut fi salvat.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCampaign() {
    const selectedClientId = selected?.clientId || data.campaigns.find((campaign) => campaign.id === editingCampaignId)?.clientId;
    if (!selectedClientId && !editingCampaignId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(editingCampaignId ? `/api/admin/campaigns/${editingCampaignId}` : "/api/admin/campaigns", {
        method: editingCampaignId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClientId,
          campaignName: campaignForm.campaignName,
          status: campaignForm.status,
          campaignType: selected?.clientType || "direct_client",
          sellerUserId: nullable(campaignForm.sellerUserId),
          accountOwnerUserId: nullable(campaignForm.accountOwnerUserId),
          companyEntity: campaignForm.companyEntity,
          startDate: nullable(campaignForm.startDate),
          endDate: nullable(campaignForm.endDate),
          currency: campaignForm.currency,
          totalContractValue: moneyValue(campaignForm.totalContractValue),
          paymentTermType: campaignForm.paymentTermType,
          paymentTermDays: integerValue(campaignForm.paymentTermDays),
          billingRule: campaignForm.billingRule,
          billingFrequency: campaignForm.billingFrequency,
          notes: nullable(campaignForm.notes)
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Campania nu a putut fi salvata.");
      setCampaignOpen(false);
      setEditingCampaignId(null);
      setCampaignForm(emptyCampaignForm);
      setActiveTab("campaigns");
      setMessage(editingCampaignId ? "Campania a fost actualizata." : "Campania a fost creata si poate fi folosita la inchiriere.");
      await refreshData();
    } catch (campaignError) {
      setError(campaignError instanceof Error ? campaignError.message : "Campania nu a putut fi salvata.");
    } finally {
      setBusy(false);
    }
  }

  function openCampaignEditor(campaign: ClientCampaignRow) {
    setError(null);
    setMessage(null);
    setSelectedKey(campaign.clientKey);
    setActiveTab("clients");
    setEditingCampaignId(campaign.id);
    setCampaignOpen(true);
    setCampaignForm({
      campaignName: campaign.campaignName || "",
      status: campaign.status || "draft",
      companyEntity: normalizeCompanyEntity(campaign.contractCompany) || "Focus Media",
      sellerUserId: campaign.sellerUserId || "",
      accountOwnerUserId: campaign.accountOwnerUserId || "",
      startDate: dateInput(campaign.periodStart),
      endDate: dateInput(campaign.periodEnd),
      currency: campaign.currency || "EUR",
      totalContractValue: numberInput(campaign.amount),
      paymentTermType: campaign.paymentTermType || "30_days",
      paymentTermDays: numberInput(campaign.paymentTermDays ?? defaultPaymentDays(campaign.paymentTermType || "30_days")),
      billingRule: campaign.billingRule || "manual_per_contract",
      billingFrequency: campaign.billingFrequency || "monthly",
      notes: campaign.notes || ""
    });
  }

  function openNewCampaignEditor() {
    setEditingCampaignId(null);
    setCampaignForm({
      ...emptyCampaignForm,
      sellerUserId: session.id,
      accountOwnerUserId: selected?.accountOwnerUserId || session.id
    });
    setCampaignOpen((current) => !current || Boolean(editingCampaignId));
  }

  async function archiveCampaign(campaign: ClientCampaignRow) {
    if (!window.confirm(`Arhivez campania "${campaign.campaignName || campaign.clientName}"? Campaniile cu inchirieri active nu se arhiveaza pana nu sunt mutate/anulate.`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/campaigns/${campaign.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Campania nu a putut fi arhivata.");
      setMessage("Campania a fost arhivata.");
      await refreshData();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Campania nu a putut fi arhivata.");
    } finally {
      setBusy(false);
    }
  }

  function openRedecoration(campaign: ClientCampaignRow, rental: ClientCampaignRow["rentals"][number]) {
    setRedecorationTarget({ campaign, rental });
    setRedecorationForm({ ...emptyRedecorationForm, currency: rental.currency || campaign.currency || "RON" });
  }

  async function createRedecoration() {
    if (!redecorationTarget) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/reservations/${redecorationTarget.rental.id}/operations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "decoration",
          taskType: "redecoration",
          requestedDate: redecorationForm.requestedDate,
          cost: moneyValue(redecorationForm.cost),
          currency: redecorationForm.currency,
          costOwner: redecorationForm.costOwner,
          note: nullable(redecorationForm.note) || `Redecorare ${redecorationTarget.rental.locationCode}`,
          briefUrl: nullable(redecorationForm.briefUrl)
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Redecorarea nu a putut fi salvata.");
      setRedecorationTarget(null);
      setRedecorationForm(emptyRedecorationForm);
      setMessage("Redecorarea a fost adaugata pentru locatia selectata.");
      await refreshData();
    } catch (redecorationError) {
      setError(redecorationError instanceof Error ? redecorationError.message : "Redecorarea nu a putut fi salvata.");
    } finally {
      setBusy(false);
    }
  }

  async function recordPayment(invoice: ClientReceivableRow, mode: "full" | "partial") {
    if (!canRecordPayments) return;
    const amountText = mode === "full"
      ? String(invoice.remaining)
      : window.prompt(`Suma incasata (${invoice.currency || "RON"})`, String(invoice.remaining));
    if (!amountText) return;
    const amount = Number(amountText.replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Suma introdusa nu este valida.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/receivables/${invoice.id}/payment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "add",
          amount,
          collectedAt: new Date().toISOString().slice(0, 10),
          notes: mode === "full" ? "Marcata incasata din modul Facturi." : "Incasare partiala din modul Facturi."
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Incasarea nu a putut fi salvata.");
      setMessage(mode === "full" ? "Factura a fost marcata incasata." : "Incasarea partiala a fost salvata.");
      await refreshData();
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Incasarea nu a putut fi salvata.");
    } finally {
      setBusy(false);
    }
  }

  async function mergeClients(primaryClientId: string, duplicateClientId: string) {
    if (!window.confirm("Combin clientul duplicat in clientul principal? Datele se muta, clientul duplicat se arhiveaza.")) return;
    await postAction("/api/admin/clients/merge", {
      primaryClientId,
      duplicateClientId,
      reason: "Merge din Client Cleanup"
    }, "Clientii au fost combinati.");
  }

  async function archiveDuplicateInvoice(primaryInvoiceId: string, duplicateInvoiceId: string) {
    if (!window.confirm("Arhivez factura duplicata si o scot din totaluri?")) return;
    await postAction("/api/admin/receivables/merge", {
      primaryInvoiceId,
      duplicateInvoiceId,
      reason: "Factura duplicata rezolvata din Cleanup"
    }, "Factura duplicata a fost arhivata.");
  }

  async function postAction(url: string, body: unknown, successMessage: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Actiunea nu a putut fi salvata.");
      setMessage(successMessage);
      await refreshData();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Actiunea nu a putut fi salvata.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="focus-container grid gap-5 py-6">
      <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Clienti / Campanii / Facturi</p>
            <h1 className="font-display text-3xl font-black uppercase text-white">Clienti si campanii OOH</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              Clientul este firma, campania este proiectul, locatia este inventarul vandut, iar factura este partea financiara.
            </p>
          </div>
          {canManageClients ? (
            <button className="focus-button" type="button" onClick={() => {
              setCreateOpen((current) => !current);
              setClientForm(emptyClientForm);
            }}>
              <PlusCircle size={18} /> Client nou
            </button>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Metric icon={<Building2 size={18} />} label="Clienti" value={data.totals.clients} detail={`${data.totals.clientsMissingOwner} fara owner`} />
          <Metric icon={<BriefcaseBusiness size={18} />} label="Campanii" value={data.totals.campaigns} detail={`${data.totals.activeCampaigns} active`} />
          <Metric icon={<ReceiptText size={18} />} label="Facturi deschise" value={data.totals.openReceivables} detail={`${data.totals.overdueReceivables} depasite`} />
          <Metric icon={<CircleDollarSign size={18} />} label="Rest incasat" value={moneyPair(data.totals.remainingRon, data.totals.remainingEur)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <TabButton active={activeTab === "clients"} onClick={() => setActiveTab("clients")}>Clienti</TabButton>
          <TabButton active={activeTab === "campaigns"} onClick={() => setActiveTab("campaigns")}>Campanii</TabButton>
          <TabButton active={activeTab === "invoices"} onClick={() => setActiveTab("invoices")}>Facturi</TabButton>
          <TabButton active={activeTab === "cleanup"} onClick={() => setActiveTab("cleanup")}>Curatare</TabButton>
          <TabButton active={activeTab === "documents"} onClick={() => setActiveTab("documents")}>Documente</TabButton>
        </div>
      </section>

      {message ? <Feedback tone="green" text={message} /> : null}
      {error ? <Feedback tone="red" text={error} /> : null}

      {createOpen ? (
        <ClientEditor
          title="Creeaza client"
          form={clientForm}
          accountOwners={data.accountOwners}
          canChangeOwner={canChangeOwner}
          busy={busy}
          onChange={setClientForm}
          onSave={createClient}
        />
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <aside className="rounded-lg border border-focus-line bg-focus-ink/70 p-4">
          <label className="grid gap-2">
            <span className="text-xs font-black uppercase text-slate-400">Cauta client, campanie sau factura</span>
            <span className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input className="focus-input w-full pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ex: Artsani, FCSM 1299, DN1" />
            </span>
          </label>
          <div className="mt-4 max-h-[calc(100vh-18rem)] overflow-auto pr-1">
            {data.clients.length ? data.clients.map((client) => (
              <button
                className={`mb-2 w-full rounded-lg border p-3 text-left transition ${selected?.key === client.key ? "border-focus-yellow bg-focus-yellow/10" : "border-focus-line bg-focus-navy/35 hover:border-focus-yellow/60"}`}
                key={client.key}
                type="button"
                onClick={() => {
                  setSelectedKey(client.key);
                  setMessage(null);
                  setError(null);
                }}
              >
                <span className="block font-black text-white">{client.companyName}</span>
                <span className="mt-1 block text-xs text-slate-400">{client.accountOwnerName || "Owner nesetat"} / {client.campaigns.length} campanii</span>
                <span className="mt-2 flex flex-wrap gap-2 text-xs">
                  {client.nextDueDate ? <Badge tone={client.overdueRon || client.overdueEur ? "red" : "yellow"}>Scadenta {date(client.nextDueDate)}</Badge> : <Badge>Fara scadente</Badge>}
                  {client.remainingRon || client.remainingEur ? <Badge tone="green">{moneyPair(client.remainingRon, client.remainingEur)}</Badge> : null}
                </span>
              </button>
            )) : <p className="rounded-lg border border-focus-line bg-focus-navy/35 p-5 text-sm text-slate-400">Nu exista clienti pentru cautarea curenta.</p>}
          </div>
          {busy ? <p className="mt-3 text-xs font-bold text-focus-yellow">Se actualizeaza...</p> : null}
        </aside>

        <section className="grid gap-5">
          {activeTab === "clients" ? (
            selected ? (
              <ClientTab
                client={selected}
                form={clientForm}
                contactForm={contactForm}
                accountOwners={data.accountOwners}
                session={session}
                canManageClients={canManageClients}
                canManageCampaigns={canManageCampaigns}
                canChangeOwner={canChangeOwner}
                busy={busy}
                campaignOpen={campaignOpen}
                campaignForm={campaignForm}
                editingCampaignId={editingCampaignId}
                onFormChange={setClientForm}
                onContactChange={setContactForm}
                onCampaignChange={setCampaignForm}
                onSave={updateClient}
                onAddContact={addContact}
                onSaveCampaign={saveCampaign}
                onToggleCampaignForm={openNewCampaignEditor}
                onEditCampaign={openCampaignEditor}
                onArchiveCampaign={archiveCampaign}
                onRedecorate={openRedecoration}
                onDocumentTarget={setDocumentTarget}
              />
            ) : <EmptyState text="Alege un client din lista pentru detalii si editare, sau creeaza un client nou." />
          ) : null}

          {activeTab === "campaigns" ? (
            <CampaignsTab
              campaigns={data.campaigns}
              canManageCampaigns={canManageCampaigns}
              onDocumentTarget={setDocumentTarget}
              onEditCampaign={openCampaignEditor}
              onArchiveCampaign={archiveCampaign}
              onRedecorate={openRedecoration}
            />
          ) : null}

          {activeTab === "invoices" ? (
            <InvoicesTab invoices={data.invoices} canRecordPayments={canRecordPayments} onPayment={recordPayment} onDocumentTarget={setDocumentTarget} />
          ) : null}

          {activeTab === "cleanup" ? (
            <CleanupTab data={data} onMergeClients={mergeClients} onArchiveDuplicateInvoice={archiveDuplicateInvoice} />
          ) : null}

          {activeTab === "documents" ? (
            <DocumentsTab
              selected={selected}
              canUploadDocument={
                canManageClients &&
                Boolean(selected?.clientId) &&
                (session.role !== "SALES_AGENT" || selected?.accountOwnerUserId === session.id)
              }
              onDocumentTarget={setDocumentTarget}
            />
          ) : null}
        </section>
      </section>

      {documentTarget ? (
        <DocumentUploadModal
          target={documentTarget}
          busy={busy}
          onClose={() => setDocumentTarget(null)}
          onUploaded={async () => {
            setDocumentTarget(null);
            setMessage("Documentul a fost salvat.");
            await refreshData();
          }}
          onError={setError}
        />
      ) : null}
      {redecorationTarget ? (
        <RedecorationModal
          target={redecorationTarget}
          form={redecorationForm}
          busy={busy}
          onChange={setRedecorationForm}
          onClose={() => setRedecorationTarget(null)}
          onSave={createRedecoration}
        />
      ) : null}
    </main>
  );
}

function ClientTab({
  client,
  form,
  contactForm,
  accountOwners,
  session,
  canManageClients,
  canManageCampaigns,
  canChangeOwner,
  busy,
  campaignOpen,
  campaignForm,
  editingCampaignId,
  onFormChange,
  onContactChange,
  onCampaignChange,
  onSave,
  onAddContact,
  onSaveCampaign,
  onToggleCampaignForm,
  onEditCampaign,
  onArchiveCampaign,
  onRedecorate,
  onDocumentTarget
}: {
  client: ClientCampaignSummary;
  form: ClientForm;
  contactForm: ContactForm;
  accountOwners: AccountOwnerOption[];
  session: AuthSession;
  canManageClients: boolean;
  canManageCampaigns: boolean;
  canChangeOwner: boolean;
  busy: boolean;
  campaignOpen: boolean;
  campaignForm: CampaignForm;
  editingCampaignId: string | null;
  onFormChange: (form: ClientForm) => void;
  onContactChange: (form: ContactForm) => void;
  onCampaignChange: (form: CampaignForm) => void;
  onSave: () => void;
  onAddContact: () => void;
  onSaveCampaign: () => void;
  onToggleCampaignForm: () => void;
  onEditCampaign: (campaign: ClientCampaignRow) => void;
  onArchiveCampaign: (campaign: ClientCampaignRow) => void;
  onRedecorate: (campaign: ClientCampaignRow, rental: ClientCampaignRow["rentals"][number]) => void;
  onDocumentTarget: (target: DocumentTarget) => void;
}) {
  const canEditClient =
    canManageClients &&
    Boolean(client.clientId) &&
    (session.role !== "SALES_AGENT" || client.accountOwnerUserId === session.id);
  const canEditClientCampaigns = canManageCampaigns && canEditClient;

  return (
    <>
      <ClientEditor
        title={`Client: ${client.companyName}`}
        form={form}
        accountOwners={accountOwners}
        canChangeOwner={canChangeOwner}
        busy={busy}
        disabled={!canEditClient}
        onChange={onFormChange}
        onSave={onSave}
      />
      {!canEditClient && session.role === "SALES_AGENT" ? (
        <p className="rounded-lg border border-focus-line bg-focus-navy/35 p-3 text-sm text-slate-300">
          Client vizibil pentru verificare si evitare duplicate. Modificarile sunt disponibile doar owner-ului clientului.
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Metric icon={<CircleDollarSign size={18} />} label="Rest RON" value={money(client.remainingRon, "RON")} detail={client.overdueRon ? `${money(client.overdueRon, "RON")} depasit` : "In lucru"} />
        <Metric icon={<CircleDollarSign size={18} />} label="Rest EUR" value={money(client.remainingEur, "EUR")} detail={client.overdueEur ? `${money(client.overdueEur, "EUR")} depasit` : "Import vechi"} />
        <Metric icon={<BriefcaseBusiness size={18} />} label="Campanii client" value={client.campaigns.length} detail={`${client.receivables.filter((item) => !item.archived).length} scadente deschise`} />
      </div>
      <TableShell title="Campanii client">
        <div className="mb-3 flex justify-end">
          {canEditClientCampaigns && client.clientId ? (
            <button className="focus-button" type="button" onClick={onToggleCampaignForm}>
              <PlusCircle size={18} /> Campanie noua
            </button>
          ) : null}
        </div>
        {campaignOpen ? (
          <CampaignEditor
            title={editingCampaignId ? "Editeaza campanie" : "Campanie noua"}
            form={campaignForm}
            accountOwners={accountOwners}
            busy={busy}
            onChange={onCampaignChange}
            onSave={onSaveCampaign}
          />
        ) : null}
        <CampaignsTable
          campaigns={client.campaigns}
          canManageCampaigns={canEditClientCampaigns}
          onDocumentTarget={onDocumentTarget}
          onEditCampaign={onEditCampaign}
          onArchiveCampaign={onArchiveCampaign}
          onRedecorate={onRedecorate}
        />
      </TableShell>
      <TableShell title="Contacte client">
        <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
          <div className="overflow-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="bg-focus-navy text-left text-xs uppercase text-slate-400"><tr><th className="px-3 py-2">Nume</th><th className="px-3 py-2">Functie</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Telefon</th><th className="px-3 py-2">Principal</th></tr></thead>
              <tbody>
                {client.contacts.length ? client.contacts.map((contact) => (
                  <tr className="border-t border-focus-line" key={contact.id}>
                    <td className="px-3 py-3 font-bold text-white">{contact.name}</td>
                    <td className="px-3 py-3">{contact.role || "-"}</td>
                    <td className="px-3 py-3">{contact.email || "-"}</td>
                    <td className="px-3 py-3">{contact.phone || "-"}</td>
                    <td className="px-3 py-3">{contact.isPrimary ? "Da" : "-"}</td>
                  </tr>
                )) : <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={5}>Nu exista contacte.</td></tr>}
              </tbody>
            </table>
          </div>
          {canEditClient ? (
            <div className="rounded-lg border border-focus-line bg-focus-navy/35 p-4">
              <h4 className="text-sm font-black uppercase text-focus-yellow">Adauga contact</h4>
              <div className="mt-3 grid gap-3">
                <Input label="Nume" value={contactForm.name} onChange={(name) => onContactChange({ ...contactForm, name })} />
                <Input label="Functie" value={contactForm.role} onChange={(role) => onContactChange({ ...contactForm, role })} />
                <Input label="Email" value={contactForm.email} onChange={(email) => onContactChange({ ...contactForm, email })} />
                <Input label="Telefon" value={contactForm.phone} onChange={(phone) => onContactChange({ ...contactForm, phone })} />
                <label className="flex items-center justify-between gap-3 text-sm font-bold text-slate-200">Contact principal <input type="checkbox" checked={contactForm.isPrimary} onChange={(event) => onContactChange({ ...contactForm, isPrimary: event.target.checked })} /></label>
                <button className="focus-button" type="button" disabled={busy || contactForm.name.trim().length < 2} onClick={onAddContact}><PlusCircle size={18} /> Adauga contact</button>
              </div>
            </div>
          ) : null}
        </div>
      </TableShell>
      <TableShell title="Documente client">
        <div className="mb-3 flex justify-end">
          {canEditClient && client.clientId ? <button className="focus-button secondary" type="button" onClick={() => onDocumentTarget({ clientId: client.clientId, label: client.companyName })}><Upload size={18} /> Incarca document</button> : null}
        </div>
        <DocumentsList documents={client.documents} />
      </TableShell>
    </>
  );
}

function ClientEditor({
  title,
  form,
  accountOwners,
  canChangeOwner,
  busy,
  disabled,
  onChange,
  onSave
}: {
  title: string;
  form: ClientForm;
  accountOwners: AccountOwnerOption[];
  canChangeOwner: boolean;
  busy: boolean;
  disabled?: boolean;
  onChange: (form: ClientForm) => void;
  onSave: () => void;
}) {
  return (
    <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-black uppercase text-focus-yellow">{title}</h2>
        <button className="focus-button" type="button" disabled={busy || disabled || form.companyName.trim().length < 2} onClick={onSave}>
          <Save size={18} /> Salveaza
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Input label="Client / companie" value={form.companyName} disabled={disabled} onChange={(companyName) => onChange({ ...form, companyName })} />
        <Select label="Tip client" value={form.clientType} disabled={disabled} onChange={(clientType) => onChange({ ...form, clientType })}>
          <option value="direct_client">Client direct</option>
          <option value="agency">Agentie</option>
        </Select>
        <Input label="CUI / CIF" value={form.taxId} disabled={disabled} onChange={(taxId) => onChange({ ...form, taxId })} />
        <Input label="Registrul comertului" value={form.registryNumber} disabled={disabled} onChange={(registryNumber) => onChange({ ...form, registryNumber })} />
        <Select label="Status" value={form.status} disabled={disabled} onChange={(status) => onChange({ ...form, status })}>
          <option value="prospect">Prospect</option>
          <option value="active">Activ</option>
          <option value="inactive">Inactiv</option>
          <option value="archived">Arhivat</option>
        </Select>
        <Input label="Email general" value={form.generalEmail} disabled={disabled} onChange={(generalEmail) => onChange({ ...form, generalEmail })} />
        <Input label="Telefon general" value={form.generalPhone} disabled={disabled} onChange={(generalPhone) => onChange({ ...form, generalPhone })} />
        <Input label="Website" value={form.website} disabled={disabled} onChange={(website) => onChange({ ...form, website })} />
        <Select label="Account owner" value={form.accountOwnerUserId} disabled={disabled || !canChangeOwner} onChange={(accountOwnerUserId) => onChange({ ...form, accountOwnerUserId })}>
          <option value="">Nesetat</option>
          {accountOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name} - {owner.role}</option>)}
        </Select>
        <Input label="Motiv schimbare owner" value={form.ownerChangeReason} disabled={disabled || !canChangeOwner} onChange={(ownerChangeReason) => onChange({ ...form, ownerChangeReason })} />
        <label className="grid gap-1 text-sm font-bold text-slate-200 md:col-span-2">
          Adresa facturare
          <textarea className="focus-input min-h-20" disabled={disabled} value={form.billingAddress} onChange={(event) => onChange({ ...form, billingAddress: event.target.value })} />
        </label>
        <label className="grid gap-1 text-sm font-bold text-slate-200 xl:col-span-4">
          Observatii
          <textarea className="focus-input min-h-20" disabled={disabled} value={form.notes} onChange={(event) => onChange({ ...form, notes: event.target.value })} />
        </label>
      </div>
    </section>
  );
}

function CampaignEditor({
  title,
  form,
  accountOwners,
  busy,
  onChange,
  onSave
}: {
  title: string;
  form: CampaignForm;
  accountOwners: AccountOwnerOption[];
  busy: boolean;
  onChange: (form: CampaignForm) => void;
  onSave: () => void;
}) {
  return (
    <div className="mb-4 rounded-lg border border-focus-line bg-focus-navy/35 p-4">
      <p className="mb-3 text-xs font-black uppercase text-focus-yellow">{title}</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Input label="Nume campanie" value={form.campaignName} onChange={(campaignName) => onChange({ ...form, campaignName })} />
        <Select label="Status" value={form.status} onChange={(status) => onChange({ ...form, status })}>
          <option value="draft">Draft</option>
          <option value="reserved">Rezervata</option>
          <option value="active">Activa</option>
          <option value="paused">Pauzata</option>
          <option value="completed">Finalizata</option>
          <option value="cancelled">Anulata</option>
        </Select>
        <Select label="Firma contractanta" value={form.companyEntity} onChange={(companyEntity) => onChange({ ...form, companyEntity })}>
          {companyEntities.map((entity) => <option key={entity.value} value={entity.value}>{entity.label}</option>)}
        </Select>
        <Select label="Moneda" value={form.currency} onChange={(currency) => onChange({ ...form, currency })}>
          <option value="EUR">EUR</option>
          <option value="RON">RON</option>
        </Select>
        <Select label="Vanzator" value={form.sellerUserId} onChange={(sellerUserId) => onChange({ ...form, sellerUserId })}>
          <option value="">Implicit cont curent</option>
          {accountOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name} - {owner.role}</option>)}
        </Select>
        <Select label="Account owner" value={form.accountOwnerUserId} onChange={(accountOwnerUserId) => onChange({ ...form, accountOwnerUserId })}>
          <option value="">Implicit vanzator/client</option>
          {accountOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name} - {owner.role}</option>)}
        </Select>
        <Input type="date" label="Start campanie" value={form.startDate} onChange={(startDate) => onChange({ ...form, startDate })} />
        <Input type="date" label="Final campanie" value={form.endDate} onChange={(endDate) => onChange({ ...form, endDate })} />
        <Input label="Valoare contractata" value={form.totalContractValue} onChange={(totalContractValue) => onChange({ ...form, totalContractValue })} />
        <Select label="Termen plata" value={form.paymentTermType} onChange={(paymentTermType) => onChange({ ...form, paymentTermType, paymentTermDays: paymentTermType === "custom" ? form.paymentTermDays : String(defaultPaymentDays(paymentTermType)) })}>
          <option value="advance">Avans</option>
          <option value="7_days">7 zile</option>
          <option value="15_days">15 zile</option>
          <option value="30_days">30 zile</option>
          <option value="45_days">45 zile</option>
          <option value="custom">Personalizat</option>
        </Select>
        <Input label="Zile termen plata" value={form.paymentTermDays} onChange={(paymentTermDays) => onChange({ ...form, paymentTermDays, paymentTermType: "custom" })} />
        <Select label="Regula facturare" value={form.billingRule} onChange={(billingRule) => onChange({ ...form, billingRule })}>
          <option value="manual_per_contract">Conform contract</option>
          <option value="month_start">Inceput luna</option>
          <option value="month_end">Final luna</option>
          <option value="campaign_start">Inceput campanie</option>
          <option value="campaign_end">Final campanie</option>
          <option value="monthly_in_advance">Lunar in avans</option>
          <option value="monthly_after_service">Lunar dupa prestare</option>
          <option value="upfront_on_contract">Integral la contract</option>
        </Select>
        <Select label="Frecventa" value={form.billingFrequency} onChange={(billingFrequency) => onChange({ ...form, billingFrequency })}>
          <option value="monthly">Lunar</option>
          <option value="once">O singura data</option>
          <option value="custom">Custom</option>
        </Select>
        <Input label="Observatii" value={form.notes} onChange={(notes) => onChange({ ...form, notes })} />
      </div>
      <div className="mt-4 flex justify-end">
        <button className="focus-button" type="button" disabled={busy || form.campaignName.trim().length < 2} onClick={onSave}>
          <Save size={18} /> Salveaza campania
        </button>
      </div>
    </div>
  );
}

function CampaignsTab({
  campaigns,
  canManageCampaigns,
  onDocumentTarget,
  onEditCampaign,
  onArchiveCampaign,
  onRedecorate
}: {
  campaigns: ClientCampaignRow[];
  canManageCampaigns: boolean;
  onDocumentTarget: (target: DocumentTarget) => void;
  onEditCampaign: (campaign: ClientCampaignRow) => void;
  onArchiveCampaign: (campaign: ClientCampaignRow) => void;
  onRedecorate: (campaign: ClientCampaignRow, rental: ClientCampaignRow["rentals"][number]) => void;
}) {
  return (
    <TableShell title="Campanii">
      <CampaignsTable
        campaigns={campaigns}
        canManageCampaigns={canManageCampaigns}
        onDocumentTarget={onDocumentTarget}
        onEditCampaign={onEditCampaign}
        onArchiveCampaign={onArchiveCampaign}
        onRedecorate={onRedecorate}
      />
    </TableShell>
  );
}

function CampaignsTable({
  campaigns,
  canManageCampaigns,
  onDocumentTarget,
  onEditCampaign,
  onArchiveCampaign,
  onRedecorate
}: {
  campaigns: ClientCampaignRow[];
  canManageCampaigns: boolean;
  onDocumentTarget: (target: DocumentTarget) => void;
  onEditCampaign: (campaign: ClientCampaignRow) => void;
  onArchiveCampaign: (campaign: ClientCampaignRow) => void;
  onRedecorate: (campaign: ClientCampaignRow, rental: ClientCampaignRow["rentals"][number]) => void;
}) {
  return (
      <table className="w-full min-w-[1200px] text-sm">
        <thead className="sticky top-0 z-10 bg-focus-navy text-left text-xs uppercase text-slate-400">
          <tr><th className="px-3 py-2">Campanie</th><th className="px-3 py-2">Client</th><th className="px-3 py-2">Locatie</th><th className="px-3 py-2">Perioada</th><th className="px-3 py-2">Vanzator</th><th className="px-3 py-2">Termen plata</th><th className="px-3 py-2">Facturare</th><th className="px-3 py-2">Probleme</th><th className="px-3 py-2">Actiuni</th></tr>
        </thead>
        <tbody>
          {campaigns.length ? campaigns.map((row) => (
            <tr className="border-t border-focus-line" key={row.id}>
              <td className="px-3 py-3 font-black text-white">{row.campaignName || row.clientName}<small className="block text-slate-400">{money(row.monthlyRentTotal || row.amount, row.currency)} / luna</small></td>
              <td className="px-3 py-3">{row.clientCompany || row.clientName}<small className="block text-slate-400">{row.contractCompany || "-"}</small></td>
              <td className="px-3 py-3">
                {row.rentals.length ? (
                  <div className="grid gap-1">
                    {row.rentals.map((rental) => (
                      <div className="flex flex-wrap items-center gap-2" key={rental.id}>
                        <span className="font-black text-white">{rental.locationCode}</span>
                        <small className="text-slate-400">{rental.city || ""}</small>
                        {canManageCampaigns ? (
                          <button className="rounded border border-focus-yellow/50 px-2 py-1 text-[10px] font-black uppercase text-focus-yellow" type="button" onClick={() => onRedecorate(row, rental)}>
                            Schimbare vizual
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    {row.locationCode}<small className="block text-slate-400">{row.city || ""}</small>
                  </>
                )}
              </td>
              <td className="px-3 py-3">{date(row.periodStart)} - {date(row.periodEnd)}</td>
              <td className="px-3 py-3">{row.sellerName || "-"}</td>
              <td className="px-3 py-3">{paymentTermLabel(row.paymentTermType, row.paymentTermDays)}</td>
              <td className="px-3 py-3">{billingRuleLabel(row.billingRule)}<small className="block text-slate-400">{row.invoiceDate ? `Urmatoarea factura estimata ${date(row.invoiceDate)}` : "Facturile se introduc manual in Financiar"}</small></td>
              <td className="px-3 py-3">{row.issues.length ? <div className="flex flex-wrap gap-1">{row.issues.map((issue) => <Badge tone="yellow" key={issue}>{issue}</Badge>)}</div> : <Badge tone="green">OK</Badge>}</td>
              <td className="px-3 py-3">
                <div className="flex flex-wrap gap-2">
                  {canManageCampaigns ? <button className="focus-button secondary" type="button" onClick={() => onEditCampaign(row)}><Pencil size={16} /> Edit</button> : null}
                  <button className="focus-button secondary" type="button" onClick={() => onDocumentTarget({ campaignId: row.id, clientId: row.clientId, label: row.campaignName || row.clientName })}><Upload size={16} /> Document</button>
                  {canManageCampaigns ? <button className="focus-button secondary" type="button" onClick={() => onArchiveCampaign(row)}><Archive size={16} /> Arhiveaza</button> : null}
                </div>
              </td>
            </tr>
          )) : <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={9}>Nu exista campanii.</td></tr>}
        </tbody>
      </table>
  );
}

function InvoicesTab({
  invoices,
  canRecordPayments,
  onPayment,
  onDocumentTarget
}: {
  invoices: ClientReceivableRow[];
  canRecordPayments: boolean;
  onPayment: (invoice: ClientReceivableRow, mode: "full" | "partial") => void;
  onDocumentTarget: (target: DocumentTarget) => void;
}) {
  return (
    <TableShell title="Facturi / de incasat">
      <table className="w-full min-w-[1180px] text-sm">
        <thead className="sticky top-0 z-10 bg-focus-navy text-left text-xs uppercase text-slate-400">
          <tr><th className="px-3 py-2">Factura</th><th className="px-3 py-2">Client</th><th className="px-3 py-2">Campanie / locatie</th><th className="px-3 py-2">Scadenta</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Incasat</th><th className="px-3 py-2 text-right">Rest</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Actiuni</th></tr>
        </thead>
        <tbody>
          {invoices.length ? invoices.map((row) => (
            <tr className={`border-t border-focus-line ${row.archived ? "opacity-60" : ""}`} key={row.id}>
              <td className="px-3 py-3 font-black text-white">{row.invoiceNumber || "-"}<small className="block text-slate-400">{row.normalizedInvoiceNumber || "-"}</small></td>
              <td className="px-3 py-3">{row.clientName || "-"}<small className="block text-slate-400">{row.companyName}</small></td>
              <td className="px-3 py-3">{row.campaignDetails || "-"}<small className="block text-slate-400">{row.location || ""}</small></td>
              <td className="px-3 py-3">{row.dueDate ? date(row.dueDate) : "-"}</td>
              <td className="px-3 py-3 text-right">{money(row.amount, row.currency)}</td>
              <td className="px-3 py-3 text-right">{money(row.collected, row.currency)}</td>
              <td className="px-3 py-3 text-right font-black">{money(row.remaining, row.currency)}</td>
              <td className="px-3 py-3"><Badge tone={row.archived ? "neutral" : row.status === "overdue" ? "red" : row.status === "due_soon" ? "yellow" : "green"}>{statusLabel(row.status)}</Badge></td>
              <td className="px-3 py-3">
                <div className="flex flex-wrap gap-2">
                  {canRecordPayments && !row.archived ? <button className="focus-button" type="button" onClick={() => onPayment(row, "full")}><CheckCircle2 size={16} /> Incasata</button> : null}
                  {canRecordPayments && !row.archived ? <button className="focus-button secondary" type="button" onClick={() => onPayment(row, "partial")}><CircleDollarSign size={16} /> Partial</button> : null}
                  <button className="focus-button secondary" type="button" onClick={() => onDocumentTarget({ financialReceivableId: row.id, clientId: row.clientId, billingItemId: row.billingItemId, label: row.invoiceNumber || row.clientName || "Factura" })}><Upload size={16} /> Doc</button>
                </div>
              </td>
            </tr>
          )) : <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={9}>Nu exista facturi in raportul activ.</td></tr>}
        </tbody>
      </table>
    </TableShell>
  );
}

function RedecorationModal({
  target,
  form,
  busy,
  onChange,
  onClose,
  onSave
}: {
  target: RedecorationTarget;
  form: RedecorationForm;
  busy: boolean;
  onChange: (form: RedecorationForm) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <EscapeCloseHandler onClose={onClose} enabled={!busy} />
      <div className="focus-card w-full max-w-2xl rounded-lg p-5 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Schimbare vizual</p>
            <h2 className="font-display text-3xl font-black uppercase text-white">{target.rental.locationCode}</h2>
            <p className="mt-1 text-sm font-bold text-slate-300">
              {target.campaign.campaignName || target.campaign.clientName} / {target.campaign.clientName}
            </p>
          </div>
          <button className="focus-button secondary" type="button" onClick={onClose} disabled={busy}>Inchide</button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <Input type="date" label="Data solicitata" value={form.requestedDate} onChange={(requestedDate) => onChange({ ...form, requestedDate })} />
          <Input label="Cost decorare" value={form.cost} onChange={(cost) => onChange({ ...form, cost })} />
          <Select label="Moneda" value={form.currency} onChange={(currency) => onChange({ ...form, currency })}>
            <option value="RON">RON</option>
            <option value="EUR">EUR</option>
          </Select>
          <Select label="Cine suporta costul" value={form.costOwner} onChange={(costOwner) => onChange({ ...form, costOwner })}>
            <option value="client">Client</option>
            <option value="focus_media">Focus Media</option>
            <option value="shared">Impartit</option>
            <option value="unknown">De clarificat</option>
          </Select>
          <Input label="Link brief / fisier" value={form.briefUrl} onChange={(briefUrl) => onChange({ ...form, briefUrl })} />
          <label className="grid gap-1 text-sm font-bold text-slate-200 md:col-span-2">
            Nota pentru implementare
            <textarea className="focus-input min-h-24" value={form.note} onChange={(event) => onChange({ ...form, note: event.target.value })} />
          </label>
        </div>
        <p className="mt-3 text-xs font-bold text-slate-400">
          Redecorarea creeaza doar task operational pentru locatia selectata. Nu genereaza factura sau BillingItem.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button className="focus-button secondary" type="button" onClick={onClose} disabled={busy}>Anuleaza</button>
          <button className="focus-button" type="button" onClick={onSave} disabled={busy || !form.requestedDate}>
            <PlusCircle size={18} /> Adauga redecorare
          </button>
        </div>
      </div>
    </div>
  );
}

function CleanupTab({
  data,
  onMergeClients,
  onArchiveDuplicateInvoice
}: {
  data: ClientCampaignsData;
  onMergeClients: (primaryClientId: string, duplicateClientId: string) => void;
  onArchiveDuplicateInvoice: (primaryInvoiceId: string, duplicateInvoiceId: string) => void;
}) {
  return (
    <div className="grid gap-5">
      <TableShell title="Facturi posibil duplicate">
        <div className="grid gap-3">
          {data.duplicateInvoices.length ? data.duplicateInvoices.map((group) => (
            <div className="rounded-lg border border-focus-line bg-focus-navy/35 p-4" key={group.key}>
              <p className="font-black text-white">{group.normalizedInvoiceNumber} / {group.clientName}</p>
              <div className="mt-3 overflow-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <tbody>
                    {group.invoices.map((invoice, index) => (
                      <tr className="border-t border-focus-line" key={invoice.id}>
                        <td className="px-3 py-2">{invoice.invoiceNumber}</td>
                        <td className="px-3 py-2">{invoice.campaignDetails || "-"}</td>
                        <td className="px-3 py-2">{money(invoice.amount, invoice.currency)}</td>
                        <td className="px-3 py-2">{statusLabel(invoice.status)}</td>
                        <td className="px-3 py-2 text-right">{index > 0 ? <button className="focus-button secondary" type="button" onClick={() => onArchiveDuplicateInvoice(group.invoices[0].id, invoice.id)}><Archive size={16} /> Arhiveaza duplicat</button> : <Badge tone="green">Principal</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )) : <EmptyState text="Nu am gasit facturi duplicate dupa numar normalizat." />}
        </div>
      </TableShell>

      <TableShell title="Clienti posibil dublati">
        <div className="grid gap-3">
          {data.duplicateClients.length ? data.duplicateClients.map((group) => (
            <div className="rounded-lg border border-focus-line bg-focus-navy/35 p-4" key={group.normalizedName}>
              <p className="font-black text-white">{group.normalizedName}</p>
              <div className="mt-3 grid gap-2">
                {group.clients.map((client, index) => (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-focus-line px-3 py-2" key={client.id}>
                    <span><strong>{client.companyName}</strong><small className="block text-slate-400">{client.accountOwnerName || "Owner nesetat"} / {client.campaigns} campanii / {client.invoices} facturi</small></span>
                    {index > 0 ? <button className="focus-button secondary" type="button" onClick={() => onMergeClients(group.clients[0].id, client.id)}><GitMerge size={16} /> Merge in primul</button> : <Badge tone="green">Principal propus</Badge>}
                  </div>
                ))}
              </div>
            </div>
          )) : <EmptyState text="Nu am gasit clienti duplicati dupa nume normalizat." />}
        </div>
      </TableShell>

      <TableShell title="Clienti care par campanii">
        {data.campaignLikeClients.length ? (
          <div className="grid gap-2">
            {data.campaignLikeClients.map((issue) => (
              <div className="rounded-md border border-focus-line bg-focus-navy/35 px-3 py-2" key={issue.clientId}>
                <strong className="text-white">{issue.companyName}</strong>
                <p className="text-sm text-slate-400">{issue.reason}. Corecteaza din tabul Clienti sau combina cu clientul real.</p>
              </div>
            ))}
          </div>
        ) : <EmptyState text="Nu am gasit clienti care sa arate ca denumiri de campanii." />}
      </TableShell>
    </div>
  );
}

function DocumentsTab({
  selected,
  canUploadDocument,
  onDocumentTarget
}: {
  selected: ClientCampaignSummary | null;
  canUploadDocument: boolean;
  onDocumentTarget: (target: DocumentTarget) => void;
}) {
  if (!selected) return <EmptyState text="Alege un client pentru documente." />;
  return (
    <TableShell title={`Arhiva documente: ${selected.companyName}`}>
      <div className="mb-3 flex justify-end">
        {canUploadDocument && selected.clientId ? <button className="focus-button" type="button" onClick={() => onDocumentTarget({ clientId: selected.clientId, label: selected.companyName })}><Upload size={18} /> Incarca document client</button> : null}
      </div>
      <DocumentsList documents={selected.documents} />
    </TableShell>
  );
}

function DocumentsList({ documents }: { documents: ClientCampaignSummary["documents"] }) {
  return (
    <table className="w-full min-w-[760px] text-sm">
      <thead className="sticky top-0 z-10 bg-focus-navy text-left text-xs uppercase text-slate-400">
        <tr><th className="px-3 py-2">Document</th><th className="px-3 py-2">Tip</th><th className="px-3 py-2">Upload</th><th className="px-3 py-2">Expira</th><th className="px-3 py-2">Actiuni</th></tr>
      </thead>
      <tbody>
        {documents.length ? documents.map((document) => (
          <tr className="border-t border-focus-line" key={document.id}>
            <td className="px-3 py-3 font-black text-white">{document.fileName}<small className="block text-slate-400">{document.notes || "-"}</small></td>
            <td className="px-3 py-3">{documentTypeLabel(document.documentType)}</td>
            <td className="px-3 py-3">{date(document.uploadedAt)}<small className="block text-slate-400">{document.uploadedBy || "-"}</small></td>
            <td className="px-3 py-3">{document.expiryDate ? date(document.expiryDate) : "-"}</td>
            <td className="px-3 py-3"><a className="focus-button secondary" href={`/api/admin/client-documents/${document.id}`}><FileArchive size={16} /> Deschide</a></td>
          </tr>
        )) : <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={5}>Nu exista documente.</td></tr>}
      </tbody>
    </table>
  );
}

function DocumentUploadModal({
  target,
  busy,
  onClose,
  onUploaded,
  onError
}: {
  target: DocumentTarget;
  busy: boolean;
  onClose: () => void;
  onUploaded: () => void;
  onError: (message: string) => void;
}) {
  const [documentType, setDocumentType] = useState("contract");
  const [notes, setNotes] = useState("");
  const [storageUrl, setStorageUrl] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function uploadDocument() {
    setSaving(true);
    try {
      const form = new FormData();
      if (target.clientId) form.set("clientId", target.clientId);
      if (target.campaignId) form.set("campaignId", target.campaignId);
      if (target.reservationId) form.set("reservationId", target.reservationId);
      if (target.billingItemId) form.set("billingItemId", target.billingItemId);
      if (target.financialReceivableId) form.set("financialReceivableId", target.financialReceivableId);
      form.set("documentType", documentType);
      if (notes) form.set("notes", notes);
      if (expiryDate) form.set("expiryDate", expiryDate);
      if (storageUrl) form.set("storageUrl", storageUrl);
      if (file) form.set("file", file);
      const response = await fetch("/api/admin/client-documents", { method: "POST", body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Documentul nu a putut fi incarcat.");
      onUploaded();
    } catch (uploadError) {
      onError(uploadError instanceof Error ? uploadError.message : "Documentul nu a putut fi incarcat.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <EscapeCloseHandler onClose={onClose} enabled={!busy && !saving} />
      <div className="w-full max-w-2xl rounded-lg border border-focus-line bg-focus-ink p-5 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Upload document</p>
            <h3 className="font-display text-2xl font-black uppercase text-white">{target.label}</h3>
          </div>
          <button className="focus-button secondary" type="button" onClick={onClose}>Inchide</button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Select label="Tip document" value={documentType} onChange={setDocumentType}>
            <option value="contract">Contract</option>
            <option value="anexa">Anexa</option>
            <option value="io">IO / comanda</option>
            <option value="oferta">Oferta</option>
            <option value="fiscal">Fiscal / CUI</option>
            <option value="other">Alt document</option>
          </Select>
          <Input label="Data expirare" type="date" value={expiryDate} onChange={setExpiryDate} />
          <label className="grid gap-1 text-sm font-bold text-slate-200 md:col-span-2">
            Fisier
            <input className="focus-input" type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} />
          </label>
          <Input label="Sau link document" value={storageUrl} onChange={setStorageUrl} />
          <Input label="Observatii" value={notes} onChange={setNotes} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="focus-button secondary" type="button" onClick={onClose}>Renunta</button>
          <button className="focus-button" type="button" disabled={busy || saving || (!file && !storageUrl)} onClick={uploadDocument}><Upload size={18} /> {saving ? "Se incarca..." : "Salveaza document"}</button>
        </div>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: React.ReactNode; detail?: string }) {
  return <article className="rounded-lg border border-focus-line bg-focus-navy/45 p-4">
    <p className="flex items-center gap-2 text-xs font-black uppercase text-slate-400">{icon}{label}</p>
    <p className="mt-2 font-display text-2xl font-black uppercase text-white">{value}</p>
    {detail ? <p className="mt-1 text-xs font-bold text-slate-400">{detail}</p> : null}
  </article>;
}

function TableShell({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-5">
    <h3 className="mb-3 text-sm font-black uppercase text-focus-yellow">{title}</h3>
    <div className="max-h-[620px] overflow-auto">{children}</div>
  </section>;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`focus-button ${active ? "" : "secondary"}`} type="button" onClick={onClick}>{children}</button>;
}

function Input({ label, value, onChange, disabled, type = "text" }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; type?: string }) {
  return <label className="grid gap-1 text-sm font-bold text-slate-200">{label}
    <input className="focus-input" type={type} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} />
  </label>;
}

function Select({ label, value, onChange, children, disabled }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode; disabled?: boolean }) {
  return <label className="grid gap-1 text-sm font-bold text-slate-200">{label}
    <select className="focus-input" disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
  </label>;
}

function Feedback({ tone, text }: { tone: "green" | "red"; text: string }) {
  const className = tone === "green" ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-red-300/30 bg-red-500/10 text-red-100";
  return <p className={`rounded-lg border px-4 py-3 text-sm font-bold ${className}`}>{text}</p>;
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "yellow" | "red" }) {
  const className = { neutral: "border-slate-400/40 bg-slate-400/10 text-slate-100", green: "border-emerald-300/50 bg-emerald-400/10 text-emerald-100", yellow: "border-focus-yellow/60 bg-focus-yellow/10 text-focus-yellow", red: "border-red-300/50 bg-red-400/10 text-red-100" }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-black uppercase ${className}`}>{children}</span>;
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-lg border border-focus-line bg-focus-navy/35 p-5 text-center text-sm text-slate-400">{text}</p>;
}

function dateInput(value?: string | null) {
  return value ? value.slice(0, 10) : "";
}

function numberInput(value?: number | string | null) {
  if (value == null || value === "") return "";
  return String(value);
}

function nullable(value: string) {
  const text = value.trim();
  return text || null;
}

function upsertSavedClient(data: ClientCampaignsData, savedClient: SavedClientPayload): ClientCampaignsData {
  const key = clientKeyFromId(savedClient.id);
  const existing = data.clients.find((client) => client.key === key);
  const summary: ClientCampaignSummary = {
    key,
    clientId: savedClient.id,
    companyName: savedClient.companyName,
    normalizedName: savedClient.normalizedName || savedClient.companyName.toLowerCase().trim(),
    clientType: savedClient.clientType || existing?.clientType || "direct_client",
    status: savedClient.status || existing?.status || "active",
    taxId: savedClient.taxId ?? existing?.taxId ?? null,
    registryNumber: savedClient.registryNumber ?? existing?.registryNumber ?? null,
    billingAddress: savedClient.billingAddress ?? existing?.billingAddress ?? null,
    generalEmail: savedClient.generalEmail ?? existing?.generalEmail ?? null,
    generalPhone: savedClient.generalPhone ?? existing?.generalPhone ?? null,
    website: savedClient.website ?? existing?.website ?? null,
    accountOwnerUserId: savedClient.accountOwnerUserId ?? existing?.accountOwnerUserId ?? null,
    accountOwnerName: savedClient.accountOwner?.name ?? existing?.accountOwnerName ?? null,
    accountOwnerEmail: savedClient.accountOwner?.email ?? existing?.accountOwnerEmail ?? null,
    notes: savedClient.notes ?? existing?.notes ?? null,
    source: "client",
    contacts: existing?.contacts || [],
    documents: existing?.documents || [],
    campaigns: existing?.campaigns || [],
    receivables: existing?.receivables || [],
    nextDueDate: existing?.nextDueDate || null,
    nextInvoiceDate: existing?.nextInvoiceDate || null,
    latestCampaignEnd: existing?.latestCampaignEnd || null,
    remainingRon: existing?.remainingRon || 0,
    remainingEur: existing?.remainingEur || 0,
    overdueRon: existing?.overdueRon || 0,
    overdueEur: existing?.overdueEur || 0
  };
  const clients = [summary, ...data.clients.filter((client) => client.key !== key)];
  return {
    ...data,
    clients,
    totals: {
      ...data.totals,
      clients: existing ? data.totals.clients : data.totals.clients + 1,
      clientsMissingOwner: existing
        ? data.totals.clientsMissingOwner
        : data.totals.clientsMissingOwner + (summary.accountOwnerUserId ? 0 : 1)
    }
  };
}

function clientKeyFromId(clientId: string) {
  return `client:${clientId}`;
}

function moneyValue(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function integerValue(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function defaultPaymentDays(value: string) {
  if (value === "advance") return 0;
  if (value === "7_days") return 7;
  if (value === "15_days") return 15;
  if (value === "45_days") return 45;
  return 30;
}

function money(value: number, currency?: string | null) {
  return `${new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 0 }).format(value || 0)} ${currency || ""}`.trim();
}

function moneyPair(ron: number, eur: number) {
  return <span className="grid gap-0.5 leading-tight">
    <span>{money(ron, "RON")}</span>
    {eur ? <span>{money(eur, "EUR")}</span> : null}
  </span>;
}

function date(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function paymentTermLabel(type?: string | null, days?: number | null) {
  if (type === "advance") return "Plata in avans";
  if (type === "7_days") return "7 zile";
  if (type === "15_days") return "15 zile";
  if (type === "30_days") return "30 zile";
  if (type === "45_days") return "45 zile";
  if (type === "custom") return `${days ?? 0} zile`;
  return days != null ? `${days} zile` : "Nesetat";
}

function billingRuleLabel(value?: string | null) {
  const labels: Record<string, string> = {
    campaign_start: "Inceput campanie",
    campaign_end: "Final campanie",
    month_start: "Inceput luna",
    month_end: "Final luna",
    monthly_in_advance: "Lunar in avans",
    monthly_after_service: "Lunar dupa prestare",
    upfront_on_contract: "La contract",
    upfront_before_campaign_start: "Inainte de campanie",
    fixed_custom_date: "Data fixa",
    manual_per_contract: "Conform contract"
  };
  return value ? labels[value] || value : "Nesetat";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    in_term: "In termen",
    due_soon: "Scadent curand",
    due_today: "Scadent azi",
    overdue: "Depasit",
    collected: "Incasat",
    collected_partial: "Incasat partial",
    partially_collected: "Incasat partial",
    paid: "Achitat",
    cancelled: "Anulat",
    archived: "Arhivat",
    excluded: "Exclus",
    needs_review: "Needs review"
  };
  return labels[status] || status;
}

function documentTypeLabel(value: string) {
  const labels: Record<string, string> = {
    contract: "Contract",
    anexa: "Anexa",
    io: "IO / comanda",
    oferta: "Oferta",
    fiscal: "Fiscal / CUI",
    other: "Alt document"
  };
  return labels[value] || value;
}
