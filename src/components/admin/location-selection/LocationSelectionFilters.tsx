"use client";

import type { LocationSelectionFilters as SelectionFilters, LocationSelectionOptionSets } from "@/lib/location-selection-dto";

export function LocationSelectionFilters({
  filters,
  onChange,
  options,
  periodSelected
}: {
  filters: SelectionFilters;
  onChange: (filters: SelectionFilters) => void;
  options: LocationSelectionOptionSets;
  periodSelected: boolean;
}) {
  function patch(next: Partial<SelectionFilters>) {
    onChange({ ...filters, ...next });
  }

  const availabilityOptions = periodSelected
    ? [
        { value: "PROPOSABLE", label: "Disponibile / partiale" },
        { value: "AVAILABLE", label: "Disponibile" },
        { value: "PARTIAL", label: "Disponibile partial" },
        { value: "ALL", label: "Toate" },
        { value: "CONFLICT", label: "Indisponibile / cu conflict" }
      ]
    : [
        { value: "ALL", label: "Toate" },
        { value: "CURRENT_AVAILABLE", label: "Disponibile acum" },
        { value: "FUTURE_BOOKINGS", label: "Cu rezervari viitoare" },
        { value: "CURRENT_CONFLICT", label: "Ocupate acum" }
      ];
  const availabilityValue = availabilityOptions.some((option) => option.value === filters.availability)
    ? filters.availability || "ALL"
    : periodSelected ? "PROPOSABLE" : "ALL";

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
  const summary = selected.size ? `${selected.size} selectate` : "Toate";

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange([...next]);
  }

  return (
    <details className="relative">
      <summary className="grid cursor-pointer list-none gap-1 text-xs font-bold uppercase text-slate-300">
        {label}
        <span className="focus-input flex items-center justify-between gap-3">
          <span className="truncate">{summary}</span>
          <span className="text-focus-yellow">Selecteaza</span>
        </span>
      </summary>
      <div className="absolute left-0 right-0 z-30 mt-2 max-h-72 overflow-auto rounded-lg border border-focus-line bg-focus-navy p-3 shadow-2xl">
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 text-sm font-bold text-slate-100 hover:bg-focus-yellow/10">
          Toate
          <input type="checkbox" checked={!selected.size} onChange={() => onChange([])} />
        </label>
        <div className="mt-2 grid gap-1 border-t border-focus-line pt-2">
          {options.map((option) => (
            <label key={option} className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 text-sm font-bold text-slate-100 hover:bg-focus-yellow/10">
              <span className="truncate">{option}</span>
              <input type="checkbox" checked={selected.has(option)} onChange={() => toggle(option)} />
            </label>
          ))}
        </div>
      </div>
      {selected.size ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {[...selected].slice(0, 3).map((value) => (
            <span key={value} className="rounded-full border border-focus-line px-2 py-0.5 text-[10px] font-black uppercase text-slate-200">
              {value}
            </span>
          ))}
          {selected.size > 3 ? <span className="rounded-full border border-focus-line px-2 py-0.5 text-[10px] font-black uppercase text-slate-400">+{selected.size - 3}</span> : null}
        </div>
      ) : null}
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
        <option value="">Toate</option>
        {options.map((option) => {
          const value = typeof option === "string" ? option : option.value;
          const label = typeof option === "string" ? option : option.label;
          return <option key={value} value={value}>{label}</option>;
        })}
      </select>
    </label>
  );
}
