"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  Banknote,
  CalendarClock,
  CircleAlert,
  CircleDollarSign,
  FileClock,
  FileSpreadsheet,
  History,
  Link2,
  Loader2,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Trash2,
  Upload
} from "lucide-react";

type JsonMap = Record<string, any>;
type Workspace = {
  receivables: JsonMap[];
  summary: Array<{
    currency: string;
    invoiceCount: number;
    openCount: number;
    collectedCount: number;
    overdueCount: number;
    inTermCount: number;
    dueSoonCount: number;
    missingDueCount: number;
    invoiced: string;
    collected: string;
    remaining: string;
    overdue: string;
    inTerm: string;
    dueSoon: string;
  }>;
  issuerCompanies: Array<{ companyCode: string | null; companyName: string }>;
  uploads: JsonMap[];
  clients: Array<{ id: string; companyName: string; taxId: string | null }>;
  aliases: JsonMap[];
  payments: JsonMap[];
  credits: JsonMap[];
  campaigns: JsonMap[];
  locations: JsonMap[];
};

const tabs = [
  ["receivables", "Facturi clienți", ReceiptText],
  ["import", "Import nou", Upload],
  ["history", "Istoric importuri", FileClock],
  ["payments", "Istoric încasări", History],
  ["aliases", "Aliasuri clienți", Link2]
] as const;

const groupLabels: Record<string, string> = {
  allocated_auto: "Alocate automat",
  needs_confirmation: "Necesită confirmare",
  manual: "Alocare manuală",
  existing: "Facturi existente",
  updates: "Facturi de actualizat",
  unchanged: "Neschimbate",
  conflict: "Conflicte",
  credit: "Credite / supraplăți",
  ignored: "Ignorate",
  imported: "Importate"
};

export function ReceivablesWorkspace({
  initialWorkspace,
  initialFilters,
  canImport,
  canValidate,
  canConfirm,
  canManage
}: {
  initialWorkspace: Workspace;
  initialFilters?: { query?: string; status?: string; companyCode?: string; currency?: string };
  canImport: boolean;
  canValidate: boolean;
  canConfirm: boolean;
  canManage: boolean;
}) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("receivables");
  const [preview, setPreview] = useState<JsonMap | null>(null);
  const [previewGroup, setPreviewGroup] = useState("allocated_auto");
  const [query, setQuery] = useState(initialFilters?.query || "");
  const [status, setStatus] = useState(initialFilters?.status || "");
  const [companyCode, setCompanyCode] = useState(initialFilters?.companyCode || "");
  const [currency, setCurrency] = useState(initialFilters?.currency || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<JsonMap | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [allocationTarget, setAllocationTarget] = useState<JsonMap | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const allocationMutationRef = useRef(false);

  async function api(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || "Operația nu a putut fi finalizată.");
    return payload;
  }

  async function refresh(nextQuery = query, nextStatus = status, nextCompanyCode = companyCode, nextCurrency = currency) {
    const params = new URLSearchParams({
      q: nextQuery,
      status: nextStatus,
      companyCode: nextCompanyCode,
      currency: nextCurrency,
      take: "100"
    });
    const payload = await api(`/api/admin/receivables-workspace?${params.toString()}`);
    setWorkspace(payload.workspace);
  }

  async function uploadReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canImport) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const payload = await api("/api/admin/receivables-import", { method: "POST", body: new FormData(event.currentTarget) });
      setPreview(payload.preview);
      setPreviewGroup(firstNonEmptyGroup(payload.preview));
      setMessage(payload.duplicate ? "Fișierul exista deja; am deschis importul anterior fără a dubla datele." : "Raport analizat. Nicio creanță nu a fost modificată încă.");
      await refresh();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Raportul nu a putut fi analizat.");
    } finally { setBusy(false); }
  }

  async function openImport(id: string) {
    setBusy(true); setError(null);
    try {
      const payload = await api(`/api/admin/receivables-import/${id}`);
      setPreview(payload.preview);
      setPreviewGroup(firstNonEmptyGroup(payload.preview));
      setTab("import");
    } catch (openError) { setError(openError instanceof Error ? openError.message : "Importul nu a putut fi deschis."); }
    finally { setBusy(false); }
  }

  async function resolveRow(row: JsonMap, action: "confirm" | "create" | "ignore" | "confirm_credit") {
    if (!canValidate || !preview || allocationMutationRef.current) return;
    const select = document.getElementById(`client-${row.id}`) as HTMLSelectElement | null;
    const clientId = select?.value || row.clientId || null;
    const reason = action === "ignore" ? window.prompt("Motivul ignorării") : null;
    if (action === "ignore" && !reason) return;
    const saveAlias = action !== "ignore" && Boolean(clientId) && window.confirm("Salvez denumirea din raport ca alias pentru importurile viitoare?");
    allocationMutationRef.current = true;
    setBusy(true); setError(null); setMessage(null);
    try {
      const payload = await api(`/api/admin/receivables-import/${preview.upload.id}/rows/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, clientId, reason, saveAlias })
      });
      setPreview(payload.preview);
      setPreviewGroup(firstNonEmptyGroup(payload.preview, previewGroup));
      setMessage("Alocarea a fost salvată.");
      await refresh();
    } catch (resolveError) { setError(resolveError instanceof Error ? resolveError.message : "Alocarea nu a putut fi salvată."); }
    finally { allocationMutationRef.current = false; setBusy(false); }
  }

  async function submitAllocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allocationTarget || !preview || !canValidate || allocationMutationRef.current) return;
    const data = new FormData(event.currentTarget);
    const action = String(data.get("action") || "create") as "confirm" | "create" | "confirm_credit";
    const currencyInput = window.prompt("Moneda rândului (RON sau EUR)", String(allocationTarget.currency || "RON"));
    if (currencyInput === null) return;
    const currency = currencyInput.trim().toUpperCase();
    if (!["RON", "EUR"].includes(currency)) {
      setError("Moneda trebuie să fie RON sau EUR.");
      return;
    }
    const reason = String(data.get("reason") || "").trim();
    if (currency !== allocationTarget.currency && !reason) {
      setError("Completează observația / motivul pentru corectarea monedei.");
      return;
    }
    allocationMutationRef.current = true;
    setBusy(true); setError(null); setMessage(null);
    try {
      const payload = await api(`/api/admin/receivables-import/${preview.upload.id}/rows/${allocationTarget.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          companyCode: String(data.get("companyCode") || allocationTarget.companyCode),
          currency,
          clientId: String(data.get("clientId") || "") || null,
          receivableId: String(data.get("receivableId") || "") || null,
          campaignId: String(data.get("campaignId") || "") || null,
          locationId: String(data.get("locationId") || "") || null,
          reason: reason || null,
          saveAlias: data.get("saveAlias") === "on"
        })
      });
      setPreview(payload.preview);
      setAllocationTarget(null);
      setPreviewGroup(firstNonEmptyGroup(payload.preview, previewGroup));
      setMessage("Alocarea manuală a fost salvată.");
      await refresh();
    } catch (allocationError) { setError(allocationError instanceof Error ? allocationError.message : "Alocarea nu a putut fi salvată."); }
    finally { allocationMutationRef.current = false; setBusy(false); }
  }

  async function confirmImport() {
    if (!canConfirm || !preview || !window.confirm("Confirm importul? Creanțele și diferențele de încasare vor fi reconciliate tranzacțional.")) return;
    setBusy(true); setError(null);
    try {
      const payload = await api(`/api/admin/receivables-import/${preview.upload.id}/confirm`, { method: "POST" });
      setPreview(payload.preview);
      setMessage(`Import confirmat: ${payload.result.created} create, ${payload.result.updated} actualizate, ${payload.result.unchanged} neschimbate, ${payload.result.ignored} ignorate.`);
      await refresh();
    } catch (confirmError) { setError(confirmError instanceof Error ? confirmError.message : "Importul nu a putut fi confirmat."); }
    finally { setBusy(false); }
  }

  async function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentTarget) return;
    setBusy(true); setError(null);
    try {
      const data = new FormData(event.currentTarget);
      const body = {
        amount: String(data.get("amount") || ""),
        receivedAt: String(data.get("receivedAt") || ""),
        paymentMethod: String(data.get("paymentMethod") || "") || null,
        paymentReference: String(data.get("paymentReference") || "") || null,
        notes: String(data.get("notes") || "") || null,
        confirmOverpayment: data.get("confirmOverpayment") === "on",
        requestKey: crypto.randomUUID()
      };
      const payload = await api(`/api/admin/receivables/${paymentTarget.id}/payments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      setWorkspace((current) => ({
        ...current,
        receivables: current.receivables.map((row) => row.id === paymentTarget.id ? { ...row, ...payload.receivable } : row),
        payments: payload.payment ? [payload.payment, ...current.payments].slice(0, 100) : current.payments
      }));
      setPaymentTarget(null);
      setPaymentAmount("");
      setMessage("Încasarea a fost înregistrată și soldul a fost recalculat.");
      await refresh();
    } catch (paymentError) { setError(paymentError instanceof Error ? paymentError.message : "Încasarea nu a putut fi salvată."); }
    finally { setBusy(false); }
  }

  async function cancelPayment(payment: JsonMap) {
    const reason = window.prompt("Motivul anulării încasării");
    if (!reason) return;
    setBusy(true); setError(null);
    try {
      await api(`/api/admin/receivables/payments/${payment.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
      setMessage("Încasarea a fost anulată; istoricul a fost păstrat.");
      await refresh();
    } catch (cancelError) { setError(cancelError instanceof Error ? cancelError.message : "Încasarea nu a putut fi anulată."); }
    finally { setBusy(false); }
  }

  async function correctPayment(payment: JsonMap) {
    const amount = window.prompt(`Suma corectată (${payment.currency})`, String(payment.amount));
    if (!amount) return;
    const reason = window.prompt("Motivul corecției");
    if (!reason) return;
    setBusy(true); setError(null);
    try {
      await api(`/api/admin/receivables/payments/${payment.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount,
          receivedAt: String(payment.receivedAt).slice(0, 10),
          reason,
          paymentMethod: payment.paymentMethod || null,
          paymentReference: payment.paymentReference || null,
          notes: payment.notes || null,
          confirmOverpayment: false,
          requestKey: crypto.randomUUID()
        })
      });
      setMessage("Încasarea a fost corectată; operația inițială rămâne în audit.");
      await refresh();
    } catch (correctError) { setError(correctError instanceof Error ? correctError.message : "Încasarea nu a putut fi corectată."); }
    finally { setBusy(false); }
  }

  async function deleteAlias(id: string) {
    if (!canManage || !window.confirm("Șterg acest alias financiar?")) return;
    setBusy(true); setError(null);
    try { await api(`/api/admin/receivables-aliases/${id}`, { method: "DELETE" }); await refresh(); setMessage("Aliasul a fost șters."); }
    catch (aliasError) { setError(aliasError instanceof Error ? aliasError.message : "Aliasul nu a putut fi șters."); }
    finally { setBusy(false); }
  }

  async function editAlias(alias: JsonMap) {
    if (!canManage) return;
    const aliasName = window.prompt("Denumirea aliasului", alias.aliasName);
    if (!aliasName || aliasName === alias.aliasName) return;
    setBusy(true); setError(null);
    try {
      await api(`/api/admin/receivables-aliases/${alias.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aliasName, clientId: alias.clientId })
      });
      await refresh();
      setMessage("Aliasul a fost actualizat.");
    } catch (aliasError) { setError(aliasError instanceof Error ? aliasError.message : "Aliasul nu a putut fi actualizat."); }
    finally { setBusy(false); }
  }

  const visibleReceivables = useMemo(() => workspace.receivables, [workspace.receivables]);
  const paymentPreview = useMemo(() => {
    if (!paymentTarget) return null;
    const previous = Number(paymentTarget.collectedAmount || 0);
    const amount = Number(paymentAmount.replace(",", ".") || 0);
    const invoice = Number(paymentTarget.invoicedAmount || 0);
    return {
      previous,
      amount,
      nextCollected: previous + amount,
      nextRemaining: Math.max(invoice - previous - amount, 0)
    };
  }, [paymentAmount, paymentTarget]);
  const activeGroupRows = preview?.groups?.[previewGroup] || [];
  const blockers = preview ? ["needs_confirmation", "manual", "conflict"].reduce((sum, key) => sum + (preview.groups?.[key]?.length || 0), 0) : 0;

  return (
    <main className="focus-container min-w-0 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-focus-line pb-6">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Financiar</p>
          <h1 className="mt-1 text-3xl font-black text-white">Facturi clienți și încasări</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">Urmărește facturile emise, scadențele și încasările cumulative, separat pentru fiecare firmă și monedă.</p>
        </div>
        {canImport ? <button className="focus-button" type="button" onClick={() => { setTab("import"); setTimeout(() => fileRef.current?.focus(), 0); }}><Plus size={18} /> Import nou</button> : null}
      </div>

      <div className="mt-5 flex min-w-0 gap-2 overflow-x-auto pb-2" role="tablist">
        {tabs.map(([value, label, Icon]) => <button key={value} className={`focus-button whitespace-nowrap ${tab === value ? "" : "secondary"}`} type="button" onClick={() => setTab(value)}><Icon size={17} />{label}</button>)}
      </div>
      <div className="min-h-12 py-3" aria-live="polite">
        {busy ? <p className="flex items-center gap-2 text-sm text-slate-200"><Loader2 className="animate-spin" size={17} /> Se procesează...</p> : null}
        {message ? <p className="text-sm font-bold text-emerald-300">{message}</p> : null}
        {error ? <p className="text-sm font-bold text-red-300">{error}</p> : null}
      </div>

      {tab === "receivables" ? (
        <section aria-labelledby="receivables-title">
          <div>
            <h2 id="receivables-title" className="text-xl font-black text-white">Facturi clienți</h2>
            <p className="text-sm text-slate-400">Fiecare plată se adaugă în registru, iar totalul încasat și soldul se recalculează automat.</p>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {workspace.summary.map((item) => (
              <article className="rounded-lg border border-focus-line bg-focus-ink/70 p-4" key={item.currency}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase text-slate-400">Total de încasat</p>
                    <p className="mt-1 text-3xl font-black text-white">{moneyLabel(item.remaining, item.currency)}</p>
                  </div>
                  <span className="rounded-md bg-focus-yellow px-2.5 py-1 text-xs font-black text-focus-navy">{item.currency}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-focus-line pt-4 sm:grid-cols-4">
                  <InvoiceMetric label="Facturat" value={moneyLabel(item.invoiced, item.currency)} detail={`${item.invoiceCount} facturi`} icon={<CircleDollarSign size={15} />} />
                  <InvoiceMetric label="Încasat" value={moneyLabel(item.collected, item.currency)} detail={`${item.collectedCount} achitate`} icon={<Banknote size={15} />} tone="green" />
                  <InvoiceMetric label="Scadent" value={moneyLabel(item.overdue, item.currency)} detail={`${item.overdueCount} facturi`} icon={<CircleAlert size={15} />} tone={item.overdueCount ? "red" : "green"} />
                  <InvoiceMetric label="În termen" value={moneyLabel(item.inTerm, item.currency)} detail={`${item.inTermCount} facturi`} icon={<CalendarClock size={15} />} />
                </div>
              </article>
            ))}
          </div>

          <form className="mt-5 grid gap-3 border-y border-focus-line py-4 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.5fr)_repeat(3,minmax(170px,0.7fr))_auto]" onSubmit={(event) => { event.preventDefault(); refresh(); }}>
            <label className="relative"><span className="sr-only">Caută</span><Search className="absolute left-3 top-3 text-slate-400" size={16} /><input className="focus-input w-full pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Client, factură, campanie sau locație" /></label>
            <label><span className="sr-only">Firma emitentă</span><select className="focus-input w-full" value={companyCode} onChange={(event) => { const value = event.target.value; setCompanyCode(value); void refresh(query, status, value, currency); }}><option value="">Toate firmele</option>{workspace.issuerCompanies.map((company) => <option key={`${company.companyCode}-${company.companyName}`} value={company.companyCode || ""}>{company.companyName}</option>)}</select></label>
            <label><span className="sr-only">Moneda</span><select className="focus-input w-full" value={currency} onChange={(event) => { const value = event.target.value; setCurrency(value); void refresh(query, status, companyCode, value); }}><option value="">Toate monedele</option><option value="RON">RON</option><option value="EUR">EUR</option></select></label>
            <label><span className="sr-only">Starea facturii</span><select className="focus-input w-full" value={status} onChange={(event) => { const value = event.target.value; setStatus(value); void refresh(query, value, companyCode, currency); }}><option value="">Toate stările</option><option value="open">Sold deschis</option><option value="overdue">Scadente</option><option value="due_soon">Scad în 7 zile</option><option value="in_term">În termen</option><option value="missing_due">Fără scadență</option><option value="collected_partial">Parțial încasate</option><option value="collected">Încasate</option><option value="client_credit">Credit client</option></select></label>
            <div className="flex gap-2">
              <button className="focus-button" type="submit">Aplică</button>
              <button className="focus-button secondary" type="button" title="Resetează filtrele" onClick={() => { setQuery(""); setStatus(""); setCompanyCode(""); setCurrency(""); void refresh("", "", "", ""); }}><RotateCcw size={17} /><span className="sr-only">Resetează</span></button>
            </div>
          </form>

          <div className="mt-4 overflow-x-auto rounded-lg border border-focus-line">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-focus-navy text-xs uppercase text-slate-300"><tr><th className="p-3">Client / factură</th><th className="p-3">Firmă</th><th className="p-3">Scadență</th><th className="p-3 text-right">Facturat</th><th className="p-3 text-right">Încasat</th><th className="p-3 text-right">Rest</th><th className="p-3">Stare</th><th className="p-3">Acțiune</th></tr></thead>
              <tbody>{visibleReceivables.map((row) => <tr key={row.id} className="border-t border-focus-line bg-focus-panel/50"><td className="p-3"><strong className="block text-white">{row.client?.companyName || row.clientName || "Client nealocat"}</strong><span className="text-slate-400">{row.invoiceNumber || "Fără număr"}</span></td><td className="p-3 text-slate-200"><span className="block">{row.companyName}</span><small className="text-slate-500">{row.companyCode || "-"}</small></td><td className="p-3 text-slate-200">{formatDate(row.dueDate)}</td><td className="p-3 text-right font-bold text-white">{moneyLabel(row.invoicedAmount, row.currency)}</td><td className="p-3 text-right text-emerald-300">{moneyLabel(row.collectedAmount, row.currency)}</td><td className="p-3 text-right font-black text-focus-yellow">{moneyLabel(row.remainingAmount, row.currency)}</td><td className="p-3"><StatusBadge value={row.status} /></td><td className="p-3">{canValidate && Number(row.remainingAmount || 0) > 0 ? <button className="focus-button min-w-44 justify-center" type="button" onClick={() => { setPaymentTarget(row); setPaymentAmount(String(row.remainingAmount || "")); }}><Banknote size={16} /> Înregistrează plată</button> : <span className="text-xs text-slate-500">{Number(row.remainingAmount || 0) > 0 ? "Doar vizualizare" : "Fără sold"}</span>}</td></tr>)}</tbody>
            </table>
          </div>
          {!visibleReceivables.length ? <Empty text="Nu există facturi pentru filtrele selectate." /> : null}
        </section>
      ) : null}

      {tab === "import" ? (
        <section className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <h2 className="text-xl font-black text-white">Import raport Excel</h2>
            <p className="mt-1 text-sm text-slate-400">Procesăm exclusiv secțiunea „LISTA ÎNCASĂRI”. Preview-ul nu modifică creanțele.</p>
            {canImport ? <form className="mt-4 grid gap-3 rounded-lg border border-focus-line bg-focus-panel/50 p-4 md:grid-cols-4" onSubmit={uploadReport}>
              <label className="grid gap-1 text-xs font-bold text-slate-300">Firmă<select className="focus-input" name="companyCode" defaultValue=""><option value="">Detectare automată</option><option value="FOCUS_MEDIA">Focus Media Outdoor</option><option value="EXCELLENCE_MEDIA">Excellence Media Production</option><option value="FOCUS_BG">Focus Media EOOD Bulgaria</option></select></label>
              <label className="grid gap-1 text-xs font-bold text-slate-300">Data raportului<input className="focus-input" name="reportDate" type="date" /></label>
              <label className="grid gap-1 text-xs font-bold text-slate-300 md:col-span-2">Fișier Excel<input ref={fileRef} className="focus-input" required name="file" type="file" accept=".xlsx,.xls" /></label>
              <button className="focus-button md:col-span-4 md:justify-self-start" disabled={busy} type="submit"><FileSpreadsheet size={18} /> Analizează raportul</button>
            </form> : null}

            {preview ? <div className="mt-6 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-focus-line pb-4"><div><h3 className="font-black text-white">{preview.upload.originalFileName}</h3><p className="text-xs text-slate-400">Raport: {formatDate(preview.upload.reportDate)} · Stare: {preview.upload.status}</p></div>{canConfirm && preview.upload.status !== "confirmed" ? <button className="focus-button" type="button" disabled={busy || blockers > 0} onClick={confirmImport}><BadgeCheck size={17} /> Confirmă importul</button> : null}</div>
              {blockers ? <p className="mt-3 flex items-center gap-2 rounded-md bg-red-950/40 p-3 text-sm font-bold text-red-200"><CircleAlert size={17} /> {blockers} rânduri trebuie rezolvate înainte de confirmare.</p> : null}
              <div className="mt-4 flex gap-2 overflow-x-auto pb-2">{Object.entries(groupLabels).map(([key, label]) => { const count = preview.groups?.[key]?.length || 0; return <button key={key} className={`focus-button whitespace-nowrap ${previewGroup === key ? "" : "secondary"}`} type="button" onClick={() => setPreviewGroup(key)}>{label} <span className="rounded bg-black/20 px-1.5">{count}</span></button>; })}</div>
              <div className="mt-2 overflow-x-auto rounded-lg border border-focus-line"><table className="w-full min-w-[1120px] text-left text-sm"><thead className="bg-focus-navy text-xs uppercase text-slate-300"><tr><th className="p-3">Rând</th><th className="p-3">Client sursă</th><th className="p-3">Factură</th><th className="p-3">Scadență</th><th className="p-3 text-right">Facturat</th><th className="p-3 text-right">Încasat</th><th className="p-3 text-right">Rest</th><th className="p-3">Alocare</th><th className="p-3">Acțiuni</th></tr></thead><tbody>{activeGroupRows.map((row: JsonMap) => <tr key={row.id} className="border-t border-focus-line bg-focus-panel/50 align-top"><td className="p-3 text-slate-400">{row.rowNumber}</td><td className="p-3"><strong className="text-white">{row.clientNameRaw || "-"}</strong><span className="mt-1 block max-w-72 text-xs text-slate-400">{row.matchReason}</span></td><td className="p-3"><span className="block text-white">{row.rawInvoiceNumber || "-"}</span>{row.rawInvoiceNumber && row.normalizedInvoiceNumber && normalizeVisible(row.rawInvoiceNumber) !== row.normalizedInvoiceNumber ? <span className="text-xs text-amber-300">Normalizat: {row.normalizedInvoiceNumber}</span> : null}</td><td className="p-3 text-slate-200">{formatDate(row.dueDate)}</td><td className="p-3 text-right text-white">{moneyLabel(row.invoiceAmount, row.currency)}</td><td className="p-3 text-right text-emerald-300">{moneyLabel(row.reportCollectedAmount, row.currency)}</td><td className="p-3 text-right font-bold text-focus-yellow">{moneyLabel(row.reportRemainingAmount, row.currency)}</td><td className="p-3"><select id={`client-${row.id}`} className="focus-input min-w-64" defaultValue={row.clientId || ""} disabled={!canValidate || ["imported", "unchanged", "ignored"].includes(row.status)}><option value="">Selectează clientul</option>{workspace.clients.map((client) => <option key={client.id} value={client.id}>{client.companyName}{client.taxId ? ` · ${client.taxId}` : ""}</option>)}</select></td><td className="p-3"><div className="flex min-w-64 flex-wrap gap-2">{canValidate && !["imported", "unchanged", "ignored"].includes(row.status) ? <><button className="focus-button" type="button" disabled={busy} onClick={() => resolveRow(row, row.status === "needs_confirmation" && Number(row.reportRemainingAmount) < 0 ? "confirm_credit" : "confirm")}>Confirmă</button><button className="focus-button secondary" type="button" disabled={busy} onClick={() => setAllocationTarget(row)}>Alocare detaliată</button><button className="focus-button secondary" type="button" disabled={busy} onClick={() => resolveRow(row, "ignore")}>Ignoră</button></> : <StatusBadge value={row.status} />}</div></td></tr>)}</tbody></table></div>
              {!activeGroupRows.length ? <Empty text={`Nu există rânduri în categoria „${groupLabels[previewGroup]}”.`} /> : null}
            </div> : <Empty text="Încarcă un raport pentru a vedea preview-ul și alocările propuse." />}
          </div>
          <aside className="self-start rounded-lg border border-focus-line bg-focus-panel/50 p-4 xl:sticky xl:top-28"><h3 className="font-black text-white">Verificarea totalurilor</h3><p className="mt-1 text-xs text-slate-400">Monedele sunt păstrate separat. Totalurile nu fac conversie valutară.</p><div className="mt-4 grid gap-2">{preview?.totals?.map((total: JsonMap, index: number) => <div className="rounded-md bg-focus-navy/60 p-3 text-sm" key={`${total.companyCode}-${total.currency}-${total.clientId}-${total.state}-${index}`}><div className="flex justify-between gap-2"><strong className="text-white">{total.companyCode}</strong><span className="text-focus-yellow">{total.currency}</span></div><p className="mt-1 truncate text-xs font-bold text-slate-200" title={total.clientName}>{total.clientName}</p><p className="text-xs text-slate-400">{total.state === "overdue" ? "Scadent" : total.state === "credit" ? "Credit" : "În termen"} · {total.count} rânduri</p><p className="mt-2 text-slate-200">Facturat: {moneyLabel(total.invoiceAmount, total.currency)}</p><p className="text-slate-200">Încasat: {moneyLabel(total.collectedAmount, total.currency)}</p><p className="font-bold text-white">Rest: {moneyLabel(total.remainingAmount, total.currency)}</p></div>)}</div></aside>
        </section>
      ) : null}

      {tab === "history" ? <SimpleTable title="Istoric importuri" headers={["Fișier", "Data raport", "Încărcat de", "Stare", "Rezultat"]} rows={workspace.uploads.map((upload) => [<button className="font-bold text-focus-yellow hover:underline" type="button" onClick={() => openImport(upload.id)}>{upload.originalFileName}</button>, formatDate(upload.reportDate), upload.uploadedBy?.name || "-", <StatusBadge value={upload.status} />, `${upload._count.receivableImportRows || upload._count.receivables} rânduri · ${upload._count.issues} probleme`])} /> : null}
      {tab === "payments" ? <SimpleTable title="Istoric încasări" headers={["Client / factură", "Data", "Sumă", "Sursă", "Utilizator", "Stare", "Acțiune"]} rows={workspace.payments.map((payment) => [`${payment.receivable?.clientName || "-"} · ${payment.receivable?.invoiceNumber || "-"}`, formatDate(payment.receivedAt), moneyLabel(payment.amount, payment.currency), payment.source, payment.createdBy?.name || "Sistem", <StatusBadge value={payment.status} />, canValidate && payment.status === "active" ? <div className="flex gap-2"><button className="focus-button secondary" type="button" onClick={() => correctPayment(payment)}>Corectează</button><button className="focus-button secondary" type="button" onClick={() => cancelPayment(payment)}><Trash2 size={15} /> Anulează</button></div> : "-"])} /> : null}
      {tab === "aliases" ? <SimpleTable title="Aliasuri clienți" subtitle="Mapările apar numai după confirmarea unui utilizator." headers={["Firmă", "Alias raport", "Client canonic", "Creat de", "Acțiune"]} rows={workspace.aliases.map((alias) => [alias.companyCode, alias.aliasName, alias.client.companyName, alias.createdBy?.name || "-", canManage ? <div className="flex gap-2"><button className="focus-button secondary" type="button" onClick={() => editAlias(alias)}>Editează</button><button className="focus-button secondary" type="button" onClick={() => deleteAlias(alias.id)}><Trash2 size={15} /> Șterge</button></div> : "-"])} /> : null}

      {paymentTarget ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <form className="focus-card max-h-[92vh] w-full max-w-xl overflow-auto rounded-lg p-5" onSubmit={submitPayment}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-focus-yellow">Înregistrează plată</p>
                <h2 className="text-xl font-black text-white">{paymentTarget.client?.companyName || paymentTarget.clientName}</h2>
                <p className="text-sm text-slate-400">Factura {paymentTarget.invoiceNumber || "fără număr"} · {paymentTarget.companyName}</p>
              </div>
              <button className="focus-button secondary" type="button" onClick={() => { setPaymentTarget(null); setPaymentAmount(""); }}>Închide</button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 rounded-lg bg-focus-navy/65 p-4 sm:grid-cols-4">
              <PaymentPreviewMetric label="Facturat" value={moneyLabel(paymentTarget.invoicedAmount, paymentTarget.currency)} />
              <PaymentPreviewMetric label="Încasat anterior" value={moneyLabel(paymentPreview?.previous, paymentTarget.currency)} tone="green" />
              <PaymentPreviewMetric label="După această plată" value={moneyLabel(paymentPreview?.nextCollected, paymentTarget.currency)} tone="green" />
              <PaymentPreviewMetric label="Sold rămas" value={moneyLabel(paymentPreview?.nextRemaining, paymentTarget.currency)} tone="yellow" />
            </div>
            <p className="mt-2 text-xs text-slate-400">Noua sumă se adaugă la încasările anterioare. Istoricul nu este suprascris.</p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-bold text-slate-200">
                Suma plătită
                <input className="focus-input" required name="amount" inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
              </label>
              <label className="grid gap-1 text-sm font-bold text-slate-200">
                Moneda
                <input className="focus-input" value={paymentTarget.currency || ""} readOnly />
              </label>
              <button className="focus-button secondary sm:col-span-2 sm:justify-self-start" type="button" onClick={() => setPaymentAmount(String(paymentTarget.remainingAmount || ""))}>
                <Banknote size={16} /> Încasează tot soldul
              </button>
              <label className="grid gap-1 text-sm font-bold text-slate-200">Data încasării<input className="focus-input" required name="receivedAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
              <label className="grid gap-1 text-sm font-bold text-slate-200">Metoda de plată<select className="focus-input" name="paymentMethod"><option value="transfer_bancar">Transfer bancar</option><option value="numerar">Numerar</option><option value="card">Card</option><option value="alta">Altă metodă</option></select></label>
              <label className="grid gap-1 text-sm font-bold text-slate-200 sm:col-span-2">Referință operațiune<input className="focus-input" name="paymentReference" /></label>
              <label className="grid gap-1 text-sm font-bold text-slate-200 sm:col-span-2">Observații<textarea className="focus-input min-h-20" name="notes" /></label>
              <label className="flex items-start gap-2 text-sm text-amber-100 sm:col-span-2"><input className="mt-1" type="checkbox" name="confirmOverpayment" /> Confirm explicit înregistrarea diferenței ca avans / credit client dacă suma depășește soldul.</label>
            </div>
            <button className="focus-button mt-5 w-full justify-center" disabled={busy || !paymentAmount} type="submit"><Banknote size={18} /> {busy ? "Se salvează..." : "Salvează plata"}</button>
          </form>
        </div>
      ) : null}
      {allocationTarget ? <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true"><form className="focus-card max-h-[92vh] w-full max-w-2xl overflow-auto rounded-lg p-5" onSubmit={submitAllocation}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase text-focus-yellow">Alocare manuală</p><h2 className="text-xl font-black text-white">{allocationTarget.clientNameRaw || "Rând fără client"}</h2><p className="text-sm text-slate-400">{allocationTarget.rawInvoiceNumber || "Fără număr factură"}</p></div><button className="focus-button secondary" type="button" onClick={() => setAllocationTarget(null)}>Închide</button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="grid gap-1 text-sm font-bold text-slate-200">Firmă emitentă<select className="focus-input" name="companyCode" defaultValue={allocationTarget.companyCode}><option value="FOCUS_MEDIA">Focus Media Outdoor</option><option value="EXCELLENCE_MEDIA">Excellence Media Production</option><option value="FOCUS_BG">Focus Media EOOD Bulgaria</option></select></label><label className="grid gap-1 text-sm font-bold text-slate-200">Client<select className="focus-input" required name="clientId" defaultValue={allocationTarget.clientId || ""}><option value="">Selectează clientul</option>{workspace.clients.map((client) => <option key={client.id} value={client.id}>{client.companyName}{client.taxId ? ` · ${client.taxId}` : ""}</option>)}</select></label><label className="grid gap-1 text-sm font-bold text-slate-200 sm:col-span-2">Factură existentă<select className="focus-input" name="receivableId" defaultValue={allocationTarget.receivableId || ""}><option value="">Creează creanță nouă</option>{workspace.receivables.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber || "Fără număr"} · {invoice.client?.companyName || invoice.clientName || "Nealocat"} · {moneyLabel(invoice.invoicedAmount, invoice.currency)}</option>)}</select></label><label className="grid gap-1 text-sm font-bold text-slate-200">Campanie<select className="focus-input" name="campaignId" defaultValue={allocationTarget.campaignId || ""}><option value="">Fără campanie</option>{workspace.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.campaignName}</option>)}</select></label><label className="grid gap-1 text-sm font-bold text-slate-200">Locație<select className="focus-input" name="locationId" defaultValue={allocationTarget.locationId || ""}><option value="">Fără locație</option>{workspace.locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.address || location.city || "-"}</option>)}</select></label><label className="grid gap-1 text-sm font-bold text-slate-200">Acțiune<select className="focus-input" name="action" defaultValue={Number(allocationTarget.reportRemainingAmount) < 0 ? "confirm_credit" : "create"}><option value="create">Creează / actualizează creanța</option><option value="confirm">Confirmă potrivirea</option><option value="confirm_credit">Confirmă și creditul clientului</option></select></label><label className="flex items-center gap-2 text-sm font-bold text-slate-200"><input type="checkbox" name="saveAlias" /> Salvează denumirea ca alias confirmat</label><label className="grid gap-1 text-sm font-bold text-slate-200 sm:col-span-2">Observație / motiv<textarea className="focus-input min-h-20" name="reason" placeholder="Opțional pentru alocare; obligatoriu doar la ignorare." /></label></div><button className="focus-button mt-5 w-full justify-center" disabled={busy} type="submit"><BadgeCheck size={18} /> Salvează alocarea</button></form></div> : null}
    </main>
  );
}

function SimpleTable({ title, subtitle, headers, rows }: { title: string; subtitle?: string; headers: string[]; rows: ReactNode[][] }) {
  return <section><h2 className="text-xl font-black text-white">{title}</h2>{subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}<div className="mt-4 overflow-x-auto rounded-lg border border-focus-line"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-focus-navy text-xs uppercase text-slate-300"><tr>{headers.map((header) => <th className="p-3" key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr className="border-t border-focus-line bg-focus-panel/50" key={index}>{row.map((cell, cellIndex) => <td className="p-3 text-slate-200" key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>{!rows.length ? <Empty text="Nu există înregistrări." /> : null}</section>;
}

function InvoiceMetric({
  label,
  value,
  detail,
  icon,
  tone = "neutral"
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone?: "neutral" | "green" | "red";
}) {
  const toneClass = tone === "green" ? "text-emerald-300" : tone === "red" ? "text-red-200" : "text-white";
  return <div className="min-w-0"><p className="flex items-center gap-1.5 text-[11px] font-black uppercase text-slate-400">{icon}{label}</p><strong className={`mt-1 block truncate text-sm ${toneClass}`} title={value}>{value}</strong><small className="text-xs text-slate-500">{detail}</small></div>;
}

function PaymentPreviewMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "green" | "yellow" }) {
  const toneClass = tone === "green" ? "text-emerald-300" : tone === "yellow" ? "text-focus-yellow" : "text-white";
  return <div><p className="text-[11px] font-black uppercase text-slate-400">{label}</p><strong className={`mt-1 block text-sm ${toneClass}`}>{value}</strong></div>;
}

function Empty({ text }: { text: string }) { return <div className="mt-4 rounded-lg border border-dashed border-focus-line p-6 text-center text-sm text-slate-400">{text}</div>; }
function StatusBadge({ value }: { value: string }) { const tone = ["collected", "confirmed", "imported", "allocated_auto", "active"].includes(value) ? "bg-emerald-950 text-emerald-200" : ["conflict", "overdue", "failed", "cancelled"].includes(value) ? "bg-red-950 text-red-200" : "bg-amber-950 text-amber-100"; return <span className={`inline-flex rounded px-2 py-1 text-xs font-black ${tone}`}>{statusLabel(value)}</span>; }
function statusLabel(value: string) { return ({ collected: "Încasată", collected_partial: "Parțial încasată", client_credit: "Credit client", overdue: "Scadentă", in_term: "În termen", due_today: "Scadentă azi", due_soon: "Scadentă curând", needs_review: "Necesită verificare", confirmed: "Confirmat", preview_ready: "Preview pregătit", needs_confirmation: "Necesită confirmare", allocated_auto: "Alocat automat", manual: "Alocare manuală", conflict: "Conflict", imported: "Importat", unchanged: "Neschimbat", ignored: "Ignorat", active: "Activă", cancelled: "Anulată", rejected: "Anulat" } as Record<string, string>)[value] || value; }
function moneyLabel(value: unknown, currency: unknown) { const number = Number(value || 0); return `${new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number)} ${String(currency || "")}`.trim(); }
function formatDate(value: unknown) { if (!value) return "-"; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("ro-RO").format(date); }
function normalizeVisible(value: string) { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, ""); }
function firstNonEmptyGroup(preview: JsonMap, preferred?: string) { if (preferred && preview.groups?.[preferred]?.length) return preferred; return ["conflict", "manual", "needs_confirmation", "allocated_auto", "updates", "existing", "credit", "unchanged", "imported", "ignored"].find((key) => preview.groups?.[key]?.length) || "allocated_auto"; }
