"use client";

import { useState } from "react";
import { useCommercialChoices } from "@/components/admin/use-commercial-choices";
import { Field, SelectField } from "./WorkspaceUi";

type PartyOption = { id: string; companyName: string };
const emptyOptions: PartyOption[] = [];

/** Uses the same scoped, paged search and selected-ID hydration as quote editing. */
export function CampaignPartyPicker({ label, value, onChange }: { label: string; value: string; onChange: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const choices = useCommercialChoices("clients", emptyOptions, value, query, page);
  return <div className="grid min-w-0 gap-2 rounded-lg border border-focus-line p-3">
    <Field label={`Caută ${label.toLocaleLowerCase("ro")}`} value={query} onChange={(next) => { setQuery(next); setPage(1); }} placeholder="Nume sau cod fiscal" />
    <SelectField label={label} value={value} onChange={onChange}>
      <option value="">De completat</option>
      {value && !choices.rows.some((row) => row.id === value) ? <option value={value}>{choices.loading ? "Se verifică asocierea..." : "Asociere de verificat"}</option> : null}
      {choices.rows.map((row) => <option value={row.id} key={row.id}>{row.companyName}</option>)}
    </SelectField>
    {choices.loading ? <p role="status" className="text-xs text-slate-400">Căutăm în portofoliul autorizat...</p> : choices.page ? <p className="text-xs text-slate-400">{choices.page.total} rezultate · pagina {choices.page.page}/{choices.page.totalPages}</p> : null}
    {choices.page && choices.page.totalPages > 1 ? <div className="flex flex-wrap gap-2">
      <button type="button" className="focus-button secondary" aria-label={`Pagina precedentă pentru ${label}`} disabled={choices.loading || choices.page.page <= 1} onClick={() => setPage(page - 1)}>Înapoi</button>
      <button type="button" className="focus-button secondary" aria-label={`Pagina următoare pentru ${label}`} disabled={choices.loading || choices.page.page >= choices.page.totalPages} onClick={() => setPage(page + 1)}>Înainte</button>
    </div> : null}
    {choices.error ? <p role="alert" className="text-xs text-rose-200">{choices.error}</p> : null}
  </div>;
}
