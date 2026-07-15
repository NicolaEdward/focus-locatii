"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { AlertTriangle, CheckCircle2, ListChecks, MapPin, Search, SlidersHorizontal } from "lucide-react";
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

type SelectionState = {
  companyEntity: string;
  periodStart: string;
  periodEnd: string;
  items: LocationSelectionItem[];
};

const emptySelection: SelectionState = {
  companyEntity: "Focus Media",
  periodStart: "",
  periodEnd: "",
  items: []
};

export function AdminLocationSelectionPage({
  initialData,
  session
}: {
  initialData: LocationSelectionResponse;
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
  const [fitKey, setFitKey] = useState("initial");
  const [showMap, setShowMap] = useState(false);
  const [availabilityRefreshKey, setAvailabilityRefreshKey] = useState(0);
  const availabilityRequestRef = useRef(0);

  const selectedIds = useMemo(() => new Set(selection.items.map((item) => item.locationId)), [selection.items]);
  const periodValid = Boolean(selection.periodStart && selection.periodEnd && selection.periodStart <= selection.periodEnd);
  const periodInvalid = Boolean(selection.periodStart && selection.periodEnd && selection.periodStart > selection.periodEnd);
  const periodMode = periodValid ? "range" : selection.periodStart ? "start" : "none";
  const availabilityScopeActive = Boolean(selection.periodStart && !periodInvalid);

  useEffect(() => {
    const allowed = periodMode === "range"
      ? new Set(["PROPOSABLE", "AVAILABLE", "PARTIAL", "ALL", "CONFLICT"])
      : new Set(["ALL", "CURRENT_AVAILABLE", "FUTURE_BOOKINGS", "CURRENT_CONFLICT"]);
    setFilters((current) => {
      if (allowed.has(current.availability || "")) return current;
      return {
        ...current,
        availability: periodMode === "range" ? "PROPOSABLE" : periodMode === "start" ? "CURRENT_AVAILABLE" : "ALL"
      };
    });
  }, [periodMode]);

  const baseFilteredLocations = useMemo(() => {
    const normalizedSearch = normalizeSearch(deferredSearch);
    const selectedMediaTypes = filters.mediaTypes?.length ? filters.mediaTypes : filters.mediaType ? [filters.mediaType] : [];
    return initialData.locations.filter((location) => {
      if (normalizedSearch && !locationMatchesSearch(location, normalizedSearch)) return false;
      if (selectedMediaTypes.length && !selectedMediaTypes.includes(location.mediaType || "") && !selectedMediaTypes.includes(location.category || "")) return false;
      if (filters.status && location.status !== filters.status) return false;
      return true;
    });
  }, [deferredSearch, filters.mediaType, filters.mediaTypes, filters.status, initialData.locations]);

  const filteredLocations = useMemo(() => {
    let rows = baseFilteredLocations.filter((location) => {
      return locationMatchesAvailabilityFilter(location.id, filters.availability || "ALL", availabilityById, periodValid, availabilityLoading);
    });

    rows = sortLocations(rows, filters.sort, selectedIds, availabilityById);
    return rows;
  }, [availabilityById, availabilityLoading, baseFilteredLocations, filters.availability, filters.sort, periodValid, selectedIds]);

  const selectionPayload = useMemo(
    () => ({
      companyEntity: selection.companyEntity || "Focus Media",
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
        const availabilityWarnings = availabilityMessages(availability);
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

  const allAvailabilityIdsKey = useMemo(
    () => initialData.locations.map((location) => location.id).sort().join("|"),
    [initialData.locations]
  );
  const selectedAvailabilityIdsKey = useMemo(
    () => selection.items.map((item) => item.locationId).sort().join("|"),
    [selection.items]
  );

  useEffect(() => {
    const selectedIdsForAvailability = selectedAvailabilityIdsKey ? selectedAvailabilityIdsKey.split("|") : [];
    const allIds = allAvailabilityIdsKey ? allAvailabilityIdsKey.split("|") : [];
    const ids = [...new Set([...allIds, ...selectedIdsForAvailability])];
    if (!ids.length) return;
    const requestId = ++availabilityRequestRef.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setAvailabilityLoading(true);
      setAvailabilityError(null);
      fetch("/api/admin/location-selection/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
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
        .then((payload) => {
          if (requestId === availabilityRequestRef.current) {
            setAvailabilityById((current) => ({ ...current, ...payload }));
          }
        })
        .catch((error) => {
          if (controller.signal.aborted || requestId !== availabilityRequestRef.current) return;
          setAvailabilityError(error instanceof Error ? error.message : "Disponibilitatea nu a putut fi verificata.");
        })
        .finally(() => {
          if (requestId === availabilityRequestRef.current) setAvailabilityLoading(false);
        });
    }, 280);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [allAvailabilityIdsKey, availabilityRefreshKey, selectedAvailabilityIdsKey, selection.periodEnd, selection.periodStart]);

  const updatePeriod = useCallback((patch: Partial<Pick<SelectionState, "periodStart" | "periodEnd">>) => {
    setSelection((current) => {
      const next = { ...current, ...patch };
      if (patch.periodStart !== undefined && next.periodStart && next.periodEnd && next.periodEnd < next.periodStart) {
        next.periodEnd = "";
      }
      return next;
    });
  }, []);

  const addLocation = useCallback((location: LocationSelectionLocationDTO) => {
    const availability = availabilityById[location.id];
    if (availabilityScopeActive && availability?.state === "CONFLICT") return;
    setSelection((current) => {
      if (current.items.some((item) => item.locationId === location.id)) return current;
      return {
        ...current,
        items: [
          ...current.items,
          {
            locationId: location.id,
            sortOrder: current.items.length,
            snapshot: toSelectionSnapshot(location),
            availabilityState: availability?.state || "UNKNOWN",
            availabilityWarnings: availability ? availabilityMessages(availability) : ["Alege perioada pentru verificare exacta."],
            suggestedBasePrice: location.suggestedBasePrice,
            currency: location.currency,
            notes: null
          }
        ]
      };
    });
  }, [availabilityById, availabilityScopeActive]);

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

  const removeConflicted = useCallback(() => {
    setSelection((current) => ({
      ...current,
      items: current.items
        .filter((item) => (availabilityById[item.locationId]?.state || item.availabilityState) !== "CONFLICT")
        .map((item, sortOrder) => ({ ...item, sortOrder }))
    }));
  }, [availabilityById]);

  const selectVisible = useCallback(() => {
    const candidates = filteredLocations.filter((location) => {
      if (selectedIds.has(location.id)) return false;
      return !availabilityScopeActive || availabilityById[location.id]?.state !== "CONFLICT";
    });
    if (candidates.length > 25 && !window.confirm(`Vrei sa selectezi ${candidates.length} locatii?`)) return;
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
            availabilityWarnings: availability ? availabilityMessages(availability) : ["Alege perioada pentru verificare exacta."],
            suggestedBasePrice: location.suggestedBasePrice,
            currency: location.currency,
            notes: null
          };
        });
      return { ...current, items: [...current.items, ...additions] };
    });
  }, [availabilityById, availabilityScopeActive, filteredLocations, selectedIds]);

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

  const toggleMapLocation = useCallback((location: LocationSelectionLocationDTO) => {
    if (selectedIds.has(location.id)) removeLocation(location.id);
    else addLocation(location);
  }, [addLocation, removeLocation, selectedIds]);

  const copyCodes = useCallback(async () => {
    const codes = selection.items.map((item) => item.snapshot.code).join(", ");
    if (!codes) return;
    await navigator.clipboard?.writeText(codes).catch(() => undefined);
  }, [selection.items]);

  const periodError =
    periodInvalid
      ? "Data de final trebuie sa fie dupa data de start."
      : null;
  const exportHref = useMemo(
    () => buildAvailabilityExportHref({
      locationIds: selection.items.length ? selection.items.map((item) => item.locationId) : filteredLocations.map((location) => location.id),
      periodStart: !periodInvalid ? selection.periodStart : "",
      periodEnd: periodValid ? selection.periodEnd : "",
      includeUnavailable: filters.availability === "CONFLICT" || filters.availability === "ALL"
    }),
    [filteredLocations, filters.availability, periodInvalid, periodValid, selection.items, selection.periodEnd, selection.periodStart]
  );

  return (
    <main className="min-h-screen bg-focus-dark text-white">
      <section className="border-b border-focus-line bg-focus-navy">
        <div className="focus-container py-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-focus-yellow">Selector intern pentru oferte OOH</p>
              <h1 className="mt-2 font-display text-4xl font-black uppercase tracking-tight text-white">Selector oferta OOH</h1>
              <p className="mt-2 text-sm text-slate-300">
                Alege perioada campaniei, vezi disponibilitatea reala si construieste rapid selectia de locatii pentru client.
              </p>
            </div>
            <div className="rounded-lg border border-focus-line bg-focus-ink/60 px-4 py-3">
              <p className="text-xs font-black uppercase text-focus-yellow">Inventar incarcat</p>
              <p className="text-2xl font-black text-white">{initialData.locations.length} locatii</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 rounded-lg border border-focus-line bg-focus-ink/60 p-4 lg:grid-cols-[1fr_1fr_1.4fr]">
            <Field label="Start campanie">
              <input className="focus-input bg-focus-navy/80" type="date" value={selection.periodStart} onChange={(event) => updatePeriod({ periodStart: event.target.value })} />
            </Field>
            <Field label="Final campanie">
              <input
                className="focus-input bg-focus-navy/80"
                type="date"
                value={selection.periodEnd}
                min={selection.periodStart || undefined}
                disabled={!selection.periodStart}
                onChange={(event) => updatePeriod({ periodEnd: event.target.value })}
              />
            </Field>
            <div className="min-h-[66px] rounded-lg border border-focus-line bg-focus-navy/55 p-3 text-sm">
              <p className="font-black text-white">
                {periodValid && !availabilityLoading ? <CheckCircle2 className="mr-2 inline h-4 w-4 text-emerald-300" /> : <AlertTriangle className="mr-2 inline h-4 w-4 text-focus-yellow" />}
                {availabilityLoading ? "Verificare disponibilitate..." : periodValid ? "Afisam implicit doar locatiile propunibile." : selection.periodStart ? "Disponibilitate calculata din data de start." : "Disponibilitate generala incarcata."}
              </p>
              {periodError ? <p className="mt-1 font-bold text-red-100">{periodError}</p> : null}
              {availabilityError ? <p className="mt-1 font-bold text-red-100">{availabilityError}</p> : null}
              <p className="mt-1 text-slate-400">
                {periodValid
                  ? "Statusurile sunt calculate pentru perioada selectata."
                  : selection.periodStart
                    ? "Poti completa finalul campaniei cand ai perioada exacta."
                    : "Alege perioada pentru verificare exacta pe campanie."}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="focus-container grid gap-4 py-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="grid min-w-0 gap-4">
          <div className="grid gap-3 rounded-lg border border-focus-line bg-focus-navy/80 p-4">
            <div className="flex items-center gap-2 text-sm font-black uppercase text-focus-yellow">
              <SlidersHorizontal size={16} />
              Filtrare rapida
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.25fr)_minmax(210px,.8fr)_minmax(210px,.8fr)]">
              <label className="grid gap-1 text-xs font-bold uppercase text-slate-300">
                Cauta cod, nume sau adresa
                <span className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input className="focus-input pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ex: DN1, Baneasa, FM..." />
                </span>
              </label>
              <LocationSelectionFilters filters={filters} onChange={setFilters} options={initialData.options} periodMode={periodMode} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="focus-button secondary !min-h-0 px-3 py-2 text-xs" type="button" onClick={selectVisible}>
                <ListChecks size={16} />
                Selecteaza tot
              </button>
              <button className="focus-button secondary !min-h-0 px-3 py-2 text-xs" type="button" onClick={() => setShowMap((value) => !value)}>
                <MapPin size={16} />
                {showMap ? "Ascunde harta" : "Arata harta"}
              </button>
              {showMap ? (
                <button className="focus-button secondary !min-h-0 px-3 py-2 text-xs" type="button" onClick={() => setFitKey(String(Date.now()))}>
                  <MapPin size={16} />
                  Recentreaza pe rezultate
                </button>
              ) : null}
              <button className="focus-button secondary !min-h-0 px-3 py-2 text-xs" type="button" onClick={() => setAvailabilityRefreshKey((key) => key + 1)}>
                <CheckCircle2 size={16} />
                Reimprospateaza disponibilitatea
              </button>
            </div>
          </div>

          <SelectionQualityWarnings warnings={warnings} />

          <LocationSelectionResults
            locations={filteredLocations}
            title={filters.availability === "CONFLICT" ? "Locatii indisponibile" : filters.availability === "ALL" ? "Rezultate filtrate" : "Locatii propunibile"}
            availabilityById={availabilityById}
            selectedIds={selectedIds}
            onAdd={addLocation}
            onRemove={removeLocation}
          />
          {showMap ? (
            <LocationSelectionMap
              locations={filteredLocations}
              availabilityById={availabilityById}
              selectedIds={selectedIds}
              fitKey={fitKey}
              onSelect={toggleMapLocation}
            />
          ) : null}
        </section>

        <LocationSelectionBasket
          items={selection.items}
          availabilityById={availabilityById}
          warnings={warnings}
          mediaPlanSeed={seed}
          periodStart={selection.periodStart}
          periodEnd={selection.periodEnd}
          exportHref={exportHref}
          onRemove={removeLocation}
          onClear={clearSelection}
          onRemoveConflicts={removeConflicted}
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

function availabilityMessages(availability: LocationSelectionAvailability) {
  return [...new Set([availability.explanation, ...availability.warnings].filter(Boolean))].slice(0, 8);
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

function locationMatchesAvailabilityFilter(
  locationId: string,
  filter: SelectionFilters["availability"],
  availabilityById: Record<string, LocationSelectionAvailability>,
  periodValid: boolean,
  availabilityLoading: boolean
) {
  const availability = availabilityById[locationId];
  const state = availability?.state || "UNKNOWN";
  if (periodValid) {
    if (!availability && availabilityLoading) return true;
    if (filter === "ALL") return true;
    if (filter === "CONFLICT") return state === "CONFLICT";
    if (filter === "PARTIAL") return state === "PARTIAL";
    if (filter === "AVAILABLE") return state === "AVAILABLE";
    return state === "AVAILABLE" || state === "PARTIAL";
  }

  if (filter === "CURRENT_AVAILABLE") return state === "AVAILABLE";
  if (filter === "FUTURE_BOOKINGS") return state === "AVAILABLE" && Boolean(availability?.blockingIntervals.length);
  if (filter === "CURRENT_CONFLICT" || filter === "CONFLICT") return state === "CONFLICT";
  return true;
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

function selectionStorageKey(userId: string) {
  return `focus-admin-location-selection:${userId}`;
}

function buildAvailabilityExportHref(input: { locationIds: string[]; periodStart?: string; periodEnd?: string; includeUnavailable?: boolean }) {
  const params = new URLSearchParams();
  params.set("scope", "ids");
  if (input.locationIds.length) params.set("ids", input.locationIds.join(","));
  if (input.periodStart) params.set("from", input.periodStart);
  if (input.periodEnd) params.set("to", input.periodEnd);
  if (input.includeUnavailable) params.set("includeUnavailable", "1");
  params.set("includeHidden", "1");
  return `/api/admin/availability/excel?${params.toString()}`;
}

function readSavedSelection(userId: string): SelectionState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(selectionStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SelectionState;
    if (!Array.isArray(parsed.items)) return null;
    return {
      companyEntity: parsed.companyEntity || "Focus Media",
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
