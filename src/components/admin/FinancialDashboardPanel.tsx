"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, PlusCircle, UploadCloud, XCircle } from "lucide-react";
import type { DashboardData } from "@/lib/dashboard";
import { companyEntities } from "@/lib/company-entities";

type FinancialData = NonNullable<DashboardData["finance"]>;
type FinancialListRow = FinancialData["lists"]["overdueReceivables"][number] | FinancialData["lists"]["overduePayables"][number];
type FinancialTab = "receivable" | "payable" | "overdue" | "upcoming" | "companies" | "review" | "archive" | "uploads";
type SmartBillReportType = "customer_invoices" | "supplier_documents";
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

type SmartBillPreview = {
  reportType: SmartBillReportType;
  companyName: string;
  companyCode: string;
  fileName: string;
  fileHash: string;
  generatedAt: string;
  detectedColumns: string[];
  importToken: string;
  summary: {
    rowCount: number;
    matchedCount: number;
    createClientCount: number;
    createSupplierCount: number;
    duplicateCount: number;
    needsReviewCount: number;
    invalidCount: number;
    ignoredCount: number;
    autoLinkedAdjustmentCount: number;
    adjustmentNeedsReviewCount: number;
    totalReceivable: number;
    totalPayable: number;
    totalReceivableByCurrency: Record<string, number>;
    totalPayableByCurrency: Record<string, number>;
    buckets: Record<string, number>;
  };
  rows: Array<{
    rowNumber: number;
    sheetName: string;
    kind: "customer_invoice" | "supplier_document";
    entityKind: "client" | "supplier";
    entityName: string;
    fiscalCode: string | null;
    normalizedFiscalCode: string | null;
    documentNumber: string;
    issueDate: string | null;
    dueDate: string | null;
    sourceStatus: string | null;
    mappedStatus: string;
    currency: string | null;
    netAmount: number;
    vatAmount: number;
    totalAmount: number;
    matchedEntityId: string | null;
    matchedEntityName: string | null;
    duplicateId: string | null;
    adjustmentKind: string | null;
    linkedFinancialRowId: string | null;
    linkedDocumentNumber: string | null;
    matchConfidence: "high" | "medium" | "low" | null;
    adjustmentReason: string | null;
    adjustmentCandidates: Array<{
      id: string;
      documentNumber: string | null;
      entityName: string | null;
      issueDate: string | null;
      dueDate: string | null;
      currency: string | null;
      totalAmount: number;
      remainingAmount: number;
      matchConfidence: "high" | "medium" | "low";
      reason: string;
    }>;
    proposedAction: string;
    warning: string | null;
    errors: string[];
    dedupeKey: string;
  }>;
};

type SmartBillManualAction = {
  dedupeKey: string;
  rowNumber: number;
  action: "skip" | "match_existing" | "create_new" | "link_adjustment";
  entityId?: string;
  linkedFinancialRowId?: string;
  reason?: string;
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
  const [smartBillFile, setSmartBillFile] = useState<File | null>(null);
  const [smartBillReportType, setSmartBillReportType] = useState<SmartBillReportType>("customer_invoices");
  const [smartBillCompanyName, setSmartBillCompanyName] = useState("");
  const [smartBillPreview, setSmartBillPreview] = useState<SmartBillPreview | null>(null);
  const [smartBillManualActions, setSmartBillManualActions] = useState<Record<string, SmartBillManualAction>>({});
  const [smartBillConfirmOpen, setSmartBillConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [financialTab, setFinancialTab] = useState<FinancialTab>("receivable");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [smartBillFileInputKey, setSmartBillFileInputKey] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState<ManualFinancialForm>(emptyManualForm);
  const [clients, setClients] = useState<Array<{ id: string; companyName: string }>>([]);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; supplierName: string }>>([]);
  const [campaigns, setCampaigns] = useState<Array<{ id: string; campaignName: string; clientId: string }>>([]);

  const previewHasReviewRows = useMemo(
    () => Boolean(preview && (preview.preview.summary.criticalIssueCount > 0 || preview.preview.summary.needsReviewCount > 0)),
    [preview]
  );
  const smartBillReviewState = useMemo(
    () => smartBillPreview ? summarizeSmartBillManualState(smartBillPreview, smartBillManualActions) : {
      importableRows: 0,
      manualImportRows: 0,
      manualSkippedRows: 0,
      unresolvedReviewRows: 0,
      invalidManualRows: 0
    },
    [smartBillPreview, smartBillManualActions]
  );
  const smartBillImportableRows = smartBillReviewState.importableRows;
  const smartBillSkippedRows = smartBillPreview
    ? smartBillPreview.summary.duplicateCount + smartBillPreview.summary.needsReviewCount + smartBillPreview.summary.adjustmentNeedsReviewCount + smartBillPreview.summary.invalidCount + smartBillPreview.summary.ignoredCount
    : 0;
  const smartBillHasReviewWarning = Boolean(smartBillPreview && (smartBillPreview.summary.invalidCount || smartBillPreview.summary.needsReviewCount || smartBillPreview.summary.adjustmentNeedsReviewCount));
  const smartBillCanConfirm = Boolean(
    smartBillPreview?.importToken &&
    smartBillCompanyName &&
    smartBillPreview.companyName === smartBillCompanyName &&
    smartBillImportableRows > 0 &&
    smartBillReviewState.invalidManualRows === 0
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

  function clearSmartBillFile() {
    setSmartBillFile(null);
    setSmartBillPreview(null);
    setSmartBillManualActions({});
    setSmartBillConfirmOpen(false);
    setSmartBillFileInputKey((current) => current + 1);
  }

  async function previewSmartBillImport() {
    if (!smartBillCompanyName) {
      setError("Alege firma pentru importul SmartBill.");
      return;
    }
    if (!smartBillFile) {
      setError("Alege raportul SmartBill Excel.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("file", smartBillFile);
      form.set("reportType", smartBillReportType);
      form.set("companyName", smartBillCompanyName);
      const response = await fetch("/api/admin/financial/smartbill/preview", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Raportul SmartBill nu a putut fi previzualizat.");
      setSmartBillPreview(payload.preview);
      setSmartBillManualActions({});
      setSmartBillConfirmOpen(false);
      setMessage("Preview SmartBill generat. Verifica randurile inainte de confirmare.");
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Raportul SmartBill nu a putut fi previzualizat.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSmartBillImport() {
    if (!smartBillPreview || !smartBillCanConfirm) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/financial/smartbill/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          importToken: smartBillPreview.importToken,
          reportType: smartBillPreview.reportType,
          companyName: smartBillCompanyName,
          manualActions: Object.values(smartBillManualActions)
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Importul SmartBill nu a putut fi confirmat.");
      const summary = payload.summary;
      setMessage(`Import SmartBill confirmat: ${summary.createdReceivables + summary.createdPayables} randuri create, ${summary.updatedReceivables + summary.updatedPayables} actualizate, ${summary.skippedDuplicates + summary.skippedNeedsReview + summary.skippedInvalid + summary.skippedIgnored + summary.skippedUnsafe} sarite.`);
      setSmartBillPreview(null);
      setSmartBillManualActions({});
      setSmartBillConfirmOpen(false);
      clearSmartBillFile();
      await refreshFinancial();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Importul SmartBill nu a putut fi confirmat.");
    } finally {
      setBusy(false);
    }
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
            <p className="text-xs font-black uppercase text-focus-yellow">Import SmartBill</p>
            <h2 className="font-display text-2xl font-black uppercase text-white">Facturi clienti si documente furnizori</h2>
            <p className="mt-1 text-sm font-bold text-slate-400">
              Importul SmartBill ruleaza mereu cu preview: potriveste clientii/furnizorii dupa CUI/CIF sau nume, apoi confirma doar randurile sigure.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[220px_260px_1fr_auto_auto]">
          <label className="grid gap-1 text-sm font-bold text-slate-200">
            Tip raport
            <select className="focus-input" value={smartBillReportType} onChange={(event) => {
              setSmartBillReportType(event.target.value as SmartBillReportType);
              setSmartBillPreview(null);
              setSmartBillManualActions({});
              setSmartBillConfirmOpen(false);
            }}>
              <option value="customer_invoices">Facturi clienti</option>
              <option value="supplier_documents">Documente furnizori</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-bold text-slate-200">
            Firma import
            <select className="focus-input" required value={smartBillCompanyName} onChange={(event) => {
              setSmartBillCompanyName(event.target.value);
              setSmartBillPreview(null);
              setSmartBillManualActions({});
              setSmartBillConfirmOpen(false);
            }}>
              <option value="">Alege firma</option>
              {companyEntities.map((entity) => <option key={entity.value} value={entity.value}>{entity.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-bold text-slate-200">
            Fisier Excel SmartBill
            <input key={smartBillFileInputKey} className="focus-input" type="file" accept=".xlsx,.xls,.xlsm" onChange={(event) => {
              setSmartBillFile(event.target.files?.[0] || null);
              setSmartBillPreview(null);
              setSmartBillManualActions({});
              setSmartBillConfirmOpen(false);
            }} />
          </label>
          <button className="focus-button secondary self-end" type="button" onClick={clearSmartBillFile} disabled={busy || (!smartBillFile && !smartBillPreview)}>
            <XCircle size={18} /> Sterge
          </button>
          <button className="focus-button self-end" type="button" onClick={previewSmartBillImport} disabled={busy || !smartBillFile || !smartBillCompanyName}>
            <FileSpreadsheet size={18} /> {busy ? "Se citeste..." : "Previzualizeaza"}
          </button>
        </div>
        {smartBillPreview ? (
          <div className="mt-5 rounded-lg border border-focus-line bg-focus-navy/35 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-white">{smartBillPreview.fileName}</h3>
                <p className="mt-1 text-xs font-bold text-slate-400">
                  Firma selectata: <strong className="text-slate-100">{smartBillPreview.companyName}</strong> ({smartBillPreview.companyCode}) ·{" "}
                  Coloane detectate: {smartBillPreview.detectedColumns.join(", ")}
                </p>
              </div>
              <button className="focus-button" type="button" onClick={() => setSmartBillConfirmOpen(true)} disabled={busy || !smartBillCanConfirm}>
                <CheckCircle2 size={18} /> Confirma randurile sigure
              </button>
            </div>
            {smartBillHasReviewWarning ? (
              <div className="mt-4">
                <Feedback tone="yellow" text={`${smartBillPreview.summary.invalidCount + smartBillPreview.summary.needsReviewCount + smartBillPreview.summary.adjustmentNeedsReviewCount} randuri sunt invalide sau necesita verificare. Le poti exclude, potrivi manual sau lasa neimportate.`} />
              </div>
            ) : null}
            {smartBillReviewState.invalidManualRows ? (
              <div className="mt-4">
                <Feedback tone="red" text={`${smartBillReviewState.invalidManualRows} corectii manuale sunt incomplete. Alege client/furnizor/factura sau sterge actiunea manuala inainte de confirmare.`} />
              </div>
            ) : null}
            <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <FinanceMetric label="Firma" value={smartBillPreview.companyName} detail={smartBillPreview.companyCode} />
              <FinanceMetric label="Tip raport" value={smartBillReportTypeLabel(smartBillPreview.reportType)} detail="contextul preview-ului" />
              <FinanceMetric label="Randuri" value={smartBillPreview.summary.rowCount} detail="citite din SmartBill" />
              <FinanceMetric label="Valide" value={smartBillPreview.summary.rowCount - smartBillPreview.summary.invalidCount} detail="cu structura citibila" tone="green" />
              <FinanceMetric label="Potrivite" value={smartBillPreview.summary.matchedCount} detail="client/furnizor existent" tone="green" />
              <FinanceMetric label="De creat" value={smartBillPreview.summary.createClientCount + smartBillPreview.summary.createSupplierCount} detail="clienti/furnizori noi" tone="yellow" />
              <FinanceMetric label="Duplicate" value={smartBillPreview.summary.duplicateCount} detail="nu se vor dubla" tone={smartBillPreview.summary.duplicateCount ? "yellow" : "green"} />
              <FinanceMetric label="Storno auto" value={smartBillPreview.summary.autoLinkedAdjustmentCount} detail="legate la facturi deschise" tone={smartBillPreview.summary.autoLinkedAdjustmentCount ? "yellow" : "green"} />
              <FinanceMetric label="Storno review" value={smartBillPreview.summary.adjustmentNeedsReviewCount} detail="necesita verificare" tone={smartBillPreview.summary.adjustmentNeedsReviewCount ? "red" : "green"} />
              <FinanceMetric label="Review" value={smartBillPreview.summary.needsReviewCount} detail="raman neimportate" tone={smartBillPreview.summary.needsReviewCount ? "red" : "green"} />
              <FinanceMetric label="Invalid" value={smartBillPreview.summary.invalidCount} detail="raman neimportate" tone={smartBillPreview.summary.invalidCount ? "red" : "green"} />
              <FinanceMetric label="Ignorate" value={smartBillPreview.summary.ignoredCount} detail="status neimportabil" tone={smartBillPreview.summary.ignoredCount ? "yellow" : "green"} />
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <FinanceMetric label="Total clienti importabil pe moneda" value={currencyTotals(smartBillPreview.summary.totalReceivableByCurrency)} detail="fara review/duplicate/invalid" />
              <FinanceMetric label="Total furnizori importabil pe moneda" value={currencyTotals(smartBillPreview.summary.totalPayableByCurrency)} detail="fara review/duplicate/invalid" />
            </div>
            <SmartBillManualCorrections
              rows={smartBillPreview.rows}
              actions={smartBillManualActions}
              onChange={setSmartBillManualActions}
            />
            <SmartBillPreviewBuckets
              rows={smartBillPreview.rows}
              clients={clients}
              suppliers={suppliers}
              manualActions={smartBillManualActions}
              onManualActionChange={setSmartBillManualActions}
            />
          </div>
        ) : null}
      </section>
      {smartBillConfirmOpen && smartBillPreview ? (
        <SmartBillConfirmDialog
          preview={smartBillPreview}
          busy={busy}
          importableRows={smartBillImportableRows}
          skippedRows={smartBillSkippedRows}
          manualImportRows={smartBillReviewState.manualImportRows}
          manualSkippedRows={smartBillReviewState.manualSkippedRows}
          unresolvedReviewRows={smartBillReviewState.unresolvedReviewRows}
          canConfirm={smartBillCanConfirm}
          onCancel={() => setSmartBillConfirmOpen(false)}
          onConfirm={confirmSmartBillImport}
        />
      ) : null}

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
          {financialTab === "review" ? <MoneyTable title="Necesita verificare" rows={filterCurrency([...data.lists.needsReviewReceivables, ...data.lists.needsReviewPayables], currencyFilter)} reviewMode onReviewed={refreshFinancial} /> : null}
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
  { id: "review", label: "Necesita verificare" },
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

function SmartBillManualCorrections({
  rows,
  actions,
  onChange
}: {
  rows: SmartBillPreview["rows"];
  actions: Record<string, SmartBillManualAction>;
  onChange: React.Dispatch<React.SetStateAction<Record<string, SmartBillManualAction>>>;
}) {
  const corrected = Object.values(actions)
    .map((action) => ({ action, row: rows.find((item) => smartBillRowKey(item) === smartBillManualActionKey(action)) }))
    .filter((item): item is { action: SmartBillManualAction; row: SmartBillPreview["rows"][number] } => Boolean(item.row));
  if (!corrected.length) return null;
  return <section className="mt-4 rounded-lg border border-focus-line bg-focus-ink/45 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h4 className="text-sm font-black uppercase text-focus-yellow">Corectate manual</h4>
        <p className="mt-1 text-xs font-bold text-slate-400">Aceste alegeri vor fi trimise la confirmare si validate din nou pe server.</p>
      </div>
      <Badge tone="yellow">{corrected.length} randuri</Badge>
    </div>
    <div className="mt-3 grid gap-2">
      {corrected.map(({ action, row }) => (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-focus-line bg-focus-navy/45 p-3 text-sm" key={smartBillManualActionKey(action)}>
          <span>
            <strong className="text-white">#{row.rowNumber} {row.entityName}</strong>
            <small className="block text-slate-400">{row.documentNumber} / {smartBillManualActionLabel(action)}</small>
          </span>
          <button className="focus-button secondary" type="button" onClick={() => onChange((current) => {
            const next = { ...current };
            delete next[smartBillManualActionKey(action)];
            return next;
          })}>Sterge corectia</button>
        </div>
      ))}
    </div>
  </section>;
}

function SmartBillPreviewBuckets({
  rows,
  clients,
  suppliers,
  manualActions,
  onManualActionChange
}: {
  rows: SmartBillPreview["rows"];
  clients: Array<{ id: string; companyName: string }>;
  suppliers: Array<{ id: string; supplierName: string }>;
  manualActions: Record<string, SmartBillManualAction>;
  onManualActionChange: React.Dispatch<React.SetStateAction<Record<string, SmartBillManualAction>>>;
}) {
  const buckets = [
    {
      title: "Se vor asocia automat",
      description: "Clientul sau furnizorul exista deja; se creeaza sau actualizeaza randul financiar sigur.",
      actions: ["AUTO_MATCHED"]
    },
    {
      title: "Se vor crea clienti/furnizori noi",
      description: "Nu exista potrivire sigura, dar randul este valid si poate crea entitatea lipsa la confirmare.",
      actions: ["PROPOSE_CREATE_CLIENT", "PROPOSE_CREATE_SUPPLIER"]
    },
    {
      title: "Storno / discounturi legate automat",
      description: "Documente negative legate sigur la o factura pozitiva deschisa; se aplica doar soldului ramas.",
      actions: ["AUTO_LINK_ADJUSTMENT"]
    },
    {
      title: "Storno / discounturi necesita verificare",
      description: "Documente negative fara legatura suficient de clara; nu se importa automat.",
      actions: ["ADJUSTMENT_NEEDS_REVIEW"]
    },
    {
      title: "Duplicate detectate",
      description: "Aceste randuri par deja introduse si nu se vor importa inca o data.",
      actions: ["DUPLICATE"]
    },
    {
      title: "Necesita verificare",
      description: "Aceste randuri nu se importa automat. Corecteaza cauza si genereaza un preview nou.",
      actions: ["NEEDS_REVIEW"]
    },
    {
      title: "Randuri invalide",
      description: "Aceste randuri au date lipsa sau inconsistente si sunt excluse din confirmare.",
      actions: ["INVALID"]
    },
    {
      title: "Ignorate",
      description: "Randuri cu status neimportabil, de exemplu anulat sau ciorna.",
      actions: ["IGNORED"]
    }
  ];

  return <div className="mt-4 grid gap-4">
    {buckets.map((bucket) => {
      const bucketRows = rows.filter((row) => bucket.actions.includes(row.proposedAction));
      return <SmartBillBucketTable
        key={bucket.title}
        title={bucket.title}
        description={bucket.description}
        rows={bucketRows}
        clients={clients}
        suppliers={suppliers}
        manualActions={manualActions}
        onManualActionChange={onManualActionChange}
      />;
    })}
  </div>;
}

function SmartBillBucketTable({
  title,
  description,
  rows,
  clients,
  suppliers,
  manualActions,
  onManualActionChange
}: {
  title: string;
  description: string;
  rows: SmartBillPreview["rows"];
  clients: Array<{ id: string; companyName: string }>;
  suppliers: Array<{ id: string; supplierName: string }>;
  manualActions: Record<string, SmartBillManualAction>;
  onManualActionChange: React.Dispatch<React.SetStateAction<Record<string, SmartBillManualAction>>>;
}) {
  return <section className="rounded-lg border border-focus-line bg-focus-ink/45 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h4 className="text-sm font-black uppercase text-focus-yellow">{title}</h4>
        <p className="mt-1 text-xs font-bold text-slate-400">{description}</p>
      </div>
      <Badge tone={rows.length ? smartBillActionTone(rows[0].proposedAction) : "neutral"}>{rows.length} randuri</Badge>
    </div>
    <div className="mt-3 max-h-[420px] overflow-auto">
      <table className="w-full min-w-[1320px] text-sm">
        <thead className="sticky top-0 z-10 bg-focus-navy text-left text-xs uppercase text-slate-400">
          <tr>
            <th className="px-3 py-2">Rand</th>
            <th className="px-3 py-2">Client / furnizor</th>
            <th className="px-3 py-2">CIF/CUI original</th>
            <th className="px-3 py-2">CIF/CUI normalizat</th>
            <th className="px-3 py-2">Document</th>
            <th className="px-3 py-2">Emitere</th>
            <th className="px-3 py-2">Scadenta</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 text-right">Net</th>
            <th className="px-3 py-2 text-right">TVA</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2">Moneda</th>
            <th className="px-3 py-2">Actiune propusa</th>
            <th className="px-3 py-2">Potrivire / avertizare</th>
            <th className="px-3 py-2">Corectie manuala</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.slice(0, 120).map((row) => (
            <tr className="border-t border-focus-line" key={`${row.dedupeKey}-${row.rowNumber}`}>
              <td className="px-3 py-3 font-black text-slate-200">#{row.rowNumber}</td>
              <td className="px-3 py-3 font-black text-white">{row.entityName}<small className="block text-slate-400">{row.entityKind === "client" ? "client" : "furnizor"}</small></td>
              <td className="px-3 py-3">{row.fiscalCode || "-"}</td>
              <td className="px-3 py-3">{row.normalizedFiscalCode || "-"}</td>
              <td className="px-3 py-3">{row.documentNumber || "-"}</td>
              <td className="px-3 py-3">{row.issueDate ? date(row.issueDate) : "-"}</td>
              <td className="px-3 py-3">{row.dueDate ? date(row.dueDate) : "-"}</td>
              <td className="px-3 py-3"><span className="text-slate-200">{statusLabel(row.mappedStatus)}</span><small className="block text-slate-500">{row.sourceStatus || "-"}</small></td>
              <td className="px-3 py-3 text-right">{money(row.netAmount, row.currency)}</td>
              <td className="px-3 py-3 text-right">{money(row.vatAmount, row.currency)}</td>
              <td className="px-3 py-3 text-right font-black">{money(row.totalAmount, row.currency)}</td>
              <td className="px-3 py-3">{row.currency || "-"}</td>
              <td className="px-3 py-3"><Badge tone={smartBillActionTone(row.proposedAction)}>{smartBillActionLabel(row.proposedAction)}</Badge></td>
              <td className="px-3 py-3">
                <span className="text-slate-200">{row.matchedEntityName || (row.duplicateId ? "Document existent" : "-")}</span>
                {row.linkedDocumentNumber ? <small className="block text-emerald-100">Factura legata: {row.linkedDocumentNumber}</small> : null}
                {row.matchConfidence ? <small className="block text-slate-400">Incredere: {smartBillConfidenceLabel(row.matchConfidence)}</small> : null}
                {row.adjustmentKind ? <small className="block text-slate-400">Tip ajustare: {smartBillAdjustmentLabel(row.adjustmentKind)}</small> : null}
                {row.adjustmentReason ? <small className="block text-focus-yellow">{row.adjustmentReason}</small> : null}
                {row.warning ? <small className="block text-focus-yellow">{row.warning}</small> : null}
                {row.errors.length ? <small className="block text-red-100">{row.errors.join(" ")}</small> : null}
              </td>
              <td className="px-3 py-3">
                <SmartBillManualActionControl
                  row={row}
                  clients={clients}
                  suppliers={suppliers}
                  action={manualActions[smartBillRowKey(row)]}
                  onChange={onManualActionChange}
                />
              </td>
            </tr>
          )) : <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={15}>Nu exista randuri in aceasta categorie.</td></tr>}
        </tbody>
      </table>
    </div>
    {rows.length > 120 ? <p className="mt-3 text-xs font-bold text-slate-400">Se afiseaza primele 120 de randuri din aceasta categorie. Confirmarea foloseste toate randurile sigure din preview.</p> : null}
  </section>;
}

function SmartBillManualActionControl({
  row,
  clients,
  suppliers,
  action,
  onChange
}: {
  row: SmartBillPreview["rows"][number];
  clients: Array<{ id: string; companyName: string }>;
  suppliers: Array<{ id: string; supplierName: string }>;
  action: SmartBillManualAction | undefined;
  onChange: React.Dispatch<React.SetStateAction<Record<string, SmartBillManualAction>>>;
}) {
  if (!smartBillCanEditManualAction(row)) {
    return <span className="text-xs font-bold text-slate-500">Nu necesita actiune.</span>;
  }
  const key = smartBillRowKey(row);
  const update = (next: SmartBillManualAction | null) => {
    onChange((current) => {
      const copy = { ...current };
      if (!next) delete copy[key];
      else copy[key] = next;
      return copy;
    });
  };
  const base = {
    dedupeKey: row.dedupeKey,
    rowNumber: row.rowNumber
  };
  const selectedAction = action?.action || "";
  const isCustomerAdjustment = row.kind === "customer_invoice" && Boolean(row.adjustmentKind);
  const isSupplierAdjustment = row.kind === "supplier_document" && Boolean(row.adjustmentKind);
  return <div className="grid min-w-64 gap-2">
    <select
      className="focus-input"
      value={selectedAction}
      onChange={(event) => {
        const value = event.target.value as SmartBillManualAction["action"] | "";
        if (!value) {
          update(null);
          return;
        }
        update({ ...base, action: value });
      }}
    >
      <option value="">Fara corectie</option>
      <option value="skip">Exclude din import</option>
      {!row.adjustmentKind ? <option value="match_existing">Potriveste cu existent</option> : null}
      {!row.adjustmentKind && !row.errors.length ? <option value="create_new">Creeaza nou explicit</option> : null}
      {isCustomerAdjustment ? <option value="link_adjustment">Leaga storno la factura</option> : null}
    </select>
    {isSupplierAdjustment ? (
      <small className="text-focus-yellow">Documentele negative de furnizor necesita gestionare manuala momentan. Le poti exclude din import.</small>
    ) : null}
    {selectedAction === "match_existing" ? (
      row.entityKind === "client" ? (
        <select
          className="focus-input"
          value={action?.entityId || ""}
          onChange={(event) => update({ ...base, action: "match_existing", entityId: event.target.value || undefined })}
        >
          <option value="">Alege clientul</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.companyName}</option>)}
        </select>
      ) : (
        <select
          className="focus-input"
          value={action?.entityId || ""}
          onChange={(event) => update({ ...base, action: "match_existing", entityId: event.target.value || undefined })}
        >
          <option value="">Alege furnizorul</option>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.supplierName}</option>)}
        </select>
      )
    ) : null}
    {selectedAction === "link_adjustment" ? (
      <select
        className="focus-input"
        value={action?.linkedFinancialRowId || ""}
        onChange={(event) => update({ ...base, action: "link_adjustment", linkedFinancialRowId: event.target.value || undefined })}
      >
        <option value="">Alege factura pozitiva</option>
        {row.adjustmentCandidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {(candidate.documentNumber || candidate.id)} / rest {money(candidate.remainingAmount, candidate.currency)}
          </option>
        ))}
      </select>
    ) : null}
    {selectedAction === "create_new" ? <small className="text-focus-yellow">Va crea {row.entityKind === "client" ? "clientul" : "furnizorul"} din datele SmartBill.</small> : null}
    {selectedAction === "skip" ? <small className="text-slate-400">Randul va fi sarit explicit la confirmare.</small> : null}
    {row.errors.length && selectedAction && selectedAction !== "skip" ? (
      <small className="text-red-100">Rand invalid: {row.errors.join(" ")}</small>
    ) : null}
  </div>;
}

function SmartBillConfirmDialog({
  preview,
  busy,
  importableRows,
  skippedRows,
  manualImportRows,
  manualSkippedRows,
  unresolvedReviewRows,
  canConfirm,
  onCancel,
  onConfirm
}: {
  preview: SmartBillPreview;
  busy: boolean;
  importableRows: number;
  skippedRows: number;
  manualImportRows: number;
  manualSkippedRows: number;
  unresolvedReviewRows: number;
  canConfirm: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const createEntities = preview.summary.createClientCount + preview.summary.createSupplierCount;
  const reviewRows = preview.summary.needsReviewCount + preview.summary.adjustmentNeedsReviewCount + preview.summary.invalidCount;
  const financialLabel = preview.reportType === "customer_invoices" ? "facturi clienti" : "documente furnizori";
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 py-6">
    <section className="w-full max-w-2xl rounded-lg border border-focus-line bg-focus-ink p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Confirmare SmartBill</p>
          <h3 className="font-display text-2xl font-black uppercase text-white">Confirma importul SmartBill</h3>
          <p className="mt-1 text-sm font-bold text-slate-400">
            Verifica ultima data ce se importa pentru {preview.companyName}. Randurile invalide sau de review nu se importa automat.
          </p>
        </div>
        <button className="focus-button secondary" type="button" onClick={onCancel} disabled={busy}>Inchide</button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <FinanceMetric label="Firma selectata" value={preview.companyName} detail={preview.companyCode} />
        <FinanceMetric label="Tip raport" value={smartBillReportTypeLabel(preview.reportType)} detail={preview.fileName} />
        <FinanceMetric label="Clienti/furnizori noi" value={createEntities} detail="create la confirmare" tone={createEntities ? "yellow" : "green"} />
        <FinanceMetric label={`Randuri ${financialLabel} create/actualizate`} value={importableRows} detail="doar actiuni sigure" tone="green" />
        <FinanceMetric label="Corectate manual" value={manualImportRows} detail="match/create/link ales de tine" tone={manualImportRows ? "yellow" : "green"} />
        <FinanceMetric label="Sarite manual" value={manualSkippedRows} detail="excluse explicit" tone={manualSkippedRows ? "yellow" : "green"} />
        <FinanceMetric label="Randuri sarite" value={skippedRows} detail="duplicate, review, invalid sau ignorate" tone={skippedRows ? "yellow" : "green"} />
        <FinanceMetric label="Necesita verificare" value={reviewRows} detail="nu intra in import automat" tone={reviewRows ? "red" : "green"} />
      </div>
      {reviewRows ? (
        <div className="mt-4">
          <Feedback tone="yellow" text={`${unresolvedReviewRows} randuri raman pentru corectie manuala. Randurile invalide sau necorectate nu vor crea clienti, furnizori, incasari sau plati la confirmare.`} />
        </div>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button className="focus-button secondary" type="button" onClick={onCancel} disabled={busy}>Anuleaza</button>
        <button className="focus-button" type="button" onClick={onConfirm} disabled={busy || !canConfirm}>
          <CheckCircle2 size={18} /> {busy ? "Se confirma..." : "Confirma doar randurile sigure"}
        </button>
      </div>
    </section>
  </div>;
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

function smartBillActionLabel(action: string) {
  const labels: Record<string, string> = {
    AUTO_MATCHED: "Potrivit",
    PROPOSE_CREATE_CLIENT: "Creeaza client",
    PROPOSE_CREATE_SUPPLIER: "Creeaza furnizor",
    AUTO_LINK_ADJUSTMENT: "Storno legat",
    ADJUSTMENT_NEEDS_REVIEW: "Storno review",
    DUPLICATE: "Duplicat",
    NEEDS_REVIEW: "Review",
    INVALID: "Invalid",
    IGNORED: "Ignorat"
  };
  return labels[action] || action;
}

function smartBillReportTypeLabel(reportType: SmartBillReportType) {
  return reportType === "customer_invoices" ? "Facturi clienti" : "Documente furnizori";
}

function smartBillImportableAction(action: string) {
  return action === "AUTO_MATCHED" || action === "PROPOSE_CREATE_CLIENT" || action === "PROPOSE_CREATE_SUPPLIER" || action === "AUTO_LINK_ADJUSTMENT";
}

function summarizeSmartBillManualState(preview: SmartBillPreview, actions: Record<string, SmartBillManualAction>) {
  return preview.rows.reduce((summary, row) => {
    const action = actions[smartBillRowKey(row)];
    if (!action) {
      if (smartBillImportableAction(row.proposedAction)) summary.importableRows += 1;
      if (smartBillNeedsManualReview(row)) summary.unresolvedReviewRows += 1;
      return summary;
    }
    if (action.action === "skip") {
      summary.manualSkippedRows += 1;
      return summary;
    }
    const valid = smartBillManualActionComplete(row, action);
    if (!valid) {
      summary.invalidManualRows += 1;
      return summary;
    }
    summary.importableRows += 1;
    summary.manualImportRows += 1;
    return summary;
  }, {
    importableRows: 0,
    manualImportRows: 0,
    manualSkippedRows: 0,
    unresolvedReviewRows: 0,
    invalidManualRows: 0
  });
}

function smartBillManualActionComplete(row: SmartBillPreview["rows"][number], action: SmartBillManualAction) {
  if (action.action === "skip") return true;
  if (row.errors.length) return false;
  if (row.proposedAction === "DUPLICATE" || row.proposedAction === "IGNORED") return false;
  if (row.adjustmentKind && action.action !== "link_adjustment") return false;
  if (action.action === "match_existing") return Boolean(action.entityId);
  if (action.action === "create_new") return !row.adjustmentKind;
  if (action.action === "link_adjustment") return row.kind === "customer_invoice" && Boolean(row.adjustmentKind && action.linkedFinancialRowId);
  return false;
}

function smartBillCanEditManualAction(row: SmartBillPreview["rows"][number]) {
  return row.proposedAction === "PROPOSE_CREATE_CLIENT" ||
    row.proposedAction === "PROPOSE_CREATE_SUPPLIER" ||
    row.proposedAction === "NEEDS_REVIEW" ||
    row.proposedAction === "ADJUSTMENT_NEEDS_REVIEW" ||
    row.proposedAction === "INVALID";
}

function smartBillNeedsManualReview(row: SmartBillPreview["rows"][number]) {
  return row.proposedAction === "NEEDS_REVIEW" ||
    row.proposedAction === "ADJUSTMENT_NEEDS_REVIEW" ||
    row.proposedAction === "INVALID";
}

function smartBillRowKey(row: SmartBillPreview["rows"][number]) {
  return `${row.dedupeKey}::${row.rowNumber}`;
}

function smartBillManualActionKey(action: SmartBillManualAction) {
  return `${action.dedupeKey}::${action.rowNumber}`;
}

function smartBillManualActionLabel(action: SmartBillManualAction) {
  if (action.action === "skip") return "exclus din import";
  if (action.action === "match_existing") return "potrivire manuala";
  if (action.action === "create_new") return "creare explicita";
  if (action.action === "link_adjustment") return "storno legat manual";
  return action.action;
}

function smartBillActionTone(action: string): "neutral" | "green" | "yellow" | "red" {
  if (action === "AUTO_MATCHED" || action === "AUTO_LINK_ADJUSTMENT") return "green";
  if (action === "PROPOSE_CREATE_CLIENT" || action === "PROPOSE_CREATE_SUPPLIER" || action === "DUPLICATE" || action === "IGNORED") return "yellow";
  if (action === "NEEDS_REVIEW" || action === "ADJUSTMENT_NEEDS_REVIEW" || action === "INVALID") return "red";
  return "neutral";
}

function smartBillAdjustmentLabel(kind: string) {
  const labels: Record<string, string> = {
    CREDIT_NOTE: "Credit note",
    STORNO: "Storno",
    DISCOUNT_ADJUSTMENT: "Discount"
  };
  return labels[kind] || kind;
}

function smartBillConfidenceLabel(value: string) {
  const labels: Record<string, string> = {
    high: "mare",
    medium: "medie",
    low: "scazuta"
  };
  return labels[value] || value;
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
    adjustment: "Ajustare",
    supplier_adjustment: "Ajustare furnizor",
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

function currencyTotals(values: Record<string, number>) {
  const entries = Object.entries(values).filter(([, value]) => value);
  if (!entries.length) return "0";
  return <span className="grid gap-1 text-lg leading-tight">
    {entries.map(([currency, value]) => <span key={currency}>{money(value, currency)}</span>)}
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
