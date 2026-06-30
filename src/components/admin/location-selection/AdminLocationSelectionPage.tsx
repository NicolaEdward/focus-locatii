"use client";

import { useCallback, useEffect, useMemo, useState, useDeferredValue } from "react";
import { AlertTriangle, CheckCircle2, Copy, Eraser, ListChecks, MapPin, Search, SlidersHorizontal } from "lucide-react";
import { LocationSelectionBasket } from "@/components/admin/location-selection/LocationSelectionBasket";
import { LocationSelectionFilters } from "@/components/admin/location-selection/LocationSelectionFilters";
import { LocationSelectionMap } from "@/components/admin/location-selection/LocationSelectionMap";
import { LocationSelectionResults } from "@/components/admin/location-selection/LocationSelectionResults";
import { SelectionQualityWarnings } from "@/components/admin/location-selection/SelectionQualityWarnings";
import {
  buildMediaPlanSeedFromSelection,
  selectionQualityWarnings,
  toSelectionSnapshot
} from "@/lib/location-selection";
import type { AuthSession } from "@/lib/auth";
import type {
  LocationSelectionAvailability,
  LocationSelectionAvailabilityState,
  LocationSelectionFilters as SelectionFilters,
  LocationSelectionItem,
  LocationSelectionLocationDTO,
  LocationSelectionResponse
} from "@/lib/location-selection-dto";

type CompanyOption = {
  value: string;
  label: string;
};

type SelectionState = {
  companyEntity: string;
  periodStart: string;
  periodEnd: string;
  items: LocationSelectionItem[];
};

const emptySelection: SelectionState = {
  companyEntity: "",
  periodStart: "",
  periodEnd: "",
  items: []
};

export function AdminLocationSelectionPage({
  initialData,
  companyOptions,
  session
}: {
  initialData: LocationSelectionResponse;
  companyOptions: CompanyOption[];
  session: AuthSession;
}) {
  const [selection, setSelection] = useState<SelectionState>(emptySelection);
  const [selectionLoaded, setSelectionLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filters, setFilters] = useState<SelectionFilters>({ sort: "code", availability: "ALL" });
  const [availabilityById, setAvailabilityById] = useState<Record<string, LocationSelectionAvailability>>({});
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState("initial");

  const selectedIds = useMemo(() => new Set(selection.items.map((item) => item.locationId)), [selection.items]);
  const selectedItemsById = useMemo(
    () => new Map(selection.items.map((item) => [item.locationId, item])),
    [selection.items]
  );
  const periodValid = Boolean(selection.periodStart && selection.periodEnd && selection.periodStart <= selection.periodEnd);

  const filteredLocations = useMemo(() => {
    const normalizedSearch = normalizeSearch(deferredSearch);
    let rows = initialData.locations.filter((location) => {
      if (normalizedSearch && !locationMatchesSearch(location, normalizedSearch)) return false;
      if (filters.city && location.city !== filters.city) return false;
      if (filters.area && location.area !== filters.area) return false;
      if (filters.mediaType && location.mediaType !== filters.mediaType && location.category !== filters.mediaType) return false;
      if (filters.status && location.status !== filters.status) return false;
      if (filters.minSurface != null && (location.surface == null || location.surface < filters.minSurface)) return false;
      if (filters.maxSurface != null && (location.surface == null || location.surface > filters.maxSurface)) return false;
      if (filters.minPrice != null && (location.suggestedBasePrice == null || location.suggestedBasePrice < filters.minPrice)) return false;
      if (filters.maxPrice != null && (location.suggestedBasePrice == null || location.suggestedBasePrice > filters.maxPrice)) return false;
      if (filters.hasImage === true && !location.hasImage) return false;
      if (filters.hasPublicPrice === true && location.suggestedBasePrice == null) return false;
      if (filters.availability && filters.availability !== "ALL") {
        const state = availabilityById[location.id]?.state || "UNKNOWN";
        if (filters.availability === "NO_PERIOD" && periodValid) return false;
        if (filters.availability !== "NO_PERIOD" && state !== filters.availability) return false;
      }
      return true;
    });

    rows = sortLocations(rows, filters.sort, selectedIds, availabilityById);
    return rows;
  }, [availabilityById, deferredSearch, filters, initialData.locations, periodValid, selectedIds]);

  const selectionPayload = useMemo(
    () => ({
      companyEntity: selection.companyEntity || undefined,
      periodStart: selection.periodStart || undefined,
      periodEnd: selection.periodEnd || undefined,
      selectedLocations: selection.items
    }),
    [selection]
  );
  const warnings = useMemo(() => selectionQualityWarnings(selectionPayload), [selectionPayload]);
  const seed = useMemo(() => buildMediaPlanSeedFromSelection(selectionPayload), [selectionPayload]);

  useEffect(() => {
    const savedSelection = readSavedSelection(session.id);
    if (savedSelection) setSelection(savedSelection);
    setSelectionLoaded(true);
  }, [session.id]);

  useEffect(() => {
    if (!selectionLoaded) return;
    saveSelection(session.id, selection);
  }, [selection, selectionLoaded, session.id]);

  useEffect(() => {
    setSelection((current) => {
      let changed = false;
      const items = current.items.map((item) => {
        const availability = availabilityById[item.locationId];
        if (!availability) return item;
        const availabilityWarnings = [...availability.warnings, ...availability.conflicts.map(conflictWarning)];
        if (
          item.availabilityState === availability.state &&
          item.availabilityWarnings.join("\n") === availabilityWarnings.join("\n")
        ) {
          return item;
        }
        changed = true;
        return {
          ...item,
          availabilityState: availability.state,
          availabilityWarnings
        };
      });
      return changed ? { ...current, items } : current;
    });
  }, [availabilityById]);

  useEffect(() => {
    const ids = [...new Set([...filteredLocations.map((location) => location.id), ...selection.items.map((item) => item.locationId)])];
    if (!ids.length) return;
    const timeout = window.setTimeout(() => {
      setAvailabilityLoading(true);
      setAvailabilityError(null);
      fetch("/api/admin/location-selection/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationIds: ids,
          periodStart: selection.periodStart || null,
          periodEnd: selection.periodEnd || null
        })
      })
        .then(async (response) => {
          const payload = await response.json().catch(() => null);
          if (!response.ok) throw new Error(payload?.error || "Disponibilitatea nu a putut fi verificata.");
          return payload.availabilityByLocationId as Record<string, LocationSelectionAvailability>;
        })
        .then((payload) => setAvailabilityById((current) => ({ ...current, ...payload })))
        .catch((error) => setAvailabilityError(error instanceof Error ? error.message : "Disponibilitatea nu a putut fi verificata."))
        .finally(() => setAvailabilityLoading(false));
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [filteredLocations, selection.items, selection.periodEnd, selection.periodStart]);

  const updatePeriod = useCallback((patch: Partial<Pick<SelectionState, "periodStart" | "periodEnd" | "companyEntity">>) => {
    setSelection((current) => ({ ...current, ...patch }));
  }, []);

  const addLocation = useCallback((location: LocationSelectionLocationDTO) => {
    setSelection((current) => {
      if (current.items.some((item) => item.locationId === location.id)) return current;
      const availability = availabilityById[location.id];
      return {
        ...current,
        items: [
          ...current.items,
          {
            locationId: location.id,
            sortOrder: current.items.length,
            snapshot: toSelectionSnapshot(location),
            availabilityState: availability?.state || "UNKNOWN",
            availabilityWarnings: availability ? [...availability.warnings, ...availability.conflicts.map(conflictWarning)] : ["Alege perioada pentru disponibilitate."],
            suggestedBasePrice: location.suggestedBasePrice,
            currency: location.currency,
            notes: null
          }
        ]
      };
    });
  }, [availabilityById]);

  const removeLocation = useCallback((locationId: string) => {
    setSelection((current) => ({
      ...current,
      items: current.items
        .filter((item) => item.locationId !== locationId)
        .map((item, index) => ({ ...item, sortOrder: index }))
    }));
  }, []);

  const clearSelection = useCallback(() => {
    if (selection.items.length && !window.confirm("Golesti selectia curenta?")) return;
    setSelection((current) => ({ ...current, items: [] }));
  }, [selection.items.length]);

  const selectVisible = useCallback(() => {
    const candidates = filteredLocations.filter((location) => !selectedIds.has(location.id));
    if (candidates.length > 25 && !window.confirm(`Adaugi ${candidates.length} locatii vizibile in selectie?`)) return;
    setSelection((current) => {
      const existing = new Set(current.items.map((item) => item.locationId));
      const additions = candidates
        .filter((location) => !existing.has(location.id))
        .map((location, offset) => {
          const availability = availabilityById[location.id];
          return {
            locationId: location.id,
            sortOrder: current.items.length + offset,
            snapshot: toSelectionSnapshot(location),
            availabilityState: availability?.state || "UNKNOWN",
            availabilityWarnings: availability ? [...availability.warnings, ...availability.conflicts.map(conflictWarning)] : ["Alege perioada pentru disponibilitate."],
            suggestedBasePrice: location.suggestedBasePrice,
            currency: location.currency,
            notes: null
          };
        });
      return { ...current, items: [...current.items, ...additions] };
    });
  }, [availabilityById, filteredLocations, selectedIds]);

  const removeVisibleSelected = useCallback(() => {
    const visibleIds = new Set(filteredLocations.map((location) => location.id));
    setSelection((current) => ({
      ...current,
      items: current.items
        .filter((item) => !visibleIds.has(item.locationId))
        .map((item, index) => ({ ...item, sortOrder: index }))
    }));
  }, [filteredLocations]);

  const moveItem = useCallback((locationId: string, direction: -1 | 1) => {
    setSelection((current) => {
      const index = current.items.findIndex((item) => item.locationId === locationId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.items.length) return current;
      const items = [...current.items];
      [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
      return { ...current, items: items.map((item, sortOrder) => ({ ...item, sortOrder })) };
    });
  }, []);

  const copyCodes = useCallback(async () => {
    const codes = selection.items.map((item) => item.snapshot.code).join(", ");
    if (!codes) return;
    await navigator.clipboard?.writeText(codes).catch(() => undefined);
  }, [selection.items]);

  const periodError =
    selection.periodStart && selection.periodEnd && selection.periodStart > selection.periodEnd
      ? "Data de final trebuie sa fie dupa data de start."
      : null;

  return (
    <main className="min-h-screen bg-focus-dark text-white">
      <section className="border-b border-focus-line bg-focus-navy">
        <div className="focus-container py-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-focus-yellow">Selector intern pentru oferte OOH</p>
              <h1 className="mt-2 font-display text-4xl font-black uppercase tracking-tight text-white">Selectie locatii pentru Media Plan</h1>
              <p className="mt-2 text-sm text-slate-300">
                Alege perioada, filtreaza inventarul si pregateste o selectie curata pentru viitorul flux de Media Plan.
              </p>
            </div>
            <div className="rounded-lg border border-focus-line bg-focus-ink/60 px-4 py-3">
              <p className="text-xs font-black uppercase text-focus-yellow">Inventar incarcat</p>
              <p className="text-2xl font-black text-white">{initialData.locations.length} locatii</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 rounded-lg border border-focus-line bg-focus-ink/60 p-4 lg:grid-cols-[1fr_1fr_1fr_1.2fr]">
            <Field label="Firma contractanta">
              <select
                className="focus-input"
                value={selection.companyEntity}
                onChange={(event) => updatePeriod({ companyEntity: event.target.value })}
              >
                <option value="">Alege firma</option>
                {companyOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Start campanie">
              <input className="focus-input" type="date" value={selection.periodStart} onChange={(event) => updatePeriod({ periodStart: event.target.value })} />
            </Field>
            <Field label="Final campanie">
              <input className="focus-input" type="date" value={selection.periodEnd} onChange={(event) => updatePeriod({ periodEnd: event.target.value })} />
            </Field>
            <div className="rounded-lg border border-focus-line bg-focus-navy/55 p-3 text-sm">
              <p className="font-black text-white">
                {periodValid ? <CheckCircle2 className="mr-2 inline h-4 w-4 text-emerald-300" /> : <AlertTriangle className="mr-2 inline h-4 w-4 text-focus-yellow" />}
                {periodValid ? "Disponibilitatea se verifica automat." : "Alege perioada pentru disponibilitate."}
              </p>
              {periodError ? <p className="mt-1 font-bold text-red-100">{periodError}</p> : null}
              {availabilityError ? <p className="mt-1 font-bold text-red-100">{availabilityError}</p> : null}
              {availabilityLoading ? <p className="mt-1 text-slate-400">Se actualizeaza disponibilitatea...</p> : null}
            </div>
          </div>
        </div>
      </section>

      <div className="focus-container grid gap-4 py-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="grid min-w-0 gap-4">
          <div className="grid gap-3 rounded-lg border border-focus-line bg-focus-navy/80 p-4">
            <div className="flex items-center gap-2 text-sm font-black uppercase text-focus-yellow">
              <SlidersHorizontal size={16} />
              Filtrare rapida
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(260px,1.2fr)_repeat(4,minmax(0,1fr))]">
              <label className="grid gap-1 text-xs font-bold uppercase text-slate-300">
                Cauta cod, zona, oras, adresa
                <span className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input className="focus-input pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ex: DN1, Baneasa, FM..." />
                </span>
              </label>
              <LocationSelectionFilters filters={filters} onChange={setFilters} options={initialData.options} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="focus-button secondary !min-h-0 px-3 py-2 text-xs" type="button" onClick={selectVisible}>
                <ListChecks size={16} />
                Selecteaza rezultate vizibile
              </button>
              <button className="focus-button secondary !min-h-0 px-3 py-2 text-xs" type="button" onClick={removeVisibleSelected}>
                <Eraser size={16} />
                Scoate vizibile selectate
              </button>
              <button className="focus-button secondary !min-h-0 px-3 py-2 text-xs" type="button" onClick={() => setFitKey(String(Date.now()))}>
                <MapPin size={16} />
                Recentreaza pe rezultate
              </button>
              <button className="focus-button secondary !min-h-0 px-3 py-2 text-xs" type="button" onClick={copyCodes} disabled={!selection.items.length}>
                <Copy size={16} />
                Copiaza coduri selectate
              </button>
            </div>
          </div>

          <SelectionQualityWarnings warnings={warnings} />

          <div className="grid gap-4 2xl:grid-cols-[minmax(0,0.98fr)_minmax(360px,0.72fr)]">
            <LocationSelectionResults
              locations={filteredLocations}
              availabilityById={availabilityById}
              selectedIds={selectedIds}
              onAdd={addLocation}
              onRemove={removeLocation}
              onHover={setHoveredId}
            />
            <LocationSelectionMap
              locations={filteredLocations}
              availabilityById={availabilityById}
              selectedIds={selectedIds}
              hoveredId={hoveredId}
              fitKey={fitKey}
              onSelect={(location) => {
                if (selectedIds.has(location.id)) removeLocation(location.id);
                else addLocation(location);
              }}
            />
          </div>
        </section>

        <LocationSelectionBasket
          items={selection.items}
          locationsById={selectedItemsById}
          warnings={warnings}
          mediaPlanSeed={seed}
          onRemove={removeLocation}
          onClear={clearSelection}
          onMove={moveItem}
          onCopyCodes={copyCodes}
        />
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-xs font-bold uppercase text-slate-300">
      {label}
      {children}
    </label>
  );
}

function conflictWarning(conflict: LocationSelectionAvailability["conflicts"][number]) {
  const dates = `${formatDate(conflict.periodStart)} - ${formatDate(conflict.periodEnd)}`;
  return [conflict.status, dates, conflict.clientName, conflict.campaignName].filter(Boolean).join(" / ");
}

function sortLocations(
  locations: LocationSelectionLocationDTO[],
  sort: SelectionFilters["sort"],
  selectedIds: Set<string>,
  availabilityById: Record<string, LocationSelectionAvailability>
) {
  const rows = [...locations];
  rows.sort((left, right) => {
    if (sort === "selected") {
      const bySelected = Number(selectedIds.has(right.id)) - Number(selectedIds.has(left.id));
      if (bySelected) return bySelected;
    }
    if (sort === "availability") {
      const byAvailability = availabilityRank(availabilityById[left.id]?.state) - availabilityRank(availabilityById[right.id]?.state);
      if (byAvailability) return byAvailability;
    }
    if (sort === "city") return compare(left.city || "", right.city || "") || compare(left.code, right.code);
    if (sort === "surface_desc") return (right.surface || 0) - (left.surface || 0) || compare(left.code, right.code);
    if (sort === "price_asc") return (left.suggestedBasePrice || Number.MAX_SAFE_INTEGER) - (right.suggestedBasePrice || Number.MAX_SAFE_INTEGER);
    if (sort === "price_desc") return (right.suggestedBasePrice || 0) - (left.suggestedBasePrice || 0);
    if (sort === "updated_desc") return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    return compare(left.code, right.code);
  });
  return rows;
}

function availabilityRank(state?: LocationSelectionAvailabilityState) {
  if (state === "AVAILABLE") return 0;
  if (state === "PARTIAL") return 1;
  if (state === "UNKNOWN") return 2;
  return 3;
}

function locationMatchesSearch(location: LocationSelectionLocationDTO, search: string) {
  return [location.code, location.name, location.address, location.city, location.area, location.mediaType, location.category]
    .map((value) => normalizeSearch(value))
    .some((value) => value.includes(search));
}

function normalizeSearch(value?: string | null) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function compare(left: string, right: string) {
  return left.localeCompare(right, "ro");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function selectionStorageKey(userId: string) {
  return `focus-admin-location-selection:${userId}`;
}

function readSavedSelection(userId: string): SelectionState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(selectionStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SelectionState;
    if (!Array.isArray(parsed.items)) return null;
    return {
      companyEntity: parsed.companyEntity || "",
      periodStart: parsed.periodStart || "",
      periodEnd: parsed.periodEnd || "",
      items: parsed.items
    };
  } catch {
    return null;
  }
}

function saveSelection(userId: string, selection: SelectionState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(selectionStorageKey(userId), JSON.stringify(selection));
  } catch {
    // Local storage can fail in private browsing; the selector still works in memory.
  }
}
