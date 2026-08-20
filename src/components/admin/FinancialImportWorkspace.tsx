"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BadgeCheck, CreditCard, FileCheck2, FileSpreadsheet, Receipt, Upload, WalletCards } from "lucide-react";

type Json = Record<string, any>;
type ImportSource = "bank" | "smartbill";

const companyOptions = [
  { code: "FOCUS_MEDIA", name: "Focus Media", label: "FOCUS MEDIA OUTDOOR SRL" },
  { code: "EXCELLENCE_MEDIA", name: "Excellence Media", label: "EXCELLENCE MEDIA PRODUCTION SRL" },
  { code: "FOCUS_BG", name: "Focus BG / Focus Media LLC EOOD", label: "FOCUS MEDIA EOOD Bulgaria" }
];

export function FinancialImportWorkspace(props: Json) {
  const [source, setSource] = useState<ImportSource>("bank");

  useEffect(() => {
    if (props.bankPreview) setSource("bank");
    else if (props.smartPreview) setSource("smartbill");
  }, [props.bankPreview, props.smartPreview]);

  return <section className="grid gap-5">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-focus-line pb-4">
      <div>
        <p className="text-xs font-black uppercase text-focus-yellow">Import financiar</p>
        <h2 className="mt-1 text-2xl font-black text-white">Import nou</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">Analizează fișierul, verifică încadrarea și confirmă numai după preview. Citirea nu modifică registrele.</p>
      </div>
      <div className="inline-flex rounded-lg border border-focus-line bg-focus-panel/50 p-1" role="tablist" aria-label="Sursa importului">
        <button className={`focus-button ${source === "bank" ? "" : "secondary"}`} type="button" role="tab" aria-selected={source === "bank"} onClick={() => setSource("bank")}>
          <WalletCards size={17} /> Extrase bancare
        </button>
        <button className={`focus-button ${source === "smartbill" ? "" : "secondary"}`} type="button" role="tab" aria-selected={source === "smartbill"} onClick={() => setSource("smartbill")}>
          <FileSpreadsheet size={17} /> SmartBill
        </button>
      </div>
    </header>

    {source === "bank" ? <BankImportPanel {...props} /> : <SmartBillImportPanel {...props} />}
  </section>;
}

function BankImportPanel(props: Json) {
  return <section className="grid min-w-0 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
    <div className="border-r-0 border-focus-line xl:border-r xl:pr-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-focus-line bg-focus-panel text-focus-yellow"><CreditCard size={20} /></span>
        <div><h3 className="font-black text-white">Extras bancar CSV</h3><p className="text-xs text-slate-400">BCR / George și Revolut Business</p></div>
      </div>
      <form className="mt-5 grid gap-4" onSubmit={props.onPreviewBank}>
        <Field label="Entitate juridică">
          <select className="focus-input" name="companyCode">
            <option value="">Detectare automată pentru BCR / George</option>
            {companyOptions.map((company) => <option key={company.code} value={company.code}>{company.label}</option>)}
          </select>
        </Field>
        <p className="-mt-2 text-xs text-slate-500">Pentru Revolut, selectarea entității este obligatorie deoarece CSV-ul nu conține un titular verificabil.</p>
        <Field label="Fișier CSV">
          <input ref={props.bankFileRef} className="focus-input" name="file" type="file" accept=".csv,text/csv" required />
        </Field>
        {props.canUpload ? <button className="focus-button w-full justify-center" type="submit"><Upload size={17} /> Analizează extrasul</button> : null}
      </form>
      <ol className="mt-6 grid gap-2 border-t border-focus-line pt-4 text-xs text-slate-400">
        <li><strong className="text-slate-200">1.</strong> Detectăm banca, conturile și monedele.</li>
        <li><strong className="text-slate-200">2.</strong> Separăm furnizori, încasări, transferuri și comisioane.</li>
        <li><strong className="text-slate-200">3.</strong> Confirmarea scrie atomic și ignoră duplicatele.</li>
      </ol>
    </div>
    <div className="min-w-0">
      {props.bankPreview ? <BankPreview preview={props.bankPreview} canConfirm={props.canConfirm} onConfirm={props.onConfirmBank} /> : <EmptyPreview icon={<WalletCards size={26} />} title="Preview extras bancar" text="Încarcă un extras BCR/George sau Revolut pentru a vedea conturile, totalurile și clasificarea înainte de import." />}
    </div>
  </section>;
}

function BankPreview({ preview, canConfirm, onConfirm }: Json) {
  const splitFees = Math.max(0, Number(preview.rowCount || 0) - Number(preview.sourceRowCount || 0));
  return <div className="grid gap-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-focus-line px-2 py-1 text-xs font-black uppercase text-focus-yellow">{preview.bankName}</span>
          <span className="rounded-md border border-focus-line px-2 py-1 text-xs font-bold text-slate-300">{preview.accounts?.length || 1} conturi</span>
        </div>
        <h3 className="mt-3 text-xl font-black text-white">{preview.legalName}</h3>
        <p className="mt-1 text-sm text-slate-400">{preview.sourceRowCount} operațiuni din fișier · {preview.rowCount} mișcări importabile{splitFees ? ` · ${splitFees} comisioane separate` : ""}</p>
      </div>
      {canConfirm ? <button className="focus-button" type="button" onClick={onConfirm}><BadgeCheck size={17} /> Confirmă importul bancar</button> : null}
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {(preview.totals || []).map((total: Json) => <article className="rounded-lg border border-focus-line bg-focus-panel/45 p-4" key={total.currency}>
        <p className="text-xs font-black uppercase text-slate-400">Total {total.currency}</p>
        <p className="mt-2 flex justify-between text-sm text-slate-300">Intrări <strong className="text-emerald-300">{moneyLabel(total.credit, total.currency)}</strong></p>
        <p className="mt-1 flex justify-between text-sm text-slate-300">Ieșiri <strong className="text-red-200">{moneyLabel(total.debit, total.currency)}</strong></p>
      </article>)}
    </div>

    <section>
      <h4 className="text-sm font-black uppercase text-slate-300">Conturi detectate</h4>
      <div className="mt-2 overflow-x-auto rounded-lg border border-focus-line">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-focus-navy text-xs uppercase text-slate-400"><tr><th className="p-3">Cont</th><th className="p-3">Monedă</th><th className="p-3">Perioadă</th><th className="p-3 text-right">Tranzacții</th><th className="p-3 text-right">Sold final</th></tr></thead>
          <tbody>{(preview.accounts || []).map((account: Json) => <tr className="border-t border-focus-line" key={account.accountKey}><td className="p-3 text-white"><strong>{account.label}</strong><small className="block text-slate-500">{account.iban || "Cont valutar Revolut fără IBAN în export"}</small></td><td className="p-3 text-slate-200">{account.currency}</td><td className="p-3 text-slate-300">{dateOnly(account.periodStart)} - {dateOnly(account.periodEnd)}</td><td className="p-3 text-right font-bold text-white">{account.rowCount}</td><td className="p-3 text-right font-bold text-white">{account.closingBalance == null ? "-" : moneyLabel(account.closingBalance, account.currency)}</td></tr>)}</tbody>
        </table>
      </div>
    </section>

    <section>
      <h4 className="text-sm font-black uppercase text-slate-300">Clasificare propusă</h4>
      <div className="mt-2 flex flex-wrap gap-2">{Object.entries(preview.counts || {}).sort((left, right) => Number(right[1]) - Number(left[1])).map(([key, value]) => <span className="rounded-md border border-focus-line bg-focus-panel/40 px-3 py-2 text-xs text-slate-300" key={key}>{classificationLabel(key)} <strong className="ml-1 text-white">{String(value)}</strong></span>)}</div>
    </section>

    {preview.warnings?.length ? <details className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3"><summary className="cursor-pointer text-sm font-bold text-amber-200">{preview.warnings.length} avertismente de verificat</summary><ul className="mt-2 grid gap-1 text-xs text-slate-300">{preview.warnings.slice(0, 20).map((warning: string, index: number) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></details> : null}

    <section>
      <h4 className="text-sm font-black uppercase text-slate-300">Primele tranzacții</h4>
      <div className="mt-2 overflow-x-auto rounded-lg border border-focus-line">
        <table className="w-full min-w-[780px] text-left text-xs">
          <thead className="bg-focus-navy uppercase text-slate-400"><tr><th className="p-3">Data</th><th className="p-3">Descriere</th><th className="p-3">Categorie</th><th className="p-3 text-right">Sumă</th></tr></thead>
          <tbody>{(preview.sampleRows || []).map((row: Json, index: number) => {
            const credit = Number(row.creditAmount || 0) > 0;
            const amount = credit ? row.creditAmount : row.debitAmount;
            return <tr className="border-t border-focus-line" key={`${row.rowNumber}-${index}`}><td className="p-3 text-slate-300">{dateOnly(row.bookedAt)}</td><td className="p-3 text-white"><strong>{row.description}</strong><small className="block text-slate-500">{row.accountLabel || "Cont bancar"}</small></td><td className="p-3 text-slate-300">{classificationLabel(row.classification)}</td><td className={`p-3 text-right font-black ${credit ? "text-emerald-300" : "text-red-200"}`}>{credit ? "+" : "-"}{moneyLabel(amount, row.currency)}</td></tr>;
          })}</tbody>
        </table>
      </div>
    </section>
  </div>;
}

function SmartBillImportPanel(props: Json) {
  return <section className="grid min-w-0 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
    <div className="border-r-0 border-focus-line xl:border-r xl:pr-5">
      <div className="flex items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-focus-line bg-focus-panel text-focus-yellow"><Receipt size={20} /></span><div><h3 className="font-black text-white">Documente SmartBill</h3><p className="text-xs text-slate-400">Facturi clienți și documente furnizori</p></div></div>
      <form className="mt-5 grid gap-4" onSubmit={props.onPreviewSmart}>
        <Field label="Tip raport"><select className="focus-input" value={props.smartType} onChange={(event) => props.onSmartType(event.target.value)}><option value="customer_invoices">Facturi emise clienților</option><option value="supplier_documents">Documente furnizori</option></select></Field>
        <Field label="Entitate juridică"><select className="focus-input" value={props.smartCompany} onChange={(event) => props.onSmartCompany(event.target.value)}>{companyOptions.map((company) => <option key={company.code} value={company.name}>{company.label}</option>)}</select></Field>
        {props.smartType === "supplier_documents" ? <Field label="Tip implicit document"><select className="focus-input" value={props.defaultDocumentType} onChange={(event) => props.onDocumentType(event.target.value)}><option value="unknown">Necunoscut / verificare ulterioară</option><option value="invoice">Factură</option><option value="receipt">Bon fiscal</option><option value="proforma">Proformă</option><option value="delivery_note">Aviz</option><option value="other">Altul</option></select></Field> : null}
        <Field label="Fișier .xls / .xlsx"><input ref={props.smartFileRef} className="focus-input" name="file" type="file" accept=".xls,.xlsx" required /></Field>
        {props.canUpload ? <button className="focus-button w-full justify-center" type="submit"><FileSpreadsheet size={17} /> Analizează SmartBill</button> : null}
      </form>
      <p className="mt-5 border-t border-focus-line pt-4 text-xs text-slate-400">Facturile negative sunt tratate ca storno, discount sau notă de credit. Ele reduc soldul numai după legarea sigură la factura pozitivă.</p>
    </div>
    <div className="min-w-0">{props.smartPreview ? <SmartPreview preview={props.smartPreview} actions={props.manualActions} canConfirm={props.canConfirm} onAction={props.onManualAction} onConfirm={props.onConfirmSmart} /> : <EmptyPreview icon={<FileCheck2 size={26} />} title="Preview documente" text="Încarcă raportul SmartBill pentru a vedea documentele noi, duplicatele, storno-urile și rândurile care necesită decizie." />}</div>
  </section>;
}

function SmartPreview({ preview, actions, canConfirm, onAction, onConfirm }: Json) {
  const unresolved = Object.values(actions as Record<string, Json>).some((action) =>
    (action.action === "match_existing" && !action.entityId) || (action.action === "link_adjustment" && !action.linkedFinancialRowId)
  );
  const summary = preview.summary || {};
  const totals = preview.reportType === "customer_invoices" ? summary.totalReceivableByCurrency : summary.totalPayableByCurrency;
  return <div className="grid gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-black text-white">Rezultatul analizei</h3><p className="text-sm text-slate-400">{summary.rowCount} rânduri · {summary.duplicateCount} duplicate · {Number(summary.needsReviewCount || 0) + Number(summary.invalidCount || 0) + Number(summary.adjustmentNeedsReviewCount || 0)} de verificat</p></div>{canConfirm ? <button className="focus-button" type="button" disabled={unresolved} onClick={onConfirm}><BadgeCheck size={17} /> Confirmă rândurile sigure</button> : null}</div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard label="Rânduri" value={summary.rowCount || 0} />
      <SummaryCard label="Importabile automat" value={Number(summary.matchedCount || 0) + Number(summary.createClientCount || 0) + Number(summary.createSupplierCount || 0) + Number(summary.autoLinkedAdjustmentCount || 0)} />
      <SummaryCard label="Storno / discounturi legate automat" value={summary.autoLinkedAdjustmentCount || 0} />
      <SummaryCard label="Storno / discounturi necesită verificare" value={summary.adjustmentNeedsReviewCount || 0} warning />
    </div>
    <div className="flex flex-wrap gap-2"><span className="text-xs font-black uppercase text-slate-400">Total importabil</span>{Object.entries(totals || {}).map(([currency, amount]) => <span className="rounded-md border border-focus-line px-3 py-1 text-xs text-slate-300" key={currency}><strong className="text-white">{moneyLabel(amount, currency)}</strong></span>)}</div>
    {unresolved ? <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs font-bold text-amber-200">Finalizează selectarea partenerului sau a facturii pozitive pentru fiecare decizie manuală.</p> : null}
    <div className="max-h-[590px] overflow-auto rounded-lg border border-focus-line">
      <table className="w-full min-w-[1020px] text-left text-xs">
        <thead className="sticky top-0 z-10 bg-focus-navy uppercase text-slate-400"><tr><th className="p-3">Partener</th><th className="p-3">Document</th><th className="p-3">Valoare</th><th className="p-3">Încadrare</th><th className="p-3">Legătură / motiv</th><th className="p-3">Decizie</th></tr></thead>
        <tbody>{preview.rows.map((row: Json) => {
          const key = `${row.dedupeKey}:${row.rowNumber}`;
          const action = actions[key];
          const adjustment = Boolean(row.adjustmentKind || Number(row.totalAmount) < 0);
          const linkedCandidate = row.adjustmentCandidates?.find((candidate: Json) => candidate.id === row.linkedFinancialRowId);
          const remainingAfterAdjustment = linkedCandidate ? Math.max(0, Number(linkedCandidate.remainingAmount || 0) - Math.abs(Number(row.totalAmount || 0))) : null;
          const needsDecision = ["NEEDS_REVIEW", "ADJUSTMENT_NEEDS_REVIEW", "INVALID"].includes(row.proposedAction);
          return <tr className="border-t border-focus-line align-top" key={key}>
            <td className="p-3 text-white"><strong>{row.entityName}</strong><small className="block text-slate-500">{row.fiscalCode || "Fără CIF"}</small>{row.warning ? <small className="mt-1 block text-amber-200">{row.warning}</small> : null}</td>
            <td className="p-3 text-slate-200"><strong>{row.documentNumber}</strong>{adjustment ? <span className="mt-1 block w-fit rounded border border-amber-500/40 px-2 py-0.5 text-[10px] font-black uppercase text-amber-200">{adjustmentLabel(row.adjustmentKind)}</span> : null}</td>
            <td className={`p-3 font-black ${Number(row.totalAmount) < 0 ? "text-amber-200" : "text-white"}`}>{moneyLabel(row.totalAmount, row.currency)}</td>
            <td className="p-3"><StatusBadge value={row.proposedAction} /></td>
            <td className="max-w-72 p-3 text-slate-300">{row.linkedDocumentNumber ? <><strong className="block text-white">Factura legată: {row.linkedDocumentNumber}</strong><small className="block">Încredere: {confidenceLabel(row.matchConfidence)}</small>{remainingAfterAdjustment != null ? <small className="block text-emerald-300">Sold după ajustare: {moneyLabel(remainingAfterAdjustment, row.currency)}</small> : null}</> : <span>{row.adjustmentReason || row.warning || "-"}</span>}</td>
            <td className="min-w-72 p-3">{needsDecision ? <div className="grid gap-2"><select className="focus-input text-xs" value={action?.action || ""} onChange={(event) => onAction(row, event.target.value)}><option value="">Rămâne neimportat</option><option value="skip">Ignoră explicit</option>{adjustment && row.entityKind === "client" && row.adjustmentCandidates?.length ? <option value="link_adjustment">Leagă storno la factură</option> : null}{adjustment ? null : <><option value="match_existing">Asociază partener existent</option><option value="create_new">Creează partener nou</option></>}</select>{action?.action === "match_existing" ? <SmartEntityPicker entityKind={row.entityKind} selected={action} onSelect={(entity: Json) => onAction(row, "match_existing", { entityId: entity.id, entityLabel: entity.name })} /> : null}{action?.action === "link_adjustment" ? <AdjustmentPicker candidates={row.adjustmentCandidates || []} selectedId={action.linkedFinancialRowId} onSelect={(candidate: Json) => onAction(row, "link_adjustment", { linkedFinancialRowId: candidate.id })} /> : null}</div> : <span className="text-slate-400">Automat{row.matchedEntityName ? ` · ${row.matchedEntityName}` : ""}</span>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </div>;
}

function SmartEntityPicker({ entityKind, selected, onSelect }: { entityKind: "client" | "supplier"; selected: Json; onSelect: (entity: Json) => void }) {
  const [query, setQuery] = useState(selected.entityLabel || "");
  const [options, setOptions] = useState<Json[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/admin/financial/smartbill/options?kind=${entityKind}&q=${encodeURIComponent(query)}`);
        const payload = await response.json();
        setOptions(response.ok ? payload.options || [] : []);
      } finally { setLoading(false); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [entityKind, query]);
  return <div className="grid gap-1"><input className="focus-input text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Caută ${entityKind === "client" ? "client" : "furnizor"} după nume sau CIF`} /><select className="focus-input text-xs" value={selected.entityId || ""} onChange={(event) => { const entity = options.find((option) => option.id === event.target.value); if (entity) { onSelect(entity); setQuery(entity.name); } }}><option value="">{loading ? "Se caută..." : "Selectează partenerul"}</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.taxId || "fără CIF"}</option>)}</select></div>;
}

function AdjustmentPicker({ candidates, selectedId, onSelect }: { candidates: Json[]; selectedId?: string; onSelect: (candidate: Json) => void }) {
  return <select className="focus-input text-xs" value={selectedId || ""} onChange={(event) => { const candidate = candidates.find((item) => item.id === event.target.value); if (candidate) onSelect(candidate); }}><option value="">Selectează factura pozitivă</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.documentNumber || "Fără număr"} · valoare {moneyLabel(candidate.totalAmount, candidate.currency)} · sold {moneyLabel(candidate.remainingAmount, candidate.currency)}</option>)}</select>;
}

function EmptyPreview({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="grid min-h-72 place-items-center rounded-lg border border-dashed border-focus-line p-8 text-center"><div><span className="mx-auto grid h-14 w-14 place-items-center rounded-lg border border-focus-line text-slate-400">{icon}</span><h3 className="mt-4 font-black text-white">{title}</h3><p className="mt-2 max-w-lg text-sm text-slate-400">{text}</p></div></div>;
}

function SummaryCard({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) { return <article className="rounded-lg border border-focus-line bg-focus-panel/45 p-3"><p className="text-[11px] font-black uppercase text-slate-400">{label}</p><strong className={`mt-1 block text-2xl ${warning && value ? "text-amber-200" : "text-white"}`}>{value}</strong></article>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="grid gap-1 text-sm font-bold text-slate-200">{label}{children}</label>; }
function StatusBadge({ value }: { value: string }) { return <span className="inline-flex rounded-md border border-focus-line bg-black/20 px-2 py-1 text-xs font-black uppercase text-slate-200">{statusLabel(value)}</span>; }
function adjustmentLabel(value: string) { return ({ STORNO: "Storno", DISCOUNT_ADJUSTMENT: "Discount", CREDIT_NOTE: "Notă de credit" } as Record<string, string>)[value] || "Document negativ"; }
function confidenceLabel(value: string) { return ({ high: "ridicată", medium: "medie", low: "redusă" } as Record<string, string>)[value] || "neprecizată"; }
function statusLabel(value: string) { return ({ AUTO_MATCHED: "alocare sigură", PROPOSE_CREATE_CLIENT: "client nou", PROPOSE_CREATE_SUPPLIER: "furnizor nou", DUPLICATE: "duplicat", NEEDS_REVIEW: "de verificat", INVALID: "invalid", IGNORED: "ignorat", AUTO_LINK_ADJUSTMENT: "storno legat", ADJUSTMENT_NEEDS_REVIEW: "storno de verificat" } as Record<string, string>)[value] || String(value || "").replaceAll("_", " "); }
function classificationLabel(value: string) { return ({ customer_receipt_candidate: "Încasare client", supplier_payment_candidate: "Plată furnizor", card_purchase: "Plată card", bank_fee: "Comision bancar", tax_payment: "Taxe / buget", payroll_payment: "Salarii", employee_payment: "Decont angajat", associate_payment: "Plată asociat", dividend_payment: "Dividende", copyright_payment: "Drepturi de autor (CDA)", internal_transfer: "Transfer între conturi proprii", intercompany_transfer: "Transfer între firme", other: "Altă mișcare", needs_review: "Necesită verificare" } as Record<string, string>)[value] || String(value || "").replaceAll("_", " "); }
function moneyLabel(value: unknown, currency: unknown) { return `${new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0))} ${String(currency || "")}`; }
function dateOnly(value: unknown) { const date = new Date(String(value || "")); return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium", timeZone: "Europe/Bucharest" }).format(date); }
