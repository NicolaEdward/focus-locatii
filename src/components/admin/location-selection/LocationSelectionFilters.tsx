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
      <Select label="Format" value={filters.mediaType || ""} onChange={(mediaType) => patch({ mediaType: mediaType || null })} options={options.mediaTypes} />
      <Select
        label="Disponibilitate"
        value={availabilityValue}
        onChange={(availability) => patch({ availability: availability as SelectionFilters["availability"] })}
        options={availabilityOptions}
      />
    </>
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
