"use client";

import { useState } from "react";
import { FileArchive, Upload, X } from "lucide-react";
import type { AccountOwnerOption } from "@/lib/client-campaigns";
import type { WorkspaceDocument } from "@/lib/client-campaign-workspaces";

export type ClientForm = {
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

export type CampaignForm = {
  clientId: string;
  campaignName: string;
  campaignCode: string;
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

export const emptyClientForm: ClientForm = {
  companyName: "", clientType: "direct_client", taxId: "", registryNumber: "", billingAddress: "",
  generalEmail: "", generalPhone: "", website: "", status: "active", accountOwnerUserId: "",
  ownerChangeReason: "", notes: ""
};

export const emptyCampaignForm: CampaignForm = {
  clientId: "", campaignName: "", campaignCode: "", status: "draft", companyEntity: "Focus Media",
  sellerUserId: "", accountOwnerUserId: "", startDate: "", endDate: "", currency: "EUR",
  totalContractValue: "", paymentTermType: "30_days", paymentTermDays: "30",
  billingRule: "manual_per_contract", billingFrequency: "monthly", notes: ""
};

export function WorkspaceHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <section className="rounded-lg border border-focus-line bg-focus-ink/75 p-5 shadow-[0_16px_45px_rgba(0,0,0,0.16)]">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-black uppercase text-focus-yellow">{eyebrow}</p>
        <h1 className="font-display text-3xl font-black uppercase text-white">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  </section>;
}

export function Panel({ title, action, children, className = "" }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-lg border border-focus-line bg-focus-ink/70 p-4 ${className}`}>
    {title || action ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      {title ? <h2 className="text-sm font-black uppercase text-white">{title}</h2> : <span />}
      {action}
    </div> : null}
    {children}
  </section>;
}

export function Tabs({ value, onChange, items }: { value: string; onChange: (value: string) => void; items: Array<{ id: string; label: string }> }) {
  return <div className="flex max-w-full gap-2 overflow-x-auto pb-1" role="tablist">
    {items.map((item) => <button key={item.id} type="button" role="tab" aria-selected={value === item.id} className={`focus-button shrink-0 ${value === item.id ? "" : "secondary"}`} onClick={() => onChange(item.id)}>{item.label}</button>)}
  </div>;
}

export function Field({ label, value, onChange, type = "text", disabled, placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; disabled?: boolean; placeholder?: string }) {
  return <label className="grid min-w-0 gap-1 text-sm font-bold text-slate-200">{label}
    <input className="focus-input min-w-0" type={type} value={value} disabled={disabled} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
  </label>;
}

export function SelectField({ label, value, onChange, disabled, children }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; children: React.ReactNode }) {
  return <label className="grid min-w-0 gap-1 text-sm font-bold text-slate-200">{label}
    <select className="focus-input min-w-0" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{children}</select>
  </label>;
}

export function TextArea({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <label className="grid gap-1 text-sm font-bold text-slate-200">{label}
    <textarea className="focus-input min-h-24" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
  </label>;
}

export function OwnerSelect({ label = "Responsabil", value, onChange, owners, disabled }: { label?: string; value: string; onChange: (value: string) => void; owners: AccountOwnerOption[]; disabled?: boolean }) {
  return <SelectField label={label} value={value} onChange={onChange} disabled={disabled}>
    <option value="">Nesetat</option>
    {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name} - {owner.role}</option>)}
  </SelectField>;
}

export function StatusBadge({ value }: { value: string }) {
  const tone = ["active", "booked", "collected", "paid", "completed"].includes(value.toLowerCase())
    ? "border-emerald-300/40 bg-emerald-400/10 text-emerald-100"
    : ["cancelled", "archived", "inactive", "overdue"].includes(value.toLowerCase())
      ? "border-red-300/40 bg-red-400/10 text-red-100"
      : "border-focus-yellow/45 bg-focus-yellow/10 text-focus-yellow";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black uppercase ${tone}`}>{statusLabel(value)}</span>;
}

export function Feedback({ tone, children }: { tone: "success" | "error" | "info"; children: React.ReactNode }) {
  const style = tone === "success" ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : tone === "error" ? "border-red-300/30 bg-red-400/10 text-red-100" : "border-sky-300/30 bg-sky-400/10 text-sky-100";
  return <p className={`rounded-lg border px-4 py-3 text-sm font-bold ${style}`}>{children}</p>;
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-focus-line bg-focus-navy/25 p-8 text-center text-sm text-slate-400">{children}</div>;
}

export function LoadingState({ text = "Se incarca..." }: { text?: string }) {
  return <div className="grid gap-3" aria-busy="true"><div className="h-16 animate-pulse rounded-lg bg-white/5" /><div className="h-24 animate-pulse rounded-lg bg-white/5" /><p className="text-center text-xs font-bold text-slate-400">{text}</p></div>;
}

export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return <div className="rounded-lg border border-red-300/30 bg-red-400/10 p-5 text-sm text-red-100"><p>{text}</p>{onRetry ? <button className="focus-button secondary mt-3" type="button" onClick={onRetry}>Reincearca</button> : null}</div>;
}

export function Pagination({ total, showing, canPrevious, canNext, busy, onPrevious, onNext }: { total: number; showing: number; canPrevious: boolean; canNext: boolean; busy: boolean; onPrevious: () => void; onNext: () => void }) {
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-focus-line pt-3 text-xs font-bold text-slate-400">
    <span>{showing} din {total}</span>
    <div className="flex gap-2"><button className="focus-button secondary" type="button" disabled={!canPrevious || busy} onClick={onPrevious}>Inapoi</button><button className="focus-button secondary" type="button" disabled={!canNext || busy} onClick={onNext}>Inainte</button></div>
  </div>;
}

export function DocumentsList({ documents }: { documents: WorkspaceDocument[] }) {
  if (!documents.length) return <EmptyState>Nu exista documente in aceasta sectiune.</EmptyState>;
  return <div className="grid gap-2">{documents.map((document) => <article className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-focus-line bg-focus-navy/30 p-3" key={document.id}>
    <div className="min-w-0"><p className="truncate font-black text-white">{document.fileName}</p><p className="text-xs text-slate-400">{documentTypeLabel(document.documentType)} / {dateLabel(document.uploadedAt)} / {document.uploadedByName || "Utilizator"}</p></div>
    <a className="focus-button secondary shrink-0" href={`/api/admin/client-documents/${document.id}`}><FileArchive size={16} /> Deschide</a>
  </article>)}</div>;
}

export function DocumentUploadDialog({ target, onClose, onSaved }: { target: { clientId?: string; campaignId?: string; label: string }; onClose: () => void; onSaved: () => void }) {
  const [documentType, setDocumentType] = useState("contract");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [storageUrl, setStorageUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true); setError("");
    try {
      const form = new FormData();
      if (target.clientId) form.set("clientId", target.clientId);
      if (target.campaignId) form.set("campaignId", target.campaignId);
      form.set("documentType", documentType);
      if (notes) form.set("notes", notes);
      if (file) form.set("file", file);
      if (storageUrl) form.set("storageUrl", storageUrl);
      const response = await fetch("/api/admin/client-documents", { method: "POST", body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Documentul nu a putut fi incarcat.");
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Documentul nu a putut fi incarcat."); }
    finally { setBusy(false); }
  }

  return <Dialog title="Incarca document" subtitle={target.label} onClose={onClose}>
    <div className="grid gap-3 md:grid-cols-2">
      <SelectField label="Tip document" value={documentType} onChange={setDocumentType}><option value="contract">Contract</option><option value="anexa">Anexa</option><option value="io">IO / comanda</option><option value="oferta">Oferta</option><option value="fiscal">Fiscal / CUI</option><option value="other">Alt document</option></SelectField>
      <Field label="Link document" value={storageUrl} onChange={setStorageUrl} placeholder="https://..." />
      <label className="grid gap-1 text-sm font-bold text-slate-200 md:col-span-2">Fisier<input className="focus-input" type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
      <div className="md:col-span-2"><TextArea label="Observatii" value={notes} onChange={setNotes} /></div>
    </div>
    {error ? <Feedback tone="error">{error}</Feedback> : null}
    <div className="mt-4 flex justify-end gap-2"><button className="focus-button secondary" type="button" onClick={onClose}>Renunta</button><button className="focus-button" type="button" disabled={busy || (!file && !storageUrl)} onClick={submit}><Upload size={16} /> {busy ? "Se incarca..." : "Salveaza"}</button></div>
  </Dialog>;
}

export function Dialog({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/75 p-4"><div className="my-auto w-full max-w-3xl rounded-lg border border-focus-line bg-focus-ink p-5 shadow-2xl">
    <div className="mb-4 flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase text-focus-yellow">{title}</p>{subtitle ? <h3 className="mt-1 text-xl font-black text-white">{subtitle}</h3> : null}</div><button className="grid h-10 w-10 place-items-center rounded-md border border-focus-line text-slate-300 hover:text-white" type="button" onClick={onClose} aria-label="Inchide"><X size={18} /></button></div>
    {children}
  </div></div>;
}

export function dateLabel(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export function moneyLabel(value: number, currency = "") {
  return `${new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 }).format(value || 0)} ${currency}`.trim();
}

export function nullable(value: string) { const text = value.trim(); return text || null; }
export function dateInput(value?: string | null) { return value ? value.slice(0, 10) : ""; }

function statusLabel(value: string) {
  const labels: Record<string, string> = { draft: "Ciorna", planned: "Planificata", active: "Activa", completed: "Finalizata", cancelled: "Anulata", incomplete: "Incompleta", scheduled: "Programata", ended: "Incheiata", archived: "Arhivata", prospect: "Prospect", inactive: "Inactiv", overdue: "Restanta", in_term: "In termen", due_soon: "Scadenta curand", BOOKED: "Rezervat", HOLD: "HOLD", RESERVED: "HOLD" };
  return labels[value] || labels[value.toLowerCase()] || value;
}

function documentTypeLabel(value: string) {
  const labels: Record<string, string> = { contract: "Contract", anexa: "Anexa", io: "IO / comanda", oferta: "Oferta", fiscal: "Fiscal / CUI", other: "Alt document" };
  return labels[value] || value;
}
