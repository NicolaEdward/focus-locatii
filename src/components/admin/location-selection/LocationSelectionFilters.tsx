"use client";

import type { LocationSelectionFilters as SelectionFilters, LocationSelectionOptionSets } from "@/lib/location-selection-dto";

export function LocationSelectionFilters({
  filters,
  onChange,
  options
}: {
  filters: SelectionFilters;
  onChange: (filters: SelectionFilters) => void;
  options: LocationSelectionOptionSets;
}) {
  function patch(next: Partial<SelectionFilters>) {
    onChange({ ...filters, ...next });
  }

  return (
    <>
      <Select label="Oras" value={filters.city || ""} onChange={(city) => patch({ city: city || null })} options={options.cities} />
      <Select label="Zona" value={filters.area || ""} onChange={(area) => patch({ area: area || null })} options={options.areas} />
      <Select label="Format" value={filters.mediaType || ""} onChange={(mediaType) => patch({ mediaType: mediaType || null })} options={options.mediaTypes} />
      <Select
        label="Disponibilitate"
        value={filters.availability || "ALL"}
        onChange={(availability) => patch({ availability: availability as SelectionFilters["availability"] })}
        options={[
          { value: "ALL", label: "Toate" },
          { value: "AVAILABLE", label: "Disponibile" },
          { value: "CONFLICT", label: "Cu conflict" },
          { value: "UNKNOWN", label: "Necunoscut" },
          { value: "NO_PERIOD", label: "Fara perioada" }
        ]}
      />
      <Select
        label="Sortare"
        value={filters.sort || "code"
        }
        onChange={(sort) => patch({ sort: sort as SelectionFilters["sort"] })}
        options={[
          { value: "selected", label: "Selectate primele" },
          { value: "availability", label: "Disponibile primele" },
          { value: "code", label: "Cod A-Z" },
          { value: "city", label: "Oras / zona" },
          { value: "surface_desc", label: "Suprafata desc." },
          { value: "price_asc", label: "Pret crescator" },
          { value: "price_desc", label: "Pret descrescator" },
          { value: "updated_desc", label: "Actualizate recent" }
        ]}
      />
      <NumberField label="Suprafata min." value={filters.minSurface ?? ""} onChange={(minSurface) => patch({ minSurface })} />
      <NumberField label="Suprafata max." value={filters.maxSurface ?? ""} onChange={(maxSurface) => patch({ maxSurface })} />
      <NumberField label="Pret min." value={filters.minPrice ?? ""} onChange={(minPrice) => patch({ minPrice })} />
      <NumberField label="Pret max." value={filters.maxPrice ?? ""} onChange={(maxPrice) => patch({ maxPrice })} />
      <label className="flex items-end gap-2 rounded-lg border border-focus-line bg-focus-navy/45 px-3 py-2 text-xs font-bold uppercase text-slate-300">
        <input
          type="checkbox"
          checked={Boolean(filters.hasImage)}
          onChange={(event) => patch({ hasImage: event.target.checked || null })}
        />
        Cu poza
      </label>
      <label className="flex items-end gap-2 rounded-lg border border-focus-line bg-focus-navy/45 px-3 py-2 text-xs font-bold uppercase text-slate-300">
        <input
          type="checkbox"
          checked={Boolean(filters.hasPublicPrice)}
          onChange={(event) => patch({ hasPublicPrice: event.target.checked || null })}
        />
        Cu pret
      </label>
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

function NumberField({
  label,
  value,
  onChange
}: {
  label: string;
  value: number | "";
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="grid gap-1 text-xs font-bold uppercase text-slate-300">
      {label}
      <input
        className="focus-input"
        type="number"
        min="0"
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          onChange(event.target.value === "" || !Number.isFinite(next) ? null : next);
        }}
      />
    </label>
  );
}
