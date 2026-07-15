"use client";

import type { LocationSelectionFilters as SelectionFilters, LocationSelectionOptionSets } from "@/lib/location-selection-dto";

export function LocationSelectionFilters({
  filters,
  onChange,
  options,
  periodMode
}: {
  filters: SelectionFilters;
  onChange: (filters: SelectionFilters) => void;
  options: LocationSelectionOptionSets;
  periodMode: "none" | "start" | "range";
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
