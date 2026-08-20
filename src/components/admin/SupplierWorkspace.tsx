"use client";

import { useEffect, useState } from "react";
import { Archive, PlusCircle, Save, Search } from "lucide-react";

type SupplierRow = {
  id: string;
  supplierName: string;
  taxId: string | null;
  generalEmail: string | null;
  generalPhone: string | null;
  status: string;
  notes: string | null;
};

type SupplierForm = {
  supplierName: string;
  taxId: string;
  generalEmail: string;
  generalPhone: string;
  notes: string;
};

const emptyForm: SupplierForm = {
  supplierName: "",
  taxId: "",
  generalEmail: "",
  generalPhone: "",
  notes: ""
};

export function SupplierWorkspace({ initialSuppliers, legalEntities, canManagePaymentRules }: { initialSuppliers: SupplierRow[]; legalEntities: Array<{ id: string; code: string; legalName: string }>; canManagePaymentRules: boolean }) {
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<SupplierForm>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentRules, setPaymentRules] = useState<Array<Record<string, any>>>([]);
  const [ruleEntityId, setRuleEntityId] = useState(legalEntities[0]?.id || "");
  const [immediateRuleEnabled, setImmediateRuleEnabled] = useState(false);
  const [sameDayRequired, setSameDayRequired] = useState(true);

  const filtered = suppliers.filter((supplier) => {
    const haystack = [supplier.supplierName, supplier.taxId, supplier.generalEmail, supplier.generalPhone].join(" ").toLowerCase();
    return !query || haystack.includes(query.toLowerCase());
  });

  function selectSupplier(supplier: SupplierRow) {
    setSelectedId(supplier.id);
    setForm(formFromSupplier(supplier));
    setMessage(null);
    setError(null);
  }

  useEffect(() => {
    if (!selectedId) { setPaymentRules([]); setImmediateRuleEnabled(false); return; }
    let cancelled = false;
    fetch(`/api/admin/financial/payment-rules?supplierId=${encodeURIComponent(selectedId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (cancelled) return;
        const rows = payload?.rules || [];
        setPaymentRules(rows);
        const selectedRule = rows.find((rule: Record<string, any>) => rule.legalEntityId === ruleEntityId && rule.active);
        setImmediateRuleEnabled(Boolean(selectedRule && ["always_presume_paid", "presume_paid_if_immediate"].includes(selectedRule.ruleMode)));
        setSameDayRequired(selectedRule?.requireSameDayDueDate ?? true);
      })
      .catch(() => { if (!cancelled) setPaymentRules([]); });
    return () => { cancelled = true; };
  }, [selectedId, ruleEntityId]);

  async function savePaymentRule() {
    if (!selectedId || !ruleEntityId || !canManagePaymentRules) return;
    setBusy(true); setMessage(null); setError(null);
    try {
      const active = paymentRules.find((rule) => rule.legalEntityId === ruleEntityId && rule.active);
      if (!immediateRuleEnabled) {
        if (active) {
          const response = await fetch(`/api/admin/financial/payment-rules/${active.id}`, { method: "DELETE" });
          const payload = await response.json().catch(() => null);
          if (!response.ok) throw new Error(payload?.error || "Regula nu a putut fi dezactivata.");
        }
        setMessage("Regula de plata imediata este dezactivata pentru aceasta entitate.");
      } else {
        const body = {
          legalEntityId: ruleEntityId,
          supplierId: selectedId,
          ruleMode: "presume_paid_if_immediate",
          requireSameDayDueDate: sameDayRequired,
          maxDueDays: 0,
          defaultPaymentMethod: "card_or_cash",
          priority: 100
        };
        const response = await fetch(active ? `/api/admin/financial/payment-rules/${active.id}` : "/api/admin/financial/payment-rules", {
          method: active ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Regula nu a putut fi salvata.");
        setMessage("Regula de plata imediata a fost salvata.");
      }
      const refreshed = await fetch(`/api/admin/financial/payment-rules?supplierId=${encodeURIComponent(selectedId)}`, { cache: "no-store" }).then((response) => response.json());
      setPaymentRules(refreshed.rules || []);
    } catch (ruleError) { setError(ruleError instanceof Error ? ruleError.message : "Regula nu a putut fi salvata."); }
    finally { setBusy(false); }
  }

  async function saveSupplier() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const isUpdate = Boolean(selectedId);
      const response = await fetch(isUpdate ? `/api/admin/suppliers/${selectedId}` : "/api/admin/suppliers", {
        method: isUpdate ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          supplierName: form.supplierName,
          taxId: nullable(form.taxId),
          generalEmail: nullable(form.generalEmail),
          generalPhone: nullable(form.generalPhone),
          notes: nullable(form.notes)
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Furnizorul nu a putut fi salvat.");
      if (payload?.supplier) {
        setSuppliers((current) => upsertSupplier(current, payload.supplier));
        setSelectedId(payload.supplier.id);
      }
      if (!isUpdate) setQuery("");
      setMessage(isUpdate ? "Furnizorul a fost actualizat." : "Furnizorul a fost creat.");
      await refreshSuppliers(payload?.supplier?.id || selectedId, payload?.supplier || null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Furnizorul nu a putut fi salvat.");
    } finally {
      setBusy(false);
    }
  }

  async function archiveSupplier() {
    if (!selectedId) return;
    const selected = suppliers.find((supplier) => supplier.id === selectedId);
    if (!window.confirm(`Arhivez furnizorul "${selected?.supplierName || "selectat"}"? Facturile istorice raman in sistem.`)) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/suppliers/${selectedId}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Furnizorul nu a putut fi arhivat.");
      setSuppliers((current) => current.filter((supplier) => supplier.id !== selectedId));
      setSelectedId("");
      setForm(emptyForm);
      setMessage("Furnizorul a fost arhivat.");
      await refreshSuppliers(null);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Furnizorul nu a putut fi arhivat.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshSuppliers(nextSelectedId?: string | null, fallbackSupplier?: SupplierRow | null) {
    const response = await fetch("/api/admin/suppliers", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return;
    const serverSuppliers = payload.suppliers || [];
    const nextSuppliers = fallbackSupplier && !serverSuppliers.some((item: SupplierRow) => item.id === fallbackSupplier.id)
      ? [fallbackSupplier, ...serverSuppliers]
      : serverSuppliers;
    setSuppliers(nextSuppliers);
    const next = nextSelectedId ? nextSuppliers.find((item: SupplierRow) => item.id === nextSelectedId) : null;
    setSelectedId(next?.id || "");
    setForm(next ? formFromSupplier(next) : emptyForm);
  }

  return (
    <main className="focus-container grid gap-5 py-6">
      <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Furnizori</p>
            <h1 className="font-display text-3xl font-black uppercase text-white">Furnizori si facturi furnizor</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">Furnizorul este entitate separata. Facturile de plata se adauga manual in Financiar si se leaga de furnizor.</p>
          </div>
          <button className="focus-button" type="button" onClick={() => { setSelectedId(""); setForm(emptyForm); setMessage(null); setError(null); }}>
            <PlusCircle size={18} /> Furnizor nou
          </button>
        </div>
      </section>

      {message ? <p className="rounded-lg border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm font-bold text-emerald-100">{message}</p> : null}
      {error ? <p className="rounded-lg border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-100">{error}</p> : null}

      <section className="grid gap-5 xl:grid-cols-[340px_1fr]">
        <aside className="rounded-lg border border-focus-line bg-focus-ink/70 p-4">
          <label className="grid gap-2">
            <span className="text-xs font-black uppercase text-slate-400">Cauta furnizor</span>
            <span className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input className="focus-input pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="nume, CUI, email" />
            </span>
          </label>
          <div className="mt-4 max-h-[calc(100vh-18rem)] overflow-auto pr-1">
            {filtered.map((supplier) => (
              <button
                key={supplier.id}
                className={`mb-2 w-full rounded-lg border p-3 text-left ${selectedId === supplier.id ? "border-focus-yellow bg-focus-yellow/10" : "border-focus-line bg-focus-navy/35"}`}
                type="button"
                onClick={() => selectSupplier(supplier)}
              >
                <span className="block font-black text-white">{supplier.supplierName}</span>
                <span className="mt-1 block text-xs text-slate-400">{supplier.taxId || "CUI nesetat"} / {supplier.status}</span>
              </button>
            ))}
            {!filtered.length ? <p className="rounded-lg border border-focus-line bg-focus-navy/35 p-5 text-sm text-slate-400">Nu exista furnizori.</p> : null}
          </div>
        </aside>

        <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-black uppercase text-focus-yellow">{selectedId ? "Editeaza furnizor" : "Creeaza furnizor"}</h2>
            <div className="flex flex-wrap gap-2">
              {selectedId ? (
                <button className="focus-button secondary" type="button" disabled={busy} onClick={archiveSupplier}>
                  <Archive size={18} /> Arhiveaza
                </button>
              ) : null}
              <button className="focus-button" type="button" disabled={busy || form.supplierName.trim().length < 2} onClick={saveSupplier}>
                <Save size={18} /> Salveaza
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Input label="Nume furnizor" value={form.supplierName} onChange={(supplierName) => setForm({ ...form, supplierName })} />
            <Input label="CUI / CIF" value={form.taxId} onChange={(taxId) => setForm({ ...form, taxId })} />
            <Input label="Email" value={form.generalEmail} onChange={(generalEmail) => setForm({ ...form, generalEmail })} />
            <Input label="Telefon" value={form.generalPhone} onChange={(generalPhone) => setForm({ ...form, generalPhone })} />
            <label className="grid gap-1 text-sm font-bold text-slate-200 md:col-span-2">
              Observatii
              <textarea className="focus-input min-h-24" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </label>
          </div>
          {selectedId ? <div className="mt-6 border-t border-focus-line pt-5">
            <h3 className="text-sm font-black uppercase text-focus-yellow">Comportament plata la cumparare</h3>
            <p className="mt-1 text-sm text-slate-400">Se aplica numai documentelor care respecta conditiile. O factura periodica cu scadenta viitoare nu este marcata automat achitata.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-bold text-slate-200">Entitate juridica<select className="focus-input" value={ruleEntityId} onChange={(event) => setRuleEntityId(event.target.value)}><option value="">Selecteaza</option>{legalEntities.map((entity) => <option key={entity.id} value={entity.id}>{entity.legalName}</option>)}</select></label>
              <label className="flex items-center gap-3 rounded-lg border border-focus-line p-3 text-sm font-bold text-slate-200"><input checked={immediateRuleEnabled} disabled={!canManagePaymentRules} type="checkbox" onChange={(event) => setImmediateRuleEnabled(event.target.checked)} /> Facturile sunt de regula platite la cumparare</label>
              <label className="flex items-center gap-3 text-sm text-slate-300"><input checked={sameDayRequired} disabled={!canManagePaymentRules || !immediateRuleEnabled} type="checkbox" onChange={(event) => setSameDayRequired(event.target.checked)} /> Cere scadenta in aceeasi zi</label>
              {canManagePaymentRules ? <button className="focus-button justify-self-start" disabled={busy || !ruleEntityId} type="button" onClick={savePaymentRule}><Save size={18} /> Salveaza regula</button> : <p className="text-xs text-slate-500">Doar vizualizare.</p>}
            </div>
          </div> : null}
        </section>
      </section>
    </main>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-1 text-sm font-bold text-slate-200">{label}
    <input className="focus-input" value={value} onChange={(event) => onChange(event.target.value)} />
  </label>;
}

function formFromSupplier(supplier: SupplierRow): SupplierForm {
  return {
    supplierName: supplier.supplierName,
    taxId: supplier.taxId || "",
    generalEmail: supplier.generalEmail || "",
    generalPhone: supplier.generalPhone || "",
    notes: supplier.notes || ""
  };
}

function upsertSupplier(suppliers: SupplierRow[], supplier: SupplierRow) {
  return [supplier, ...suppliers.filter((item) => item.id !== supplier.id)];
}

function nullable(value: string) {
  const text = value.trim();
  return text || null;
}
