"use client";

import type { LocationSelectionFilters as SelectionFilters, LocationSelectionOptionSets } from "@/lib/location-selection-dto";

export function LocationSelectionFilters({
  filters,
  onChange,
  options,
  periodMode,
  priceCurrency
}: {
  filters: SelectionFilters;
  onChange: (filters: SelectionFilters) => void;
  options: LocationSelectionOptionSets;
  periodMode: "none" | "start" | "range";
  priceCurrency?: string | null;
}) {
  function patch(next: Partial<SelectionFilters>) {
    onChange({ ...filters, ...next });
  }

  const availabilityOptions = periodMode === "range"
    ? [
        { value: "PROPOSABLE", label: "Disponibile / partiale" },
        { value: "AVAILABLE", label: "Disponibile" },
        { value: "PARTIAL", label: "Disponibile partial" },
        { value: "ALL", label: "Toate" },
        { value: "CONFLICT", label: "Indisponibile / cu conflict" }
      ]
    : [
        { value: "ALL", label: "Toate" },
        { value: "CURRENT_AVAILABLE", label: periodMode === "start" ? "Disponibile la data de start" : "Disponibile acum" },
        { value: "FUTURE_BOOKINGS", label: periodMode === "start" ? "Cu rezervari dupa data de start" : "Cu rezervari viitoare" },
        { value: "CURRENT_CONFLICT", label: periodMode === "start" ? "Ocupate la data de start" : "Ocupate acum" }
      ];
  const availabilityValue = availabilityOptions.some((option) => option.value === filters.availability)
    ? filters.availability || "ALL"
    : periodMode === "range" ? "PROPOSABLE" : periodMode === "start" ? "CURRENT_AVAILABLE" : "ALL";

  return (
    <>
      <MultiSelect
        label="Format"
        values={filters.mediaTypes || (filters.mediaType ? [filters.mediaType] : [])}
        options={options.mediaTypes}
        onChange={(mediaTypes) => patch({ mediaTypes, mediaType: null })}
      />
      <Select
        label="Disponibilitate"
        value={availabilityValue}
        onChange={(availability) => patch({ availability: availability as SelectionFilters["availability"] })}
        options={availabilityOptions}
      />
      <Select label="Oraș" value={filters.city || ""} onChange={(city) => patch({ city: city || null, area: null })}
        options={[{ value: "", label: "Toate orașele" }, ...options.cities]} />
      <Select label="Zonă" value={filters.area || ""} onChange={(area) => patch({ area: area || null })}
        options={[{ value: "", label: "Toate zonele" }, ...options.areas]} />
      <NumberField label={`Tarif lunar maxim (${priceCurrency || "monedă de verificat"}/locație)`} value={filters.maxPrice} disabled={!priceCurrency}
        onChange={(maxPrice) => patch({ maxPrice })} />
      <Select label="Ordonare" value={filters.sort || "code"} onChange={(sort) => patch({ sort: sort as SelectionFilters["sort"] })}
        options={[{ value: "code", label: "Cod locație" }, { value: "price_asc", label: "Preț crescător" }, { value: "price_desc", label: "Preț descrescător" },
          { value: "city", label: "Oraș" }, { value: "surface_desc", label: "Suprafață descrescătoare" }, { value: "availability", label: "Disponibilitate" }, { value: "selected", label: "Selectate întâi" }]} />
      <details className="rounded-lg border border-focus-line p-3 md:col-span-2 xl:col-span-3">
        <summary className="min-h-11 cursor-pointer text-sm font-bold text-slate-200">Dimensiuni și filtre suplimentare</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField label="Suprafață minimă (mp)" value={filters.minSurface} onChange={(minSurface) => patch({ minSurface })} />
          <NumberField label="Suprafață maximă (mp)" value={filters.maxSurface} onChange={(maxSurface) => patch({ maxSurface })} />
          <NumberField label={`Tarif lunar minim (${priceCurrency || "monedă de verificat"}/locație)`} value={filters.minPrice} disabled={!priceCurrency} onChange={(minPrice) => patch({ minPrice })} />
          <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-slate-200"><input type="checkbox" checked={Boolean(filters.hasImage)} onChange={(event) => patch({ hasImage: event.target.checked || null })} />Doar locații cu fotografie</label>
        </div>
      </details>
      <p className="text-xs text-slate-400 md:col-span-2 xl:col-span-3">Plafonul este chiria de listă lunară pentru o locație; nu este bugetul total al campaniei și nu include producția sau montajul. Prețurile lipsă nu sunt tratate ca zero.</p>
    </>
  );
}

function MultiSelect({
  label,
  values,
  onChange,
  options
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: string[];
}) {
  const selected = new Set(values);
  const summary = selected.size
    ? selected.size === 1
      ? values[0]
      : `${values[0]} +${selected.size - 1}`
    : "Toate";

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange([...next]);
  }

  return (
    <details className="relative min-w-0">
      <summary className="grid cursor-pointer list-none gap-1 text-xs font-bold uppercase text-slate-300">
        {label}
        <span className="focus-input flex items-center justify-between gap-3">
          <span className="min-w-0 truncate" title={summary}>{summary}</span>
          <span className="text-focus-yellow">Selecteaza</span>
        </span>
      </summary>
      <div className="absolute left-0 z-30 mt-2 max-h-80 w-[min(380px,calc(100vw-32px))] overflow-x-hidden overflow-y-auto rounded-lg border border-focus-line bg-focus-navy p-3 shadow-2xl">
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 text-sm font-bold text-slate-100 hover:bg-focus-yellow/10">
          Toate
          <input className="shrink-0" type="checkbox" checked={!selected.size} onChange={() => onChange([])} />
        </label>
        <div className="mt-2 grid gap-1 border-t border-focus-line pt-2">
          {options.map((option) => (
            <label key={option} className="flex cursor-pointer items-start justify-between gap-3 rounded-md px-2 py-2 text-sm font-bold text-slate-100 hover:bg-focus-yellow/10">
              <span className="min-w-0 break-words leading-5">{option}</span>
              <input className="mt-0.5 shrink-0" type="checkbox" checked={selected.has(option)} onChange={() => toggle(option)} />
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}

function Select({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<string | { value: string; label: string }>;
}) {
  return (
    <label className="grid gap-1 text-xs font-bold uppercase text-slate-300">
      {label}
      <select className="focus-input" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => {
          const value = typeof option === "string" ? option : option.value;
          const label = typeof option === "string" ? option : option.label;
          return <option key={value} value={value}>{label}</option>;
        })}
      </select>
    </label>
  );
}

function NumberField({ label, value, onChange, disabled = false }: { label: string; value?: number | null; onChange: (value: number | null) => void; disabled?: boolean }) {
  return <label className="grid min-w-0 gap-1 text-xs font-bold uppercase text-slate-300">{label}
    <input className="focus-input min-w-0" type="number" min="0" step="0.01" value={value ?? ""} disabled={disabled} placeholder="Fără limită"
      onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))} />
  </label>;
}
