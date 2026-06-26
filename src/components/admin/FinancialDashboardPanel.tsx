"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, PlusCircle, UploadCloud, XCircle } from "lucide-react";
import type { DashboardData } from "@/lib/dashboard";
import { companyEntities } from "@/lib/company-entities";

type FinancialData = NonNullable<DashboardData["finance"]>;
type FinancialListRow = FinancialData["lists"]["overdueReceivables"][number] | FinancialData["lists"]["overduePayables"][number];
type FinancialTab = "receivable" | "payable" | "overdue" | "upcoming" | "companies" | "review" | "archive" | "uploads";
type FinancialPreview = {
  upload: {
    id: string;
    status: string;
    reportDate: string | null;
    uploadedAt: string;
    originalFileName: string;
  };
  preview: {
    summary: {
      companyCount: number;
      payableRows: number;
      receivableRows: number;
      issueCount: number;
      criticalIssueCount: number;
      needsReviewCount: number;
      ignoredRows: number;
      totalPayable: number;
      totalPaid: number;
      remainingPayable: number;
      totalReceivable: number;
      totalCollected: number;
      remainingReceivable: number;
      totalPayableRon: number;
      totalPayableEur: number;
      totalPaidRon: number;
      totalPaidEur: number;
      remainingPayableRon: number;
      remainingPayableEur: number;
      totalReceivableRon: number;
      totalReceivableEur: number;
      totalCollectedRon: number;
      totalCollectedEur: number;
      remainingReceivableRon: number;
      remainingReceivableEur: number;
    };
    companies: FinancialData["companies"];
    issues: Array<{ issueType: string; issueMessage: string; severity: string; rowNumber: number | null; companyName: string | null; sheetName: string | null }>;
    payablesNeedsReview: Array<{ supplierName: string | null; reviewNote: string | null; rawRowJson: Record<string, unknown> }>;
    receivablesNeedsReview: Array<{ clientName: string | null; reviewNote: string | null; rawRowJson: Record<string, unknown> }>;
  };
};

type ManualFinancialForm = {
  kind: "receivable" | "payable";
  companyName: string;
  clientId: string;
  campaignId: string;
  supplierId: string;
  name: string;
  documentDescription: string;
  invoiceNumber: string;
  invoiceDate: string;
  location: string;
  campaignDetails: string;
  dueDate: string;
  amount: string;
  paidOrCollected: string;
  remaining: string;
  currency: "RON" | "EUR";
  note: string;
};

const emptyManualForm: ManualFinancialForm = {
  kind: "receivable",
  companyName: "Focus Media",
  clientId: "",
  campaignId: "",
  supplierId: "",
  name: "",
  documentDescription: "",
  invoiceNumber: "",
  invoiceDate: "",
  location: "",
  campaignDetails: "",
  dueDate: "",
  amount: "",
  paidOrCollected: "",
  remaining: "",
  currency: "RON",
  note: ""
};

export function FinancialDashboardPanel({ financial }: { financial: DashboardData["finance"] }) {
  const [data, setData] = useState(financial);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FinancialPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [financialTab, setFinancialTab] = useState<FinancialTab>("receivable");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState<ManualFinancialForm>(emptyManualForm);
  const [clients, setClients] = useState<Array<{ id: string; companyName: string }>>([]);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; supplierName: string }>>([]);
  const [campaigns, setCampaigns] = useState<Array<{ id: string; campaignName: string; clientId: string }>>([]);

  const previewHasReviewRows = useMemo(
    () => Boolean(preview && (preview.preview.summary.criticalIssueCount > 0 || preview.preview.summary.needsReviewCount > 0)),
    [preview]
  );

  async function refreshFinancial() {
    const response = await fetch("/api/admin/financial/summary", { cache: "no-store" });
    const payload = await response.json();
    if (response.ok) setData(payload.financial);
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/admin/clients", { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
      fetch("/api/admin/suppliers", { cache: "no-store" }).then((response) => response.ok ? response.json() : null)
    ])
      .then(([clientPayload, supplierPayload]) => {
        if (cancelled) return;
        setClients(clientPayload?.clients || []);
        setSuppliers(supplierPayload?.suppliers || []);
      })
      .catch(() => {
        if (!cancelled) {
          setClients([]);
          setSuppliers([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!manualForm.clientId) {
      setCampaigns([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/admin/campaigns?clientId=${encodeURIComponent(manualForm.clientId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!cancelled) setCampaigns(payload?.campaigns || []);
      })
      .catch(() => {
        if (!cancelled) setCampaigns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [manualForm.clientId]);

  async function uploadReport() {
    if (!file) {
      setError("Alege fisierul Excel pentru import.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/admin/financial/upload", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Raportul nu a putut fi incarcat.");
      setPreview(payload);
      setMessage("Raportul a fost citit. Verifica preview-ul inainte de confirmare.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Raportul nu a putut fi incarcat.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmReport() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/financial/uploads/${preview.upload.id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Raportul nu a putut fi confirmat.");
      setMessage("Raportul financiar a fost confirmat si este acum versiunea activa.");
      setPreview(null);
      await refreshFinancial();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Raportul nu a putut fi confirmat.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelPreview() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/financial/uploads/${preview.upload.id}/confirm`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Importul nu a putut fi anulat.");
      setPreview(null);
      setMessage("Importul a fost anulat. Poti incarca alt fisier.");
      await refreshFinancial();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Importul nu a putut fi anulat.");
    } finally {
      setBusy(false);
    }
  }

  function clearFile() {
    setFile(null);
    setFileInputKey((current) => current + 1);
  }

  async function submitManualEntry() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/financial/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(manualForm)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Randul financiar nu a putut fi introdus.");
      setMessage(manualForm.kind === "receivable" ? "Clientul de incasat a fost adaugat." : "Furnizorul de plata a fost adaugat.");
      setManualForm(emptyManualForm);
      setManualOpen(false);
      await refreshFinancial();
    } catch (manualError) {
      setError(manualError instanceof Error ? manualError.message : "Randul financiar nu a putut fi introdus.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-5">
      <p className="text-sm font-bold text-slate-300">Nu ai acces la modulul financiar.</p>
    </section>;
  }

  return (
    <div className="grid gap-5">
      {message ? <Feedback tone="green" text={message} /> : null}
      {error ? <Feedback tone="red" text={error} /> : null}
      {!data.todayReportLoaded ? (
        <Feedback tone="yellow" text="Raportul financiar de azi nu a fost incarcat." />
      ) : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetric label="Rest de incasat" value={moneyPair(data.kpis.remainingReceivableRon, data.kpis.remainingReceivableEur)} detail="RON si EUR separat" tone="green" />
        <FinanceMetric label="Rest de plata" value={moneyPair(data.kpis.remainingPayableRon, data.kpis.remainingPayableEur)} detail="RON si EUR separat" tone="yellow" />
        <FinanceMetric label="Depasit clienti" value={moneyPair(data.kpis.overdueReceivableRon, data.kpis.overdueReceivableEur)} detail={`${data.kpis.overdueReceivableCount} clienti`} tone="red" />
        <FinanceMetric label="Depasit furnizori" value={moneyPair(data.kpis.overduePayableRon, data.kpis.overduePayableEur)} detail={`${data.kpis.overduePayableCount} furnizori`} tone="red" />
        <FinanceMetric label="Scadent azi clienti" value={moneyPair(data.kpis.dueTodayReceivableRon, data.kpis.dueTodayReceivableEur)} detail="De urmarit azi" />
        <FinanceMetric label="Scadent azi furnizori" value={moneyPair(data.kpis.dueTodayPayableRon, data.kpis.dueTodayPayableEur)} detail="De platit azi" />
        <FinanceMetric label="Urmatoarele 7 zile clienti" value={moneyPair(data.kpis.dueNext7ReceivableRon, data.kpis.dueNext7ReceivableEur)} detail="Cash actionabil" />
        <FinanceMetric label="Urmatoarele 7 zile furnizori" value={moneyPair(data.kpis.dueNext7PayableRon, data.kpis.dueNext7PayableEur)} detail="Plati apropiate" />
      </section>

      <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Upload raport zilnic</p>
            <h2 className="font-display text-2xl font-black uppercase text-white">Financiar</h2>
            <p className="mt-1 text-sm font-bold text-slate-400">
              Ultimul raport activ: {data.activeUpload ? `${data.activeUpload.originalFileName} (${date(data.activeUpload.reportDate || data.activeUpload.uploadedAt)})` : "niciun raport confirmat"}
            </p>
          </div>
          <a className="focus-button secondary" href="/api/admin/financial/export">
            <Download size={18} /> Export financiar
          </a>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <input key={fileInputKey} className="focus-input" type="file" accept=".xlsx,.xls,.xlsm" onChange={(event) => setFile(event.target.files?.[0] || null)} />
          <button className="focus-button secondary" type="button" onClick={clearFile} disabled={busy || !file}>
            <XCircle size={18} /> Sterge fisier
          </button>
          <button className="focus-button" type="button" onClick={uploadReport} disabled={busy}>
            <UploadCloud size={18} /> {busy ? "Se proceseaza..." : "Incarca si previzualizeaza"}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Introducere manuala</p>
            <h2 className="font-display text-2xl font-black uppercase text-white">Adauga incasare sau plata</h2>
            <p className="mt-1 text-sm font-bold text-slate-400">
              Pentru corectii rapide sau luni in care comercialul introduce datele direct in aplicatie. Alege moneda pe fiecare factura.
            </p>
          </div>
          <button className="focus-button secondary" type="button" onClick={() => setManualOpen((current) => !current)}>
            <PlusCircle size={18} /> {manualOpen ? "Inchide" : "Adauga manual"}
          </button>
        </div>
        {manualOpen ? (
          <ManualEntryForm
            form={manualForm}
            busy={busy}
            clients={clients}
            suppliers={suppliers}
            campaigns={campaigns}
            onChange={setManualForm}
            onSubmit={submitManualEntry}
          />
        ) : null}
      </section>

      {preview ? (
        <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase text-focus-yellow">Preview & validation</p>
              <h3 className="text-xl font-black text-white">{preview.upload.originalFileName}</h3>
              <p className="mt-1 text-sm text-slate-400">
                {preview.preview.summary.payableRows} randuri plati, {preview.preview.summary.receivableRows} randuri incasari, {preview.preview.summary.ignoredRows} randuri auxiliare ignorate.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="focus-button secondary" type="button" onClick={cancelPreview} disabled={busy}>
                <XCircle size={18} /> Anuleaza import
              </button>
              <button className="focus-button" type="button" onClick={confirmReport} disabled={busy}>
                <CheckCircle2 size={18} /> Confirma raportul
              </button>
            </div>
          </div>
          {previewHasReviewRows ? (
            <p className="mt-4 flex items-center gap-2 rounded-lg border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-100">
              <AlertTriangle size={18} /> Exista randuri neclare. Corecteaza-le sau exclude-le explicit inainte ca raportul sa devina activ.
            </p>
          ) : null}
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <FinanceMetric label="Rest de incasat" value={moneyPair(preview.preview.summary.remainingReceivableRon, preview.preview.summary.remainingReceivableEur)} detail="calculat din Excel" />
            <FinanceMetric label="Rest de plata" value={moneyPair(preview.preview.summary.remainingPayableRon, preview.preview.summary.remainingPayableEur)} detail="calculat din Excel" />
            <FinanceMetric label="Needs review" value={preview.preview.summary.needsReviewCount} detail={`${preview.preview.summary.criticalIssueCount} critice`} tone={preview.preview.summary.needsReviewCount ? "red" : "green"} />
          </div>
          <CompanyTable rows={preview.preview.companies} />
          <IssuesTable issues={preview.preview.issues} />
        </section>
      ) : null}

      <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {financialTabs.map((tab) => (
              <button key={tab.id} className={`rounded-md px-3 py-2 text-xs font-black uppercase ${financialTab === tab.id ? "bg-focus-yellow text-focus-navy" : "bg-focus-navy/60 text-slate-200"}`} type="button" onClick={() => setFinancialTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>
          <label className="grid min-w-44 gap-1">
            <span className="text-xs font-black uppercase text-slate-400">Moneda</span>
            <select className="focus-input" value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)}>
              <option value="">RON + EUR</option>
              <option value="RON">RON</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
        </div>
        <div className="mt-4">
          {financialTab === "receivable" ? <MoneyTable title="De incasat" rows={filterCurrency(data.lists.topReceivables, currencyFilter)} /> : null}
          {financialTab === "payable" ? <MoneyTable title="De platit" rows={filterCurrency(data.lists.topPayables, currencyFilter)} /> : null}
          {financialTab === "overdue" ? <MoneyTable title="Restante" rows={filterCurrency([...data.lists.overdueReceivables, ...data.lists.overduePayables], currencyFilter)} /> : null}
          {financialTab === "upcoming" ? <MoneyTable title="Scadente urmatoarele 7 zile" rows={filterCurrency([...data.lists.dueSoonReceivables, ...data.lists.dueSoonPayables], currencyFilter)} /> : null}
          {financialTab === "companies" ? <CompanyTable rows={data.companies} compact /> : null}
          {financialTab === "review" ? <MoneyTable title="Needs Review" rows={filterCurrency([...data.lists.needsReviewReceivables, ...data.lists.needsReviewPayables], currencyFilter)} reviewMode onReviewed={refreshFinancial} /> : null}
          {financialTab === "archive" ? <MoneyTable title="Arhiva / fara scadenta" rows={filterCurrency([...data.lists.missingDueReceivables, ...data.lists.missingDuePayables], currencyFilter)} /> : null}
          {financialTab === "uploads" ? <UploadHistory rows={data.uploads} /> : null}
        </div>
      </section>
    </div>
  );
}

const financialTabs: Array<{ id: FinancialTab; label: string }> = [
  { id: "receivable", label: "De incasat" },
  { id: "payable", label: "De platit" },
  { id: "overdue", label: "Restante" },
  { id: "upcoming", label: "Scadente" },
  { id: "companies", label: "Pe firme" },
  { id: "review", label: "Needs Review" },
  { id: "archive", label: "Arhiva" },
  { id: "uploads", label: "Uploaduri" }
];

function ManualEntryForm({
  form,
  busy,
  clients,
  suppliers,
  campaigns,
  onChange,
  onSubmit
}: {
  form: ManualFinancialForm;
  busy: boolean;
  clients: Array<{ id: string; companyName: string }>;
  suppliers: Array<{ id: string; supplierName: string }>;
  campaigns: Array<{ id: string; campaignName: string; clientId: string }>;
  onChange: React.Dispatch<React.SetStateAction<ManualFinancialForm>>;
  onSubmit: () => void;
}) {
  const update = (field: keyof ManualFinancialForm, value: string) => {
    onChange((current) => ({ ...current, [field]: value }));
  };
  return <div className="mt-4 grid gap-3 rounded-lg border border-focus-line bg-focus-navy/35 p-4">
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <label className="grid gap-1 text-sm font-bold text-slate-200">Tip rand
        <select className="focus-input" value={form.kind} onChange={(event) => onChange((current) => ({ ...current, kind: event.target.value as "receivable" | "payable", clientId: "", campaignId: "", supplierId: "", name: "" }))}>
          <option value="receivable">Client / de incasat</option>
          <option value="payable">Furnizor / de platit</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-bold text-slate-200">Firma
        <select className="focus-input" value={form.companyName} onChange={(event) => update("companyName", event.target.value)}>
          {companyEntities.map((entity) => <option key={entity.value} value={entity.value}>{entity.label}</option>)}
        </select>
      </label>
      {form.kind === "receivable" ? (
        <label className="grid gap-1 text-sm font-bold text-slate-200">Client
          <select className="focus-input" value={form.clientId} onChange={(event) => {
            const client = clients.find((item) => item.id === event.target.value);
            onChange((current) => ({ ...current, clientId: event.target.value, campaignId: "", name: client?.companyName || "" }));
          }}>
            <option value="">Alege clientul</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.companyName}</option>)}
          </select>
        </label>
      ) : (
        <label className="grid gap-1 text-sm font-bold text-slate-200">Furnizor
          <select className="focus-input" value={form.supplierId} onChange={(event) => {
            const supplier = suppliers.find((item) => item.id === event.target.value);
            onChange((current) => ({ ...current, supplierId: event.target.value, name: supplier?.supplierName || "" }));
          }}>
            <option value="">Alege furnizorul</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.supplierName}</option>)}
          </select>
        </label>
      )}
      <label className="grid gap-1 text-sm font-bold text-slate-200">Moneda
        <select className="focus-input" value={form.currency} onChange={(event) => update("currency", event.target.value)}>
          <option value="RON">RON</option>
          <option value="EUR">EUR</option>
        </select>
        <span className="text-xs text-slate-400">Totalurile raman separate pe RON si EUR.</span>
      </label>
      <label className="grid gap-1 text-sm font-bold text-slate-200">Numar factura
        <input className="focus-input" value={form.invoiceNumber} onChange={(event) => update("invoiceNumber", event.target.value)} />
      </label>
      <label className="grid gap-1 text-sm font-bold text-slate-200">Data facturii
        <input className="focus-input" type="date" value={form.invoiceDate} onChange={(event) => update("invoiceDate", event.target.value)} />
      </label>
      <label className="grid gap-1 text-sm font-bold text-slate-200">Descriere document
        <input className="focus-input" value={form.documentDescription} onChange={(event) => update("documentDescription", event.target.value)} />
      </label>
      <label className="grid gap-1 text-sm font-bold text-slate-200">Data scadenta
        <input className="focus-input" type="date" value={form.dueDate} onChange={(event) => update("dueDate", event.target.value)} />
      </label>
      <label className="grid gap-1 text-sm font-bold text-slate-200">Suma totala
        <input className="focus-input" inputMode="decimal" value={form.amount} onChange={(event) => update("amount", event.target.value)} />
      </label>
      <label className="grid gap-1 text-sm font-bold text-slate-200">{form.kind === "receivable" ? "Incasat" : "Achitat"}
        <input className="focus-input" inputMode="decimal" value={form.paidOrCollected} onChange={(event) => update("paidOrCollected", event.target.value)} />
      </label>
      <label className="grid gap-1 text-sm font-bold text-slate-200">Rest
        <input className="focus-input" inputMode="decimal" value={form.remaining} onChange={(event) => update("remaining", event.target.value)} placeholder="se calculeaza daca il lasi gol" />
      </label>
      {form.kind === "receivable" ? (
        <>
          <label className="grid gap-1 text-sm font-bold text-slate-200">Locatie
            <input className="focus-input" value={form.location} onChange={(event) => update("location", event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-bold text-slate-200">Campanie optionala
            <select className="focus-input" value={form.campaignId} onChange={(event) => {
              const campaign = campaigns.find((item) => item.id === event.target.value);
              onChange((current) => ({ ...current, campaignId: event.target.value, campaignDetails: campaign?.campaignName || "" }));
            }}>
              <option value="">Fara campanie</option>
              {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.campaignName}</option>)}
            </select>
          </label>
        </>
      ) : null}
    </div>
    <label className="grid gap-1 text-sm font-bold text-slate-200">Observatii
      <textarea className="focus-input min-h-20" value={form.note} onChange={(event) => update("note", event.target.value)} />
    </label>
    <div className="flex flex-wrap items-center gap-3">
      <button className="focus-button" type="button" onClick={onSubmit} disabled={busy || (form.kind === "receivable" ? !form.clientId : !form.supplierId)}>
        <CheckCircle2 size={18} /> {busy ? "Se salveaza..." : "Salveaza manual"}
      </button>
      <p className="text-xs font-bold text-slate-400">Daca nu exista raport activ, se creeaza automat unul manual.</p>
    </div>
  </div>;
}

function FinanceMetric({ label, value, detail, tone = "neutral" }: { label: string; value: React.ReactNode; detail: string; tone?: "neutral" | "green" | "yellow" | "red" }) {
  const toneClass = { neutral: "text-white", green: "text-emerald-200", yellow: "text-focus-yellow", red: "text-red-100" }[tone];
  return <article className="rounded-lg border border-focus-line bg-focus-ink/55 p-4">
    <p className="text-xs font-black uppercase text-slate-400">{label}</p>
    <p className={`mt-2 font-display text-2xl font-black uppercase ${toneClass}`}>{value}</p>
    <p className="mt-1 text-xs font-bold text-slate-400">{detail}</p>
  </article>;
}

function CompanyTable({ rows, compact = false }: { rows: FinancialData["companies"]; compact?: boolean }) {
  return <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-5">
    <h3 className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-focus-yellow"><FileSpreadsheet size={18} /> Pe firme</h3>
    <div className={compact ? "max-h-[460px] overflow-auto" : "overflow-x-auto"}>
      <table className="w-full min-w-[760px] text-sm">
        <thead className="sticky top-0 z-10 bg-focus-navy text-left text-xs uppercase text-slate-400">
          <tr><th className="px-3 py-2">Firma</th><th className="px-3 py-2">Rest incasat</th><th className="px-3 py-2">Rest plata</th><th className="px-3 py-2">Incasat</th><th className="px-3 py-2">Achitat</th><th className="px-3 py-2">Probleme</th></tr>
        </thead>
        <tbody>{rows.length ? rows.map((row) => <tr className="border-t border-focus-line" key={row.companyCode || row.companyName}>
          <td className="px-3 py-3 font-black text-white">{row.companyName}<small className="block text-slate-400">{row.receivableRows} incasari / {row.payableRows} plati</small></td>
          <td className="px-3 py-3">{moneyPair(row.remainingReceivableRon, row.remainingReceivableEur)}</td>
          <td className="px-3 py-3">{moneyPair(row.remainingPayableRon, row.remainingPayableEur)}</td>
          <td className="px-3 py-3">{moneyPair(row.totalCollectedRon, row.totalCollectedEur)}</td>
          <td className="px-3 py-3">{moneyPair(row.totalPaidRon, row.totalPaidEur)}</td>
          <td className="px-3 py-3">{row.issueCount}</td>
        </tr>) : <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={6}>Nu exista raport financiar confirmat.</td></tr>}</tbody>
      </table>
    </div>
  </section>;
}

function MoneyTable({ title, rows, reviewMode = false, onReviewed }: { title: string; rows: FinancialListRow[]; reviewMode?: boolean; onReviewed?: () => Promise<void> }) {
  return <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-5">
    <h3 className="mb-3 text-sm font-black uppercase text-focus-yellow">{title}</h3>
    <div className="max-h-[520px] overflow-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="sticky top-0 z-10 bg-focus-navy text-left text-xs uppercase text-slate-400">
          <tr><th className="px-3 py-2">Nume</th><th className="px-3 py-2">Firma</th><th className="px-3 py-2">Scadenta</th><th className="px-3 py-2">Rest</th><th className="px-3 py-2">Status</th>{reviewMode ? <th className="px-3 py-2">Review</th> : null}</tr>
        </thead>
        <tbody>{rows.length ? rows.map((row) => <tr className="border-t border-focus-line" key={row.id}>
          <td className="px-3 py-3 font-black text-white">{row.name}<small className="block max-w-80 truncate text-slate-400">{row.description || row.reviewNote || "-"}</small></td>
          <td className="px-3 py-3">{row.companyName}</td>
          <td className="px-3 py-3">{row.dueDate ? date(row.dueDate) : "-"}</td>
          <td className="px-3 py-3 text-right font-black">{money(row.remaining, row.currency)}</td>
          <td className="px-3 py-3"><Badge tone={row.needsReview ? "red" : row.status === "overdue" ? "red" : row.status === "due_soon" ? "yellow" : "neutral"}>{statusLabel(row.status)}</Badge></td>
          {reviewMode ? <td className="px-3 py-3"><ReviewActions row={row} onReviewed={onReviewed} /></td> : null}
        </tr>) : <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={reviewMode ? 6 : 5}>Nu exista randuri pentru aceasta lista.</td></tr>}</tbody>
      </table>
    </div>
  </section>;
}

function ReviewActions({ row, onReviewed }: { row: FinancialListRow; onReviewed?: () => Promise<void> }) {
  const details = row as FinancialListRow & {
    documentDescription?: string | null;
    invoiceNumber?: string | null;
    location?: string | null;
    campaignDetails?: string | null;
  };
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    rowType: string;
    name: string;
    documentDescription: string;
    invoiceNumber: string;
    location: string;
    campaignDetails: string;
    dueDate: string;
    amount: string;
    paidOrCollected: string;
    remaining: string;
    currency: string;
    excludeReason: string;
    reviewNote: string;
  }>({
    rowType: row.kind,
    name: row.name || "",
    documentDescription: details.documentDescription || row.description || "",
    invoiceNumber: details.invoiceNumber || "",
    location: details.location || "",
    campaignDetails: details.campaignDetails || "",
    dueDate: row.dueDate ? row.dueDate.slice(0, 10) : "",
    amount: row.amount ? String(row.amount) : "",
    paidOrCollected: row.paidOrCollected ? String(row.paidOrCollected) : "",
    remaining: row.remaining ? String(row.remaining) : "",
    currency: row.currency || "",
    excludeReason: row.reviewNote || "Rand auxiliar/total",
    reviewNote: row.reviewNote || "Corectat manual din dashboard financiar."
  });

  async function save(includeInReport: boolean) {
    if (includeInReport && form.currency !== "RON" && form.currency !== "EUR") {
      window.alert("Alege moneda randului: RON sau EUR.");
      return;
    }
    setSaving(true);
    const response = await fetch(`/api/admin/financial/rows/${row.kind}/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        includeInReport,
        rowType: includeInReport ? form.rowType : "excluded",
        name: form.name || null,
        description: form.documentDescription || null,
        invoiceNumber: form.invoiceNumber || null,
        location: form.location || null,
        campaignDetails: form.campaignDetails || null,
        dueDate: form.dueDate || null,
        amount: form.amount || null,
        paidOrCollected: form.paidOrCollected || null,
        remaining: form.remaining || null,
        currency: form.currency || null,
        reviewNote: includeInReport ? form.reviewNote : undefined,
        excludeReason: includeInReport ? undefined : form.excludeReason
      })
    });
    const payload = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) {
      window.alert(payload?.error || "Randul nu a putut fi actualizat.");
      return;
    }
    setOpen(false);
    await onReviewed?.();
  }

  return <div className="grid gap-2">
    <div className="flex flex-wrap gap-2">
      <button className="focus-button secondary" type="button" onClick={() => setOpen((current) => !current)}>{open ? "Inchide" : "Corecteaza"}</button>
      <button className="focus-button secondary" type="button" disabled={saving} onClick={() => save(false)}>Exclude</button>
    </div>
    {open ? (
      <div className="grid min-w-[520px] gap-2 rounded-lg border border-focus-line bg-focus-navy/65 p-3">
        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-1 text-xs font-bold text-slate-300">Tip rand
            <select className="focus-input" value={form.rowType} onChange={(event) => setForm((current) => ({ ...current, rowType: event.target.value }))}>
              <option value="payable">Furnizor / plata</option>
              <option value="receivable">Client / incasare</option>
              <option value="total">Total</option>
              <option value="guarantee">Garantie</option>
              <option value="loan">Imprumut</option>
              <option value="note">Observatie</option>
              <option value="other">Alt tip</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-bold text-slate-300">Moneda
            <select className="focus-input" value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}>
              <option value="">Alege moneda</option>
              <option value="RON">RON</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-bold text-slate-300">Client / furnizor
            <input className="focus-input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label className="grid gap-1 text-xs font-bold text-slate-300">Scadenta
            <input className="focus-input" type="date" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} />
          </label>
          <label className="grid gap-1 text-xs font-bold text-slate-300">Suma
            <input className="focus-input" inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} />
          </label>
          <label className="grid gap-1 text-xs font-bold text-slate-300">{row.kind === "payable" ? "Achitat" : "Incasat"}
            <input className="focus-input" inputMode="decimal" value={form.paidOrCollected} onChange={(event) => setForm((current) => ({ ...current, paidOrCollected: event.target.value }))} />
          </label>
          <label className="grid gap-1 text-xs font-bold text-slate-300">Rest
            <input className="focus-input" inputMode="decimal" value={form.remaining} onChange={(event) => setForm((current) => ({ ...current, remaining: event.target.value }))} />
          </label>
          {row.kind === "receivable" ? (
            <label className="grid gap-1 text-xs font-bold text-slate-300">Factura
              <input className="focus-input" value={form.invoiceNumber} onChange={(event) => setForm((current) => ({ ...current, invoiceNumber: event.target.value }))} />
            </label>
          ) : null}
        </div>
        {row.kind === "receivable" ? (
          <div className="grid gap-2 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-bold text-slate-300">Locatie
              <input className="focus-input" value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} />
            </label>
            <label className="grid gap-1 text-xs font-bold text-slate-300">Campanie
              <input className="focus-input" value={form.campaignDetails} onChange={(event) => setForm((current) => ({ ...current, campaignDetails: event.target.value }))} />
            </label>
          </div>
        ) : (
          <label className="grid gap-1 text-xs font-bold text-slate-300">Descriere document
            <input className="focus-input" value={form.documentDescription} onChange={(event) => setForm((current) => ({ ...current, documentDescription: event.target.value }))} />
          </label>
        )}
        <label className="grid gap-1 text-xs font-bold text-slate-300">Nota review
          <textarea className="focus-input min-h-20" value={form.reviewNote} onChange={(event) => setForm((current) => ({ ...current, reviewNote: event.target.value }))} />
        </label>
        <details className="rounded-md border border-focus-line bg-focus-ink/40 p-2 text-xs text-slate-300">
          <summary className="cursor-pointer font-black text-focus-yellow">Rand brut din Excel</summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{JSON.stringify(row.rawRowJson || {}, null, 2)}</pre>
        </details>
        <div className="flex flex-wrap gap-2">
          <button className="focus-button" type="button" disabled={saving} onClick={() => save(true)}>Salveaza corectia</button>
          <label className="grid min-w-64 gap-1 text-xs font-bold text-slate-300">Motiv excludere
            <input className="focus-input" value={form.excludeReason} onChange={(event) => setForm((current) => ({ ...current, excludeReason: event.target.value }))} />
          </label>
        </div>
      </div>
    ) : null}
  </div>;
}

function UploadHistory({ rows }: { rows: FinancialData["uploads"] }) {
  return <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-5">
    <h3 className="mb-3 text-sm font-black uppercase text-focus-yellow">Istoric uploaduri</h3>
    <div className="grid gap-2">{rows.length ? rows.map((row) => <div className="grid gap-2 rounded-md border border-focus-line bg-focus-navy/40 p-3 text-sm md:grid-cols-[1fr_auto]" key={row.id}>
      <span><strong className="text-white">{row.originalFileName}</strong><small className="block text-slate-400">{row.uploadedBy || "Necunoscut"} / {dateTime(row.uploadedAt)}</small></span>
      <Badge tone={row.activeVersion ? "green" : row.status === "needs_review" || row.status === "failed" ? "red" : "neutral"}>{row.status}</Badge>
    </div>) : <p className="rounded-lg border border-focus-line bg-focus-navy/35 p-5 text-center text-sm text-slate-400">Nu exista uploaduri.</p>}</div>
  </section>;
}

function IssuesTable({ issues }: { issues: FinancialPreview["preview"]["issues"] }) {
  return <section className="mt-4 rounded-lg border border-focus-line bg-focus-navy/35 p-4">
    <h4 className="text-sm font-black uppercase text-focus-yellow">Intrebari de clarificat</h4>
    <div className="mt-3 grid gap-2">
      {issues.length ? issues.slice(0, 12).map((issue, index) => <div className="rounded-md border border-focus-line bg-focus-ink/45 p-3 text-sm" key={`${issue.issueType}-${issue.rowNumber}-${index}`}>
        <strong className={issue.severity === "critical" ? "text-red-100" : "text-slate-100"}>{issue.issueMessage}</strong>
        <span className="block text-xs text-slate-400">{[issue.companyName, issue.sheetName, issue.rowNumber ? `rand ${issue.rowNumber}` : null, issue.issueType].filter(Boolean).join(" / ")}</span>
      </div>) : <p className="text-sm text-slate-400">Nu exista probleme critice detectate.</p>}
    </div>
  </section>;
}

function Feedback({ tone, text }: { tone: "green" | "red" | "yellow"; text: string }) {
  const Icon = tone === "green" ? CheckCircle2 : tone === "red" ? XCircle : AlertTriangle;
  const className = tone === "green"
    ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
    : tone === "red"
      ? "border-red-300/30 bg-red-500/10 text-red-100"
      : "border-focus-yellow/30 bg-focus-yellow/10 text-focus-yellow";
  return <p className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-bold ${className}`}><Icon size={18} /> {text}</p>;
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "yellow" | "red" }) {
  const className = { neutral: "border-slate-400/40 bg-slate-400/10 text-slate-100", green: "border-emerald-300/50 bg-emerald-400/10 text-emerald-100", yellow: "border-focus-yellow/60 bg-focus-yellow/10 text-focus-yellow", red: "border-red-300/50 bg-red-400/10 text-red-100" }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-black uppercase ${className}`}>{children}</span>;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    in_term: "In termen",
    due_soon: "Scadent curand",
    due_today: "Scadent azi",
    overdue: "Depasit",
    paid: "Achitat",
    paid_full: "Achitat integral",
    paid_partial: "Achitat partial",
    collected: "Incasat",
    collected_full: "Incasat integral",
    collected_partial: "Incasat partial",
    needs_review: "Needs review"
  };
  return labels[status] || status;
}

function money(value: number, currency?: string | null) {
  return `${new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 0 }).format(value || 0)} ${currency || ""}`.trim();
}

function moneyPair(ron: number, eur: number) {
  return <span className="grid gap-1 text-lg leading-tight">
    <span>{money(ron, "RON")}</span>
    <span>{money(eur, "EUR")}</span>
  </span>;
}

function filterCurrency<T extends { currency?: string | null }>(rows: T[], currency: string) {
  return currency ? rows.filter((row) => row.currency === currency || !row.currency) : rows;
}

function date(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" }).format(new Date(value));
}
