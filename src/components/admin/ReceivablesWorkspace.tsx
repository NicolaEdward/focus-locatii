"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  Banknote,
  CalendarClock,
  CircleAlert,
  FileClock,
  FileSpreadsheet,
  History,
  Landmark,
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
type Registry = {
  view: "open" | "history";
  items: JsonMap[];
  summary: Array<{
    currency: string;
    openCount: number;
    overdueCount: number;
    inTermCount: number;
    dueSoonCount: number;
    needsReviewCount: number;
    remaining: string;
    overdue: string;
    inTerm: string;
    dueSoon: string;
  }>;
  issuerCompanies: Array<{ companyCode: string | null; companyName: string }>;
  pagination: PaginationValue;
};
type PaginationValue = { page: number; take: number; total: number; totalPages: number };
type LazyData = { items: JsonMap[]; pagination?: PaginationValue; totals?: JsonMap[] };
type Option = { id: string; label: string; detail?: string | null };
type Tab = "receivables" | "settled" | "import" | "history" | "payments" | "credits" | "aliases" | "reconciliation";
type RowResolutionAction = "confirm" | "ignore" | "confirm_credit" | "confirm_ledger";

const tabs: Array<[Tab, string, typeof ReceiptText]> = [
  ["receivables", "De încasat", ReceiptText],
  ["settled", "Istoric facturi", BadgeCheck],
  ["import", "Import nou", Upload],
  ["history", "Istoric importuri", FileClock],
  ["payments", "Istoric încasări", History],
  ["credits", "Credite clienți", Landmark],
  ["aliases", "Aliasuri clienți", Link2],
  ["reconciliation", "Reconciliere legacy", CircleAlert]
];

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

const emptyLazy = { history: null, payments: null, credits: null, aliases: null } as Record<string, LazyData | null>;
const emptyOptions = { clients: [], receivables: [], campaigns: [], locations: [] } as Record<string, Option[]>;

export function ReceivablesWorkspace({
  initialRegistry,
  initialFilters,
  canImport,
  canValidate,
  canConfirm,
  canManage
}: {
  initialRegistry: Registry;
  initialFilters?: { query?: string; status?: string; companyCode?: string; currency?: string; ownerUserId?: string; asOf?: string; validatedOnly?: boolean };
  canImport: boolean;
  canValidate: boolean;
  canConfirm: boolean;
  canManage: boolean;
}) {
  const [registry, setRegistry] = useState(initialRegistry);
  const [settled, setSettled] = useState<Registry | null>(null);
  const [lazyData, setLazyData] = useState<Record<string, LazyData | null>>(emptyLazy);
  const [reconciliation, setReconciliation] = useState<JsonMap | null>(null);
  const [tab, setTab] = useState<Tab>("receivables");
  const [preview, setPreview] = useState<JsonMap | null>(null);
  const [previewGroup, setPreviewGroup] = useState("allocated_auto");
  const [query, setQuery] = useState(initialFilters?.query || "");
  const [status, setStatus] = useState(initialFilters?.status || "");
  const [companyCode, setCompanyCode] = useState(initialFilters?.companyCode || "");
  const [currency, setCurrency] = useState(initialFilters?.currency || "");
  const ownerUserId = initialFilters?.ownerUserId || "";
  const registryAsOf = initialFilters?.asOf || "";
  const validatedOnly = Boolean(initialFilters?.validatedOnly);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<JsonMap | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [allocationTarget, setAllocationTarget] = useState<JsonMap | null>(null);
  const [allocationOptions, setAllocationOptions] = useState<Record<string, Option[]>>(emptyOptions);
  const [optionSearch, setOptionSearch] = useState("");
  const [rowAction, setRowAction] = useState<{ row: JsonMap; action: RowResolutionAction } | null>(null);
  const [confirmImportOpen, setConfirmImportOpen] = useState(false);
  const [paymentAction, setPaymentAction] = useState<{ payment: JsonMap; type: "cancel" | "correct" } | null>(null);
  const [aliasAction, setAliasAction] = useState<{ alias: JsonMap; type: "delete" | "edit" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const allocationMutationRef = useRef(false);

  async function api(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || "Operația nu a putut fi finalizată.");
    return payload;
  }

  async function refresh(page = 1, next = { query, status, companyCode, currency }) {
    const params = new URLSearchParams({
      q: next.query,
      status: next.status,
      companyCode: next.companyCode,
      currency: next.currency,
      page: String(page),
      take: "40",
      view: "open"
    });
    if (registryAsOf) params.set("snapshot", registryAsOf);
    if (validatedOnly) params.set("validated", "1");
    if (ownerUserId) params.set("owner", ownerUserId);
    const payload = await api(`/api/admin/receivables-workspace/registry?${params}`);
    setRegistry(payload.registry);
  }

  async function loadSettled(page = 1) {
    setBusy(true); setError(null);
    try {
      const params = new URLSearchParams({ q: query, companyCode, currency, page: String(page), take: "40", view: "history" });
      if (registryAsOf) params.set("snapshot", registryAsOf);
      if (validatedOnly) params.set("validated", "1");
      if (ownerUserId) params.set("owner", ownerUserId);
      const payload = await api(`/api/admin/receivables-workspace/registry?${params}`);
      setSettled(payload.registry);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Istoricul nu a putut fi încărcat.");
    } finally { setBusy(false); }
  }

  async function loadTabData(value: Tab, force = false, page = 1) {
    if (!["history", "payments", "credits", "aliases"].includes(value)) return;
    if (!force && lazyData[value]) return;
    setBusy(true); setError(null);
    try {
      const endpoint = value === "history" ? "imports" : value;
      const payload = await api(`/api/admin/receivables-workspace/${endpoint}?take=40&page=${page}`);
      setLazyData((current) => ({ ...current, [value]: payload.data }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Datele nu au putut fi încărcate.");
    } finally { setBusy(false); }
  }

  async function loadReconciliation() {
    if (!canManage) return;
    setBusy(true); setError(null);
    try {
      const payload = await api("/api/admin/receivables-workspace/reconciliation?take=40");
      setReconciliation(payload.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Reconcilierea nu a putut fi încărcată.");
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (tab === "settled" && !settled) void loadSettled();
    else if (tab === "reconciliation" && !reconciliation) void loadReconciliation();
    else void loadTabData(tab);
    // Datele secundare se încarcă intenționat numai la deschiderea tabului.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function uploadReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canImport) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const payload = await api("/api/admin/receivables-import", { method: "POST", body: new FormData(event.currentTarget) });
      setPreview(payload.preview);
      setPreviewGroup(firstNonEmptyGroup(payload.preview));
      setMessage(payload.duplicate ? "Fișierul exista deja; am deschis importul anterior fără a dubla datele." : "Raport analizat. Nicio factură nu a fost modificată încă.");
      setLazyData((current) => ({ ...current, history: null }));
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
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Importul nu a putut fi deschis.");
    } finally { setBusy(false); }
  }

  async function loadOptions(row: JsonMap, commonQuery = "") {
    const terms = {
      clients: row.clientNameRaw || "",
      receivables: row.rawInvoiceNumber || "",
      campaigns: row.campaignDetails || "",
      locations: row.locationRaw || row.location || ""
    };
    const selectedIds = {
      clients: row.clientId,
      receivables: row.receivableId,
      campaigns: row.campaignId,
      locations: row.locationId
    };
    const result = await Promise.all((Object.keys(terms) as Array<keyof typeof terms>).map(async (type) => {
      const term = commonQuery || String(terms[type]);
      const params = new URLSearchParams({ type, q: term.slice(0, 80), take: "20" });
      if (selectedIds[type]) params.set("selectedId", String(selectedIds[type]));
      if (type === "campaigns" && row.clientId) params.set("clientId", String(row.clientId));
      const payload = await api(`/api/admin/receivables-workspace/options?${params}`);
      return [type, payload.items] as const;
    }));
    setAllocationOptions(Object.fromEntries(result));
  }

  async function loadClientOptions(row: JsonMap, queryValue = "") {
    const params = new URLSearchParams({
      type: "clients",
      q: String(queryValue || row.clientNameRaw || "").slice(0, 80),
      take: "20"
    });
    if (row.clientId) params.set("selectedId", String(row.clientId));
    const payload = await api(`/api/admin/receivables-workspace/options?${params}`);
    setAllocationOptions((current) => ({ ...current, clients: payload.items }));
  }

  async function openAllocation(row: JsonMap) {
    setAllocationTarget(row); setAllocationOptions(emptyOptions); setOptionSearch(""); setBusy(true); setError(null);
    try { await loadOptions(row); }
    catch (optionsError) { setError(optionsError instanceof Error ? optionsError.message : "Opțiunile nu au putut fi încărcate."); }
    finally { setBusy(false); }
  }

  async function openRowAction(row: JsonMap, action: RowResolutionAction) {
    setRowAction({ row, action });
    setAllocationOptions(emptyOptions);
    setOptionSearch(String(row.clientNameRaw || ""));
    if (action !== "ignore") {
      setBusy(true);
      try { await loadClientOptions(row); }
      catch (optionsError) { setError(optionsError instanceof Error ? optionsError.message : "Clienții nu au putut fi încărcați."); }
      finally { setBusy(false); }
    }
  }

  async function resolveRow(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rowAction || !preview || !canValidate || allocationMutationRef.current) return;
    const data = new FormData(event.currentTarget);
    const reason = String(data.get("reason") || "").trim();
    if (rowAction.action === "ignore" && !reason) { setError("Motivul ignorării este obligatoriu."); return; }
    allocationMutationRef.current = true; setBusy(true); setError(null);
    try {
      const payload = await api(`/api/admin/receivables-import/${preview.upload.id}/rows/${rowAction.row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: rowAction.action,
          clientId: String(data.get("clientId") || rowAction.row.clientId || "") || null,
          reason: reason || null,
          saveAlias: data.get("saveAlias") === "on"
        })
      });
      setPreview(payload.preview); setRowAction(null);
      setPreviewGroup(firstNonEmptyGroup(payload.preview, previewGroup));
      setMessage("Alocarea a fost salvată.");
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : "Alocarea nu a putut fi salvată.");
    } finally { allocationMutationRef.current = false; setBusy(false); }
  }

  async function submitAllocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allocationTarget || !preview || !canValidate || allocationMutationRef.current) return;
    const data = new FormData(event.currentTarget);
    const currencyValue = String(data.get("currency") || "").trim().toUpperCase();
    const reason = String(data.get("reason") || "").trim();
    if (!["RON", "EUR"].includes(currencyValue)) { setError("Moneda trebuie să fie RON sau EUR."); return; }
    if (currencyValue !== allocationTarget.currency && !reason) { setError("Motivul corectării monedei este obligatoriu."); return; }
    allocationMutationRef.current = true; setBusy(true); setError(null);
    try {
      const payload = await api(`/api/admin/receivables-import/${preview.upload.id}/rows/${allocationTarget.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: String(data.get("action") || "create"),
          companyCode: String(data.get("companyCode") || allocationTarget.companyCode),
          currency: currencyValue,
          clientId: nullableFormValue(data, "clientId"),
          receivableId: nullableFormValue(data, "receivableId"),
          campaignId: nullableFormValue(data, "campaignId"),
          locationId: nullableFormValue(data, "locationId"),
          reason: reason || null,
          saveAlias: data.get("saveAlias") === "on"
        })
      });
      setPreview(payload.preview); setAllocationTarget(null);
      setPreviewGroup(firstNonEmptyGroup(payload.preview, previewGroup));
      setMessage("Alocarea manuală a fost salvată.");
    } catch (allocationError) {
      setError(allocationError instanceof Error ? allocationError.message : "Alocarea nu a putut fi salvată.");
    } finally { allocationMutationRef.current = false; setBusy(false); }
  }

  async function confirmImport() {
    if (!canConfirm || !preview) return;
    setBusy(true); setError(null);
    try {
      const payload = await api(`/api/admin/receivables-import/${preview.upload.id}/confirm`, { method: "POST" });
      setPreview(payload.preview); setConfirmImportOpen(false);
      setMessage(`Import confirmat: ${payload.result.created} create, ${payload.result.updated} actualizate, ${payload.result.unchanged} neschimbate, ${payload.result.ignored} ignorate.`);
      setLazyData((current) => ({ ...current, history: null }));
      await refresh();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Importul nu a putut fi confirmat.");
    } finally { setBusy(false); }
  }

  async function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentTarget) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      await api(`/api/admin/receivables/${paymentTarget.id}/payments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: String(data.get("amount") || ""),
          receivedAt: String(data.get("receivedAt") || ""),
          paymentMethod: nullableFormValue(data, "paymentMethod"),
          paymentReference: nullableFormValue(data, "paymentReference"),
          notes: nullableFormValue(data, "notes"),
          confirmOverpayment: data.get("confirmOverpayment") === "on",
          requestKey: crypto.randomUUID()
        })
      });
      setPaymentTarget(null); setPaymentAmount("");
      setLazyData((current) => ({ ...current, payments: null, credits: null }));
      setMessage("Încasarea a fost înregistrată, iar soldul a fost recalculat din plățile active.");
      await refresh();
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Încasarea nu a putut fi salvată.");
    } finally { setBusy(false); }
  }

  async function submitPaymentAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentAction) return;
    const data = new FormData(event.currentTarget);
    const reason = String(data.get("reason") || "").trim();
    if (!reason) { setError("Motivul este obligatoriu."); return; }
    const payment = paymentAction.payment;
    setBusy(true); setError(null);
    try {
      if (paymentAction.type === "cancel") {
        await api(`/api/admin/receivables/payments/${payment.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
        setMessage("Încasarea a fost anulată; istoricul a fost păstrat.");
      } else {
        await api(`/api/admin/receivables/payments/${payment.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            amount: String(data.get("amount") || ""),
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
      }
      setPaymentAction(null);
      await Promise.all([refresh(), loadTabData("payments", true)]);
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Încasarea nu a putut fi actualizată.");
    } finally { setBusy(false); }
  }

  async function submitAliasAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !aliasAction) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      if (aliasAction.type === "delete") {
        await api(`/api/admin/receivables-aliases/${aliasAction.alias.id}`, { method: "DELETE" });
        setMessage("Aliasul a fost șters.");
      } else {
        const aliasName = String(data.get("aliasName") || "").trim();
        if (!aliasName) { setError("Denumirea aliasului este obligatorie."); return; }
        await api(`/api/admin/receivables-aliases/${aliasAction.alias.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ aliasName, clientId: aliasAction.alias.clientId })
        });
        setMessage("Aliasul a fost actualizat.");
      }
      setAliasAction(null);
      await loadTabData("aliases", true);
    } catch (aliasError) {
      setError(aliasError instanceof Error ? aliasError.message : "Aliasul nu a putut fi actualizat.");
    } finally { setBusy(false); }
  }

  const paymentPreview = useMemo(() => {
    if (!paymentTarget) return null;
    const previous = Number(paymentTarget.collectedAmount || 0);
    const amount = Number(paymentAmount.replace(",", ".") || 0);
    const invoice = Number(paymentTarget.invoicedAmount || 0);
    return { previous, amount, nextCollected: previous + amount, nextRemaining: Math.max(invoice - previous - amount, 0) };
  }, [paymentAmount, paymentTarget]);
  const activeGroupRows = preview?.groups?.[previewGroup] || [];
  const blockers = preview ? ["needs_confirmation", "manual", "conflict"].reduce((sum, key) => sum + (preview.groups?.[key]?.length || 0), 0) : 0;

  return (
    <main className="focus-container min-w-0 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-focus-line pb-6">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Financiar</p>
          <h1 className="mt-1 text-3xl font-black text-white">Facturi clienți</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">Registrul activ arată numai banii rămași de încasat. Facturile achitate rămân disponibile în istoric.</p>
        </div>
        {canImport ? <button className="focus-button" type="button" onClick={() => { setTab("import"); setTimeout(() => fileRef.current?.focus(), 0); }}><Plus size={18} /> Import nou</button> : null}
      </header>

      <nav className="mt-5 flex min-w-0 gap-2 overflow-x-auto pb-2" aria-label="Secțiuni facturi clienți">
        {tabs.filter(([value]) => value !== "reconciliation" || canManage).map(([value, label, Icon]) => (
          <button key={value} className={`focus-button whitespace-nowrap ${tab === value ? "" : "secondary"}`} type="button" onClick={() => setTab(value)}><Icon size={17} />{label}</button>
        ))}
      </nav>
      <div className="min-h-12 py-3" aria-live="polite">
        {busy ? <p className="flex items-center gap-2 text-sm text-slate-200"><Loader2 className="animate-spin" size={17} /> Se procesează...</p> : null}
        {message ? <p className="text-sm font-bold text-emerald-300">{message}</p> : null}
        {error ? <p className="text-sm font-bold text-red-300">{error}</p> : null}
      </div>

      {tab === "receivables" ? (
        <section aria-labelledby="receivables-title">
          <div>
            <h2 id="receivables-title" className="text-xl font-black text-white">Solduri de încasat</h2>
            <p className="text-sm text-slate-400">RON și EUR sunt păstrate separat. Totalurile includ doar facturile cu sold activ peste toleranța de 0,01.</p>
            {ownerUserId ? <p className="mt-2 text-xs font-bold text-focus-yellow">Filtru responsabil activ: sunt afișate numai facturile portofoliului selectat.</p> : null}
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {registry.summary.map((item) => (
              <article className="rounded-lg border border-focus-line bg-focus-ink/70 p-4" key={item.currency}>
                <div className="flex items-start justify-between gap-4">
                  <div><p className="text-xs font-black uppercase text-slate-400">Total de încasat</p><p className="mt-1 text-3xl font-black text-white">{moneyLabel(item.remaining, item.currency)}</p></div>
                  <span className="rounded-md bg-focus-yellow px-2.5 py-1 text-xs font-black text-focus-navy">{item.currency}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-focus-line pt-4 sm:grid-cols-3">
                  <InvoiceMetric label="Scadent" value={moneyLabel(item.overdue, item.currency)} detail={`${item.overdueCount} facturi`} icon={<CircleAlert size={15} />} tone={item.overdueCount ? "red" : "green"} />
                  <InvoiceMetric label="În termen" value={moneyLabel(item.inTerm, item.currency)} detail={`${item.inTermCount} facturi`} icon={<CalendarClock size={15} />} />
                  <InvoiceMetric label="Următoarele 7 zile" value={moneyLabel(item.dueSoon, item.currency)} detail={`${item.dueSoonCount} facturi`} icon={<CalendarClock size={15} />} />
                </div>
              </article>
            ))}
          </div>
          <form className="mt-5 grid gap-3 border-y border-focus-line py-4 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.5fr)_repeat(3,minmax(170px,0.7fr))_auto]" onSubmit={(event) => { event.preventDefault(); void refresh(); }}>
            <label className="relative"><span className="sr-only">Caută</span><Search className="absolute left-3 top-3 text-slate-400" size={16} /><input className="focus-input w-full pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Client, factură, campanie sau locație" /></label>
            <label><span className="sr-only">Firma emitentă</span><select className="focus-input w-full" value={companyCode} onChange={(event) => setCompanyCode(event.target.value)}><option value="">Toate firmele</option>{registry.issuerCompanies.map((company) => <option key={`${company.companyCode}-${company.companyName}`} value={company.companyCode || ""}>{company.companyName}</option>)}</select></label>
            <label><span className="sr-only">Moneda</span><select className="focus-input w-full" value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="">Toate monedele</option><option value="RON">RON</option><option value="EUR">EUR</option></select></label>
            <label><span className="sr-only">Starea facturii</span><select className="focus-input w-full" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Toate soldurile deschise</option><option value="overdue">Scadente</option><option value="due_soon">Scad în 7 zile</option><option value="in_term">În termen</option><option value="missing_due">Fără scadență</option><option value="collected_partial">Parțial încasate</option></select></label>
            <div className="flex gap-2"><button className="focus-button" type="submit" onClick={() => setSettled(null)}>Aplică</button><button className="focus-button secondary" type="button" title="Resetează filtrele" onClick={() => { const reset = { query: "", status: "", companyCode: "", currency: "" }; setQuery(""); setStatus(""); setCompanyCode(""); setCurrency(""); setSettled(null); void refresh(1, reset); }}><RotateCcw size={17} /><span className="sr-only">Resetează</span></button></div>
          </form>
          <ReceivablesTable rows={registry.items} canValidate={canValidate} onPayment={(row) => { setPaymentTarget(row); setPaymentAmount(String(row.remainingAmount || "")); }} />
          <Pagination value={registry.pagination} onChange={(page) => refresh(page)} />
        </section>
      ) : null}

      {tab === "settled" ? settled ? (
        <section><h2 className="text-xl font-black text-white">Facturi încasate</h2><p className="mt-1 text-sm text-slate-400">Arhivă verificabilă, separată de activitatea curentă și de KPI-urile operaționale.</p><ReceivablesTable rows={settled.items} /><Pagination value={settled.pagination} onChange={loadSettled} /></section>
      ) : <Empty text="Se încarcă istoricul facturilor încasate..." /> : null}

      {tab === "import" ? (
        <section className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <h2 className="text-xl font-black text-white">Import raport Excel</h2>
            <p className="mt-1 text-sm text-slate-400">Procesăm exclusiv secțiunea „LISTA ÎNCASĂRI”. Preview-ul nu modifică facturile.</p>
            {canImport ? <form className="mt-4 grid gap-3 rounded-lg border border-focus-line bg-focus-panel/50 p-4 md:grid-cols-4" onSubmit={uploadReport}>
              <label className="grid gap-1 text-xs font-bold text-slate-300">Firmă<select className="focus-input" name="companyCode" defaultValue=""><option value="">Detectare automată</option><option value="FOCUS_MEDIA">Focus Media Outdoor</option><option value="EXCELLENCE_MEDIA">Excellence Media Production</option><option value="FOCUS_BG">Focus Media EOOD Bulgaria</option></select></label>
              <label className="grid gap-1 text-xs font-bold text-slate-300">Data raportului<input className="focus-input" name="reportDate" type="date" /></label>
              <label className="grid gap-1 text-xs font-bold text-slate-300 md:col-span-2">Fișier Excel<input ref={fileRef} className="focus-input" required name="file" type="file" accept=".xlsx,.xls" /></label>
              <button className="focus-button md:col-span-4 md:justify-self-start" disabled={busy} type="submit"><FileSpreadsheet size={18} /> Analizează raportul</button>
            </form> : null}
            {preview ? <div className="mt-6 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-focus-line pb-4"><div><h3 className="font-black text-white">{preview.upload.originalFileName}</h3><p className="text-xs text-slate-400">Raport: {formatDate(preview.upload.reportDate)} · Stare: {preview.upload.status}</p></div>{canConfirm && preview.upload.status !== "confirmed" ? <button className="focus-button" type="button" disabled={busy || blockers > 0} onClick={() => setConfirmImportOpen(true)}><BadgeCheck size={17} /> Confirmă importul</button> : null}</div>
              {blockers ? <p className="mt-3 flex items-center gap-2 rounded-md bg-red-950/40 p-3 text-sm font-bold text-red-200"><CircleAlert size={17} /> {blockers} rânduri trebuie rezolvate înainte de confirmare.</p> : null}
              <div className="mt-4 flex gap-2 overflow-x-auto pb-2">{Object.entries(groupLabels).map(([key, label]) => <button key={key} className={`focus-button whitespace-nowrap ${previewGroup === key ? "" : "secondary"}`} type="button" onClick={() => setPreviewGroup(key)}>{label} <span className="rounded bg-black/20 px-1.5">{preview.groups?.[key]?.length || 0}</span></button>)}</div>
              <div className="mt-2 overflow-x-auto rounded-lg border border-focus-line"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-focus-navy text-xs uppercase text-slate-300"><tr><th className="p-3">Rând</th><th className="p-3">Client sursă</th><th className="p-3">Factură</th><th className="p-3">Scadență</th><th className="p-3 text-right">Facturat</th><th className="p-3 text-right">Încasat</th><th className="p-3 text-right">Rest</th><th className="p-3">Acțiuni</th></tr></thead><tbody>{activeGroupRows.map((row: JsonMap) => <tr key={row.id} className="border-t border-focus-line bg-focus-panel/50 align-top"><td className="p-3 text-slate-400">{row.rowNumber}</td><td className="p-3"><strong className="text-white">{row.clientNameRaw || "-"}</strong><span className="mt-1 block max-w-72 text-xs text-slate-400">{row.matchReason}</span></td><td className="p-3"><span className="block text-white">{row.rawInvoiceNumber || "-"}</span>{row.rawInvoiceNumber && row.normalizedInvoiceNumber && normalizeVisible(row.rawInvoiceNumber) !== row.normalizedInvoiceNumber ? <span className="text-xs text-amber-300">Normalizat: {row.normalizedInvoiceNumber}</span> : null}</td><td className="p-3 text-slate-200">{formatDate(row.dueDate)}</td><td className="p-3 text-right text-white">{moneyLabel(row.invoiceAmount, row.currency)}</td><td className="p-3 text-right text-emerald-300">{moneyLabel(row.reportCollectedAmount, row.currency)}</td><td className="p-3 text-right font-bold text-focus-yellow">{moneyLabel(row.reportRemainingAmount, row.currency)}</td><td className="p-3"><div className="flex min-w-64 flex-wrap gap-2">{canValidate && !["imported", "unchanged", "ignored"].includes(row.status) ? <><button className="focus-button" type="button" disabled={busy} onClick={() => void openRowAction(row, rowConfirmationAction(row))}>{row.proposedAction === "keep_active_ledger" ? "Păstrează încasările" : "Confirmă"}</button><button className="focus-button secondary" type="button" disabled={busy} onClick={() => void openAllocation(row)}>Alocare detaliată</button><button className="focus-button secondary" type="button" disabled={busy} onClick={() => void openRowAction(row, "ignore")}>Ignoră</button></> : <StatusBadge value={row.status} />}</div></td></tr>)}</tbody></table></div>
              {!activeGroupRows.length ? <Empty text={`Nu există rânduri în categoria „${groupLabels[previewGroup]}”.`} /> : null}
            </div> : <Empty text="Încarcă un raport pentru a vedea preview-ul și alocările propuse." />}
          </div>
          <aside className="self-start rounded-lg border border-focus-line bg-focus-panel/50 p-4 xl:sticky xl:top-28"><h3 className="font-black text-white">Verificarea totalurilor</h3><p className="mt-1 text-xs text-slate-400">Monedele sunt păstrate separat. Totalurile nu fac conversie valutară.</p><div className="mt-4 grid gap-2">{preview?.totals?.map((total: JsonMap, index: number) => <div className="rounded-md bg-focus-navy/60 p-3 text-sm" key={`${total.companyCode}-${total.currency}-${total.clientId}-${total.state}-${index}`}><div className="flex justify-between gap-2"><strong className="text-white">{total.companyCode}</strong><span className="text-focus-yellow">{total.currency}</span></div><p className="mt-1 truncate text-xs font-bold text-slate-200" title={total.clientName}>{total.clientName}</p><p className="text-xs text-slate-400">{total.state === "overdue" ? "Scadent" : total.state === "credit" ? "Credit" : "În termen"} · {total.count} rânduri</p><p className="mt-2 text-slate-200">Facturat: {moneyLabel(total.invoiceAmount, total.currency)}</p><p className="text-slate-200">Încasat: {moneyLabel(total.collectedAmount, total.currency)}</p><p className="font-bold text-white">Rest: {moneyLabel(total.remainingAmount, total.currency)}</p></div>)}</div></aside>
        </section>
      ) : null}

      {tab === "history" ? <LazySection data={lazyData.history} fallback="Se încarcă istoricul importurilor..."><SimpleTable title="Istoric importuri" headers={["Fișier", "Data raport", "Încărcat de", "Stare", "Rezultat"]} rows={(lazyData.history?.items || []).map((upload) => [<button className="font-bold text-focus-yellow hover:underline" type="button" onClick={() => void openImport(upload.id)}>{upload.originalFileName}</button>, formatDate(upload.reportDate), upload.uploadedBy?.name || "-", <StatusBadge value={upload.status} />, `${upload._count.receivableImportRows || upload._count.receivables} rânduri · ${upload._count.issues} probleme`])} /><LazyPagination data={lazyData.history} onChange={(page) => loadTabData("history", true, page)} /></LazySection> : null}
      {tab === "payments" ? <LazySection data={lazyData.payments} fallback="Se încarcă istoricul încasărilor..."><SimpleTable title="Istoric încasări" headers={["Client / factură", "Data", "Sumă", "Sursă", "Utilizator", "Stare", "Acțiune"]} rows={(lazyData.payments?.items || []).map((payment) => [`${payment.receivable?.clientName || "-"} · ${payment.receivable?.invoiceNumber || "-"}`, formatDate(payment.receivedAt), moneyLabel(payment.amount, payment.currency), payment.source, payment.createdBy?.name || "Sistem", <StatusBadge value={payment.status} />, canValidate && payment.status === "active" ? <div className="flex gap-2"><button className="focus-button secondary" type="button" onClick={() => setPaymentAction({ payment, type: "correct" })}>Corectează</button><button className="focus-button secondary" type="button" onClick={() => setPaymentAction({ payment, type: "cancel" })}><Trash2 size={15} /> Anulează</button></div> : "-"])} /><LazyPagination data={lazyData.payments} onChange={(page) => loadTabData("payments", true, page)} /></LazySection> : null}
      {tab === "credits" ? <LazySection data={lazyData.credits} fallback="Se încarcă avansurile și creditele..."><SimpleTable title="Credite clienți" subtitle="Diferențele confirmate explicit ca avans sau supraplată." headers={["Client", "Firmă", "Valoare", "Disponibil", "Motiv", "Data"]} rows={(lazyData.credits?.items || []).map((credit) => [credit.client?.companyName || credit.companyName, credit.companyName, moneyLabel(credit.amount, credit.currency), moneyLabel(credit.remainingAmount, credit.currency), credit.reason || "-", formatDate(credit.createdAt)])} /><LazyPagination data={lazyData.credits} onChange={(page) => loadTabData("credits", true, page)} /></LazySection> : null}
      {tab === "aliases" ? <LazySection data={lazyData.aliases} fallback="Se încarcă aliasurile..."><SimpleTable title="Aliasuri clienți" subtitle="Mapările apar numai după confirmarea unui utilizator." headers={["Firmă", "Alias raport", "Client canonic", "Creat de", "Acțiune"]} rows={(lazyData.aliases?.items || []).map((alias) => [alias.companyCode, alias.aliasName, alias.client.companyName, alias.createdBy?.name || "-", canManage ? <div className="flex gap-2"><button className="focus-button secondary" type="button" onClick={() => setAliasAction({ alias, type: "edit" })}>Editează</button><button className="focus-button secondary" type="button" onClick={() => setAliasAction({ alias, type: "delete" })}><Trash2 size={15} /> Șterge</button></div> : "-"])} /><LazyPagination data={lazyData.aliases} onChange={(page) => loadTabData("aliases", true, page)} /></LazySection> : null}
      {tab === "reconciliation" && canManage ? <ReconciliationPanel data={reconciliation} /> : null}

      {paymentTarget ? <Modal title="Înregistrează încasare" subtitle={`${paymentTarget.client?.companyName || paymentTarget.clientName || "Client"} · ${paymentTarget.invoiceNumber || "Fără număr"}`} onClose={() => { setPaymentTarget(null); setPaymentAmount(""); }}><form onSubmit={submitPayment}>
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-focus-navy/65 p-4 sm:grid-cols-4"><PaymentPreviewMetric label="Facturat" value={moneyLabel(paymentTarget.invoicedAmount, paymentTarget.currency)} /><PaymentPreviewMetric label="Încasat anterior" value={moneyLabel(paymentPreview?.previous, paymentTarget.currency)} tone="green" /><PaymentPreviewMetric label="După această plată" value={moneyLabel(paymentPreview?.nextCollected, paymentTarget.currency)} tone="green" /><PaymentPreviewMetric label="Sold rămas" value={moneyLabel(paymentPreview?.nextRemaining, paymentTarget.currency)} tone="yellow" /></div>
        <p className="mt-2 text-xs text-slate-400">Noua sumă se adaugă la încasările anterioare. Istoricul nu este suprascris.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Suma plătită"><input className="focus-input" required name="amount" inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></Field><Field label="Moneda"><input className="focus-input" value={paymentTarget.currency || ""} readOnly /></Field><button className="focus-button secondary sm:col-span-2 sm:justify-self-start" type="button" onClick={() => setPaymentAmount(String(paymentTarget.remainingAmount || ""))}><Banknote size={16} /> Încasează tot soldul</button><Field label="Data încasării"><input className="focus-input" required name="receivedAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></Field><Field label="Metoda de plată"><select className="focus-input" name="paymentMethod"><option value="transfer_bancar">Transfer bancar</option><option value="numerar">Numerar</option><option value="card">Card</option><option value="alta">Altă metodă</option></select></Field><Field label="Referință operațiune" wide><input className="focus-input" name="paymentReference" /></Field><Field label="Observații" wide><textarea className="focus-input min-h-20" name="notes" /></Field><label className="flex items-start gap-2 text-sm text-amber-100 sm:col-span-2"><input className="mt-1" type="checkbox" name="confirmOverpayment" /> Confirm explicit înregistrarea diferenței ca avans / credit client dacă suma depășește soldul.</label></div>
        <button className="focus-button mt-5 w-full justify-center" disabled={busy || !paymentAmount} type="submit"><Banknote size={18} /> {busy ? "Se salvează..." : "Salvează plata"}</button>
      </form></Modal> : null}

      {allocationTarget ? <Modal title="Alocare manuală" subtitle={`${allocationTarget.clientNameRaw || "Rând fără client"} · ${allocationTarget.rawInvoiceNumber || "Fără număr"}`} onClose={() => setAllocationTarget(null)}><form onSubmit={submitAllocation}><div className="mb-4 flex gap-2"><input className="focus-input min-w-0 flex-1" value={optionSearch} onChange={(event) => setOptionSearch(event.target.value)} placeholder="Caută client, factură, campanie sau locație" /><button className="focus-button secondary" type="button" disabled={busy} onClick={() => void loadOptions(allocationTarget, optionSearch)}>Caută</button></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Firmă emitentă"><select className="focus-input" name="companyCode" defaultValue={allocationTarget.companyCode}><option value="FOCUS_MEDIA">Focus Media Outdoor</option><option value="EXCELLENCE_MEDIA">Excellence Media Production</option><option value="FOCUS_BG">Focus Media EOOD Bulgaria</option></select></Field><Field label="Monedă"><select className="focus-input" name="currency" defaultValue={allocationTarget.currency || "RON"}><option value="RON">RON</option><option value="EUR">EUR</option></select></Field><OptionField label="Client" name="clientId" options={allocationOptions.clients} defaultValue={allocationTarget.clientId} required /><OptionField label="Factură existentă" name="receivableId" options={allocationOptions.receivables} defaultValue={allocationTarget.receivableId} empty="Creează factură nouă" /><OptionField label="Campanie" name="campaignId" options={allocationOptions.campaigns} defaultValue={allocationTarget.campaignId} empty="Fără campanie" /><OptionField label="Locație" name="locationId" options={allocationOptions.locations} defaultValue={allocationTarget.locationId} empty="Fără locație" /><Field label="Acțiune"><select className="focus-input" name="action" defaultValue={allocationTarget.proposedAction === "keep_active_ledger" ? "confirm_ledger" : Number(allocationTarget.reportRemainingAmount) < 0 ? "confirm_credit" : "create"}><option value="create">Creează / actualizează factura</option><option value="confirm">Confirmă potrivirea</option><option value="confirm_credit">Confirmă și creditul clientului</option>{allocationTarget.proposedAction === "keep_active_ledger" ? <option value="confirm_ledger">Păstrează încasările existente din aplicație</option> : null}</select></Field><label className="flex items-center gap-2 text-sm font-bold text-slate-200"><input type="checkbox" name="saveAlias" /> Salvează denumirea ca alias confirmat</label><Field label="Observație / motiv" wide><textarea className="focus-input min-h-20" name="reason" placeholder="Obligatoriu dacă modifici moneda." /></Field></div><button className="focus-button mt-5 w-full justify-center" disabled={busy} type="submit"><BadgeCheck size={18} /> Salvează alocarea</button></form></Modal> : null}

      {rowAction ? (
        <Modal
          title={rowAction.action === "ignore" ? "Ignoră rândul" : rowAction.action === "confirm_ledger" ? "Păstrează registrul aplicației" : "Confirmă alocarea"}
          subtitle={`${rowAction.row.clientNameRaw || "Client neidentificat"} · ${rowAction.row.rawInvoiceNumber || "Fără număr"}`}
          onClose={() => setRowAction(null)}
        >
          <form onSubmit={resolveRow}>
            <p className="rounded-md bg-focus-navy/60 p-3 text-sm text-slate-300">
              Sursă: <strong className="text-white">{rowAction.row.clientNameRaw || "-"}</strong><br />
              Potrivire propusă: <strong className="text-white">{rowAction.row.matchReason || "Fără potrivire sigură"}</strong>
            </p>
            {rowAction.action === "confirm_ledger" ? (
              <p className="mt-3 rounded-md border border-amber-500/50 bg-amber-950/40 p-3 text-sm text-amber-100">
                Raportul nu va reduce încasările deja înregistrate. Factura va păstra totalul calculat din registrul aplicației.
              </p>
            ) : null}
            {rowAction.action !== "ignore" ? (
              <div className="mt-4">
                <div className="mb-3 flex gap-2">
                  <input className="focus-input min-w-0 flex-1" value={optionSearch} onChange={(event) => setOptionSearch(event.target.value)} placeholder="Caută clientul după nume sau CUI" />
                  <button className="focus-button secondary" type="button" disabled={busy} onClick={() => void loadClientOptions(rowAction.row, optionSearch)}>Caută</button>
                </div>
                <OptionField label="Client canonic" name="clientId" options={allocationOptions.clients} defaultValue={rowAction.row.clientId} required />
                {!busy && allocationOptions.clients.length === 0 ? <p className="mt-2 text-xs text-amber-200">Nu există rezultate pentru căutarea curentă. Modifică termenul și apasă „Caută”.</p> : null}
                <label className="mt-3 flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" name="saveAlias" /> Salvează această denumire ca alias pentru importurile viitoare</label>
              </div>
            ) : null}
            <Field label={rowAction.action === "ignore" ? "Motivul ignorării" : "Observație"}>
              <textarea className="focus-input mt-4 min-h-24 w-full" name="reason" required={rowAction.action === "ignore"} />
            </Field>
            <button className="focus-button mt-5 w-full justify-center" disabled={busy} type="submit">
              {rowAction.action === "ignore" ? "Ignoră cu motiv" : rowAction.action === "confirm_ledger" ? "Confirmă și păstrează încasările" : "Confirmă alocarea"}
            </button>
          </form>
        </Modal>
      ) : null}

      {confirmImportOpen && preview ? <Modal title="Confirmă importul" subtitle={preview.upload.originalFileName} onClose={() => setConfirmImportOpen(false)}><p className="text-sm text-slate-300">Confirmarea aplică tranzacțional rândurile validate. Plățile manuale existente rămân sursa prioritară și nu sunt suprascrise.</p><div className="mt-4 rounded-md bg-focus-navy/60 p-4 text-sm text-slate-200"><strong>{preview.rowCount || Object.values(preview.groups || {}).flat().length} rânduri analizate</strong><br />{blockers} blocaje rămase</div><button className="focus-button mt-5 w-full justify-center" disabled={busy || blockers > 0} type="button" onClick={() => void confirmImport()}>Confirmă importul tranzacțional</button></Modal> : null}

      {paymentAction ? <Modal title={paymentAction.type === "cancel" ? "Anulează încasarea" : "Corectează încasarea"} subtitle={`${paymentAction.payment.receivable?.clientName || "Client"} · ${paymentAction.payment.receivable?.invoiceNumber || "Fără număr"}`} onClose={() => setPaymentAction(null)}><form onSubmit={submitPaymentAction}><div className="rounded-md bg-focus-navy/60 p-4 text-sm"><p className="text-slate-400">Valoare anterioară</p><strong className="text-lg text-white">{moneyLabel(paymentAction.payment.amount, paymentAction.payment.currency)}</strong></div>{paymentAction.type === "correct" ? <Field label="Valoare corectată"><input className="focus-input mt-4 w-full" required name="amount" inputMode="decimal" defaultValue={paymentAction.payment.amount} /></Field> : null}<Field label="Motiv obligatoriu"><textarea className="focus-input mt-4 min-h-24 w-full" required name="reason" /></Field><button className="focus-button mt-5 w-full justify-center" disabled={busy} type="submit">{paymentAction.type === "cancel" ? "Anulează și păstrează auditul" : "Salvează corecția"}</button></form></Modal> : null}

      {aliasAction ? <Modal title={aliasAction.type === "delete" ? "Șterge aliasul" : "Editează aliasul"} subtitle={aliasAction.alias.client?.companyName || "Client canonic"} onClose={() => setAliasAction(null)}><form onSubmit={submitAliasAction}>{aliasAction.type === "edit" ? <Field label="Denumire alias"><input className="focus-input w-full" required name="aliasName" defaultValue={aliasAction.alias.aliasName} /></Field> : <p className="text-sm text-slate-300">Aliasul <strong className="text-white">{aliasAction.alias.aliasName}</strong> nu va mai fi folosit la importurile viitoare. Istoricul importurilor nu se modifică.</p>}<button className="focus-button mt-5 w-full justify-center" disabled={busy} type="submit">{aliasAction.type === "delete" ? "Șterge aliasul" : "Salvează aliasul"}</button></form></Modal> : null}
    </main>
  );
}

function ReceivablesTable({ rows, canValidate = false, onPayment }: { rows: JsonMap[]; canValidate?: boolean; onPayment?: (row: JsonMap) => void }) {
  return <><div className="mt-4 overflow-x-auto rounded-lg border border-focus-line"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-focus-navy text-xs uppercase text-slate-300"><tr><th className="p-3">Client / factură</th><th className="p-3">Firmă</th><th className="p-3">Scadență</th><th className="p-3 text-right">Facturat</th><th className="p-3 text-right">Încasat</th><th className="p-3 text-right">Rest</th><th className="p-3">Stare</th>{onPayment ? <th className="p-3">Acțiune</th> : null}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-focus-line bg-focus-panel/50"><td className="p-3"><strong className="block text-white">{row.client?.companyName || row.clientName || "Client nealocat"}</strong><span className="text-slate-400">{row.invoiceNumber || "Fără număr"}</span></td><td className="p-3 text-slate-200"><span className="block">{row.companyName}</span><small className="text-slate-500">{row.companyCode || "-"}</small></td><td className="p-3 text-slate-200">{formatDate(row.dueDate)}</td><td className="p-3 text-right font-bold text-white">{moneyLabel(row.invoicedAmount, row.currency)}</td><td className="p-3 text-right text-emerald-300">{moneyLabel(row.collectedAmount, row.currency)}</td><td className="p-3 text-right font-black text-focus-yellow">{moneyLabel(row.remainingAmount, row.currency)}</td><td className="p-3"><StatusBadge value={row.status} /></td>{onPayment ? <td className="p-3">{canValidate && Number(row.remainingAmount || 0) > 0 ? <button className="focus-button min-w-44 justify-center" type="button" onClick={() => onPayment(row)}><Banknote size={16} /> Înregistrează plată</button> : <span className="text-xs text-slate-500">Doar vizualizare</span>}</td> : null}</tr>)}</tbody></table></div>{!rows.length ? <Empty text="Nu există facturi pentru filtrele selectate." /> : null}</>;
}

function ReconciliationPanel({ data }: { data: JsonMap | null }) {
  if (!data) return <Empty text="Se încarcă raportul de reconciliere..." />;
  const labels: Record<string, string> = { archived_legacy_snapshot: "Snapshot legacy arhivat", import_anomaly: "Anomalie import", manual_correction: "Corecție manuală", unresolved: "Nerezolvat" };
  return <section><h2 className="text-xl font-black text-white">Reconciliere legacy</h2><p className="mt-1 text-sm text-slate-400">Raport read-only. Compară snapshotul istoric cu suma plăților active; nu corectează automat nicio valoare.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Object.entries(labels).map(([key, label]) => <article className="rounded-lg border border-focus-line bg-focus-panel/50 p-4" key={key}><p className="text-xs font-black uppercase text-slate-400">{label}</p><strong className="mt-1 block text-2xl text-white">{data.counts?.[key] || 0}</strong></article>)}</div><SimpleTable title="Diferențe de verificat" headers={["Client / factură", "Snapshot", "Ledger activ", "Diferență", "Categorie", "Dovadă"]} rows={(data.items || []).map((row: JsonMap) => [`${row.clientName} · ${row.invoiceNumber || "Fără număr"}`, moneyLabel(row.snapshotCollected, row.currency), moneyLabel(row.activeLedgerCollected, row.currency), moneyLabel(row.difference, row.currency), labels[row.category] || row.category, row.evidence])} /></section>;
}

function LazySection({ data, fallback, children }: { data: LazyData | null | undefined; fallback: string; children: ReactNode }) { return data ? <>{children}</> : <Empty text={fallback} />; }
function LazyPagination({ data, onChange }: { data: LazyData | null | undefined; onChange: (page: number) => void | Promise<void> }) { return data?.pagination ? <Pagination value={data.pagination} onChange={onChange} /> : null; }

function SimpleTable({ title, subtitle, headers, rows }: { title: string; subtitle?: string; headers: string[]; rows: ReactNode[][] }) {
  return <section><h2 className="text-xl font-black text-white">{title}</h2>{subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}<div className="mt-4 overflow-x-auto rounded-lg border border-focus-line"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-focus-navy text-xs uppercase text-slate-300"><tr>{headers.map((header) => <th className="p-3" key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr className="border-t border-focus-line bg-focus-panel/50" key={index}>{row.map((cell, cellIndex) => <td className="p-3 text-slate-200" key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>{!rows.length ? <Empty text="Nu există înregistrări." /> : null}</section>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true"><div className="focus-card max-h-[92vh] w-full max-w-2xl overflow-auto rounded-lg p-5"><div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase text-focus-yellow">Facturi clienți</p><h2 className="text-xl font-black text-white">{title}</h2>{subtitle ? <p className="text-sm text-slate-400">{subtitle}</p> : null}</div><button className="focus-button secondary" type="button" onClick={onClose}>Închide</button></div>{children}</div></div>;
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) { return <label className={`grid gap-1 text-sm font-bold text-slate-200 ${wide ? "sm:col-span-2" : ""}`}>{label}{children}</label>; }
function OptionField({ label, name, options, defaultValue, empty = "Selectează", required = false }: { label: string; name: string; options: Option[]; defaultValue?: string | null; empty?: string; required?: boolean }) { return <Field label={label}><select className="focus-input" name={name} defaultValue={defaultValue || ""} required={required}><option value="">{empty}</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}{option.detail ? ` · ${option.detail}` : ""}</option>)}</select></Field>; }

function Pagination({ value, onChange }: { value: PaginationValue; onChange: (page: number) => void | Promise<void> }) {
  if (value.totalPages <= 1) return null;
  return <div className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-300"><span>{value.total} înregistrări · pagina {value.page} din {value.totalPages}</span><div className="flex gap-2"><button className="focus-button secondary" type="button" disabled={value.page <= 1} onClick={() => void onChange(value.page - 1)}>Anterior</button><button className="focus-button secondary" type="button" disabled={value.page >= value.totalPages} onClick={() => void onChange(value.page + 1)}>Următor</button></div></div>;
}

function InvoiceMetric({ label, value, detail, icon, tone = "neutral" }: { label: string; value: string; detail: string; icon: ReactNode; tone?: "neutral" | "green" | "red" }) { const toneClass = tone === "green" ? "text-emerald-300" : tone === "red" ? "text-red-200" : "text-white"; return <div className="min-w-0"><p className="flex items-center gap-1.5 text-[11px] font-black uppercase text-slate-400">{icon}{label}</p><strong className={`mt-1 block truncate text-sm ${toneClass}`} title={value}>{value}</strong><small className="text-xs text-slate-500">{detail}</small></div>; }
function PaymentPreviewMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "green" | "yellow" }) { const toneClass = tone === "green" ? "text-emerald-300" : tone === "yellow" ? "text-focus-yellow" : "text-white"; return <div><p className="text-[11px] font-black uppercase text-slate-400">{label}</p><strong className={`mt-1 block text-sm ${toneClass}`}>{value}</strong></div>; }
function Empty({ text }: { text: string }) { return <div className="mt-4 rounded-lg border border-dashed border-focus-line p-6 text-center text-sm text-slate-400">{text}</div>; }
function StatusBadge({ value }: { value: string }) { const tone = ["collected", "confirmed", "imported", "allocated_auto", "active"].includes(value) ? "bg-emerald-950 text-emerald-200" : ["conflict", "overdue", "failed", "cancelled"].includes(value) ? "bg-red-950 text-red-200" : "bg-amber-950 text-amber-100"; return <span className={`inline-flex rounded px-2 py-1 text-xs font-black ${tone}`}>{statusLabel(value)}</span>; }
function statusLabel(value: string) { return ({ collected: "Încasată", collected_partial: "Parțial încasată", client_credit: "Credit client", overdue: "Scadentă", in_term: "În termen", due_today: "Scadentă azi", due_soon: "Scadentă curând", needs_review: "Necesită verificare", confirmed: "Confirmat", preview_ready: "Preview pregătit", needs_confirmation: "Necesită confirmare", allocated_auto: "Alocat automat", manual: "Alocare manuală", conflict: "Conflict", imported: "Importat", unchanged: "Neschimbat", ignored: "Ignorat", active: "Activă", cancelled: "Anulată", rejected: "Anulat" } as Record<string, string>)[value] || value; }
function moneyLabel(value: unknown, currency: unknown) { const number = Number(value || 0); return `${new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number)} ${String(currency || "")}`.trim(); }
function formatDate(value: unknown) { if (!value) return "-"; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("ro-RO").format(date); }
function normalizeVisible(value: string) { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, ""); }
function rowConfirmationAction(row: JsonMap): RowResolutionAction {
  if (row.proposedAction === "keep_active_ledger") return "confirm_ledger";
  if (row.status === "needs_confirmation" && Number(row.reportRemainingAmount) < 0) return "confirm_credit";
  return "confirm";
}
function firstNonEmptyGroup(preview: JsonMap, preferred?: string) { if (preferred && preview.groups?.[preferred]?.length) return preferred; return ["conflict", "manual", "needs_confirmation", "allocated_auto", "updates", "existing", "credit", "unchanged", "imported", "ignored"].find((key) => preview.groups?.[key]?.length) || "allocated_auto"; }
function nullableFormValue(data: FormData, key: string) { const value = String(data.get(key) || "").trim(); return value || null; }
