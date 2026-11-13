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
} from "@/lib/location-selection-client";
import { matchesLocationSelectionFilters, sortSelectionLocations } from "@/lib/location-selection-filters";
import type { AuthSession } from "@/lib/auth";
import { readQuoteSelectionDraft, saveQuoteSelectionDraft } from "@/lib/quote-selection-bridge";
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
  clientId?: string;
  campaignId?: string;
  opportunityId?: string;
  quoteId?: string;
  expectedRevision?: number;
  requestKey?: string;
  recipient?: string;
  assumptions?: string;
  rateInputs?: { locationId: string; monthlyRate: string; reason: string }[];
  clientName: string;
  campaignName: string;
  periodStart: string;
  periodEnd: string;
  items: LocationSelectionItem[];
};

const emptySelection: SelectionState = {
  companyEntity: "Focus Media",
  clientName: "",
  campaignName: "",
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
  const [inventory, setInventory] = useState(initialData);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const inventoryRequestRef = useRef(0);
  const [selection, setSelection] = useState<SelectionState>(emptySelection);
  const [selectionLoaded, setSelectionLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filters, setFilters] = useState<SelectionFilters>({ sort: "code", availability: "ALL" });
  const [availabilityById, setAvailabilityById] = useState<Record<string, LocationSelectionAvailability>>({});
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [quoteHeldCount, setQuoteHeldCount] = useState(0);
  const [fitKey, setFitKey] = useState("initial");
  const [showMap, setShowMap] = useState(false);
  const [availabilityRefreshKey, setAvailabilityRefreshKey] = useState(0);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const availabilityRequestRef = useRef(0);

  const selectedIds = useMemo(() => new Set(selection.items.map((item) => item.locationId)), [selection.items]);
  const periodValid = Boolean(selection.periodStart && selection.periodEnd && selection.periodStart <= selection.periodEnd);
  const periodInvalid = Boolean(selection.periodStart && selection.periodEnd && selection.periodStart > selection.periodEnd);
  const periodMode = periodValid ? "range" : selection.periodStart ? "start" : "none";
  const availabilityScopeActive = Boolean(selection.periodStart && !periodInvalid);
  const previousPeriodModeRef = useRef(periodMode);

  useEffect(() => {
    const allowed = periodMode === "range"
      ? new Set(["PROPOSABLE", "AVAILABLE", "PARTIAL", "ALL", "CONFLICT"])
      : new Set(["ALL", "CURRENT_AVAILABLE", "FUTURE_BOOKINGS", "CURRENT_CONFLICT"]);
    const modeChanged = previousPeriodModeRef.current !== periodMode;
    previousPeriodModeRef.current = periodMode;
    setFilters((current) => {
      if (!modeChanged && allowed.has(current.availability || "")) return current;
      return {
        ...current,
        availability: periodMode === "range" ? "PROPOSABLE" : periodMode === "start" ? "CURRENT_AVAILABLE" : "ALL"
      };
    });
  }, [periodMode]);

  const inventoryQuery = useMemo(() => {
    const params = new URLSearchParams({ pageSize: "100", sort: filters.sort || "code" });
    if (deferredSearch.trim()) params.set("search", deferredSearch.trim());
    for (const key of ["city", "area", "status", "minSurface", "maxSurface", "minPrice", "maxPrice", "hasImage"] as const) {
      const value = filters[key];
      if (value != null && value !== "") params.set(key, String(value));
    }
    const formats = filters.mediaTypes?.length ? filters.mediaTypes : filters.mediaType ? [filters.mediaType] : [];
    if (formats.length) params.set("mediaTypes", formats.join(","));
    return params.toString();
  }, [deferredSearch, filters]);

  useEffect(() => {
    const requestId = ++inventoryRequestRef.current;
    const controller = new AbortController();
    setInventoryLoading(true); setInventoryError(null);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/location-selection?${inventoryQuery}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Inventarul nu a putut fi încărcat.");
        if (requestId === inventoryRequestRef.current) setInventory(body);
      } catch (error) {
        if (!controller.signal.aborted && requestId === inventoryRequestRef.current) setInventoryError(error instanceof Error ? error.message : "Inventarul nu a putut fi încărcat.");
      } finally { if (requestId === inventoryRequestRef.current) setInventoryLoading(false); }
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [inventoryQuery]);

  const loadMoreInventory = useCallback(async () => {
    if (inventoryLoading || !inventory.page.hasMore) return;
    const requestId = ++inventoryRequestRef.current;
    setInventoryLoading(true); setInventoryError(null);
    try {
      const response = await fetch(`/api/admin/location-selection?${inventoryQuery}&offset=${inventory.locations.length}`, { cache: "no-store" });
      const body: LocationSelectionResponse & { error?: string } = await response.json();
      if (!response.ok) throw new Error(body.error || "Următoarele locații nu au putut fi încărcate.");
      if (requestId === inventoryRequestRef.current) setInventory((current) => ({ ...body, locations: [...new Map([...current.locations, ...body.locations].map((row) => [row.id, row])).values()] }));
    } catch (error) {
      if (requestId === inventoryRequestRef.current) setInventoryError(error instanceof Error ? error.message : "Inventarul nu a putut fi încărcat.");
    } finally { if (requestId === inventoryRequestRef.current) setInventoryLoading(false); }
  }, [inventory, inventoryLoading, inventoryQuery]);

  const baseFilteredLocations = useMemo(() => inventory.locations.filter((location) =>
    matchesLocationSelectionFilters(location, { ...filters, search: deferredSearch })
  ), [deferredSearch, filters, inventory.locations]);

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
    let cancelled = false;
    const controller = new AbortController();
    const params = new URLSearchParams(window.location.search);
    const handoffKey = params.get("selection");
    const draft = handoffKey ? readQuoteSelectionDraft(handoffKey, session.id) : null;
    const savedSelection = readSavedSelection(session.id);
    async function restore() {
      try {
        if (draft) {
          let locations = initialData.locations;
          if (draft.locationIds.some((id) => !locations.some((row) => row.id === id))) {
            const response = await fetch(`/api/admin/location-selection?selectedIds=${encodeURIComponent(draft.locationIds.join(","))}&pageSize=50`, { cache: "no-store", signal: controller.signal });
            if (!response.ok) throw new Error("Locațiile transferate nu au putut fi reîncărcate. Reîncearcă deschiderea selecției.");
            const data: LocationSelectionResponse = await response.json();
            locations = data.locations;
          }
          if (cancelled) return;
          const missing = draft.locationIds.filter((id) => !locations.some((row) => row.id === id));
          if (missing.length) throw new Error(`${missing.length} locații transferate nu mai sunt ofertabile. Verifică oferta înainte de a schimba selecția.`);
          setSelection({ ...draft, items: draft.locationIds.flatMap((id, sortOrder) => {
            const location = locations.find((row) => row.id === id);
            return location ? [{ locationId: id, sortOrder, snapshot: toSelectionSnapshot(location), availabilityState: "UNKNOWN" as const, availabilityWarnings: [], suggestedBasePrice: location.suggestedBasePrice, currency: location.currency }] : [];
          }) });
        } else if (savedSelection && !cancelled) setSelection({ ...savedSelection, quoteId: undefined, expectedRevision: undefined, requestKey: undefined, rateInputs: undefined, recipient: undefined, assumptions: undefined });
        if (handoffKey && !draft && !cancelled) setHandoffError("Selecția transferată a expirat sau nu aparține acestui cont. Selecția salvată rămâne disponibilă.");
      } catch (error) {
        if (!cancelled) setHandoffError(error instanceof Error ? error.message : "Selecția nu a putut fi restaurată.");
      } finally { if (!cancelled) setSelectionLoaded(true); }
    }
    void restore();
    return () => { cancelled = true; controller.abort(); };
  }, [initialData.locations, session.id]);

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
    () => inventory.locations.map((location) => location.id).sort().join("|"),
    [inventory.locations]
  );
  const selectedAvailabilityIdsKey = useMemo(
    () => selection.items.map((item) => item.locationId).sort().join("|"),
    [selection.items]
  );

  useEffect(() => {
    const selectedIdsForAvailability = selectedAvailabilityIdsKey ? selectedAvailabilityIdsKey.split("|") : [];
    const allIds = allAvailabilityIdsKey ? allAvailabilityIdsKey.split("|") : [];
    const ids = [...new Set([...allIds, ...selectedIdsForAvailability])];
    const requestId = ++availabilityRequestRef.current;
    if (!ids.length) { setAvailabilityById({}); setAvailabilityLoading(false); setAvailabilityError(null); return; }
    const controller = new AbortController();
    setAvailabilityLoading(true); setAvailabilityError(null); setAvailabilityById({}); setQuoteHeldCount(0);
    const timeout = window.setTimeout(() => {
      const pages = Array.from({ length: Math.ceil(ids.length / 500) }, (_, index) => ids.slice(index * 500, (index + 1) * 500));
      const requests: { locationIds: string[]; quoteId?: string; expectedRevision?: number }[] = pages.map((locationIds) => ({ locationIds }));
      if (periodValid && selection.quoteId && selection.expectedRevision && selectedIdsForAvailability.length) requests.push({ locationIds: selectedIdsForAvailability, quoteId: selection.quoteId, expectedRevision: selection.expectedRevision });
      Promise.all(requests.map(async (request) => {
        const response = await fetch("/api/admin/location-selection/availability", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ ...request, periodStart: selection.periodStart || null, periodEnd: selection.periodEnd || null })
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Disponibilitatea nu a putut fi verificata.");
        if (request.quoteId && requestId === availabilityRequestRef.current && !controller.signal.aborted) setQuoteHeldCount(payload.quoteHoldContext?.count || 0);
        return payload.availabilityByLocationId as Record<string, LocationSelectionAvailability>;
      })).then((pages) => Object.assign({}, ...pages) as Record<string, LocationSelectionAvailability>)
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
  }, [allAvailabilityIdsKey, availabilityRefreshKey, selectedAvailabilityIdsKey, selection.periodEnd, selection.periodStart, selection.quoteId, selection.expectedRevision, periodValid]);

  const applyAvailableWindow = useCallback((locationId: string, start: string, end: string) => {
    const location = inventory.locations.find((row) => row.id === locationId);
    if (!location) return;
    const from = start.slice(0, 10), to = end.slice(0, 10);
    if (!window.confirm(`Schimbi perioada întregii selecții în ${from} – ${to}? Disponibilitatea tuturor locațiilor va fi verificată din nou.`)) return;
    setAvailabilityById({}); setAvailabilityLoading(true);
    setFilters((current) => ({ ...current, availability: "AVAILABLE" }));
    setSelection((current) => ({ ...current, periodStart: from, periodEnd: to,
      items: current.items.some((item) => item.locationId === locationId) ? current.items.map((item) => ({ ...item, availabilityState: "UNKNOWN", availabilityWarnings: ["Perioada s-a schimbat; verificăm din nou disponibilitatea."] })) : [...current.items, {
        locationId, sortOrder: current.items.length, snapshot: toSelectionSnapshot(location), availabilityState: "UNKNOWN", availabilityWarnings: ["Verificăm noua perioadă."], suggestedBasePrice: location.suggestedBasePrice, currency: location.currency
      }] }));
  }, [inventory.locations]);

  const showAvailableAlternatives = useCallback((locationId: string) => {
    const location = inventory.locations.find((row) => row.id === locationId);
    if (!location) return;
    setSearch("");
    setFilters((current) => ({ ...current, city: location.city, area: null, mediaTypes: location.mediaType ? [location.mediaType] : [], mediaType: null, availability: "AVAILABLE" }));
  }, [inventory.locations]);

  const updatePeriod = useCallback((patch: Partial<Pick<SelectionState, "periodStart" | "periodEnd">>) => {
    setAvailabilityById({}); setAvailabilityLoading(true);
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
    if (availabilityScopeActive && (availability?.state === "CONFLICT" || availability?.state === "PARTIAL")) return;
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
      return !availabilityScopeActive || availabilityById[location.id]?.state === "AVAILABLE";
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

  const createCommercialQuote = useCallback(() => {
    setHandoffError(null);
    try {
      const key = saveQuoteSelectionDraft({
        ownerUserId: session.id, createdAt: Date.now(),
        clientId: selection.clientId, campaignId: selection.campaignId, opportunityId: selection.opportunityId,
        quoteId: selection.quoteId, expectedRevision: selection.expectedRevision, requestKey: selection.requestKey,
        recipient: selection.recipient, assumptions: selection.assumptions,
        rateInputs: selection.rateInputs?.filter((line) => selection.items.some((item) => item.locationId === line.locationId)),
        clientName: selection.clientName, campaignName: selection.campaignName,
        companyEntity: selection.companyEntity, periodStart: selection.periodStart, periodEnd: selection.periodEnd,
        locationIds: selection.items.map((item) => item.locationId),
      });
      window.location.assign(`/admin/commercial-quotes?selection=${encodeURIComponent(key)}${selection.quoteId ? `&quoteId=${encodeURIComponent(selection.quoteId)}&edit=1` : ""}`);
    } catch (cause) {
      setHandoffError(cause instanceof Error ? cause.message : "Selecția nu a putut fi transferată. Verifică dacă stocarea în browser este permisă.");
    }
  }, [selection, session.id]);

  const periodError =
    periodInvalid
      ? "Data de final trebuie sa fie dupa data de start."
      : null;
  const exportHref = useMemo(
    () => buildAvailabilityExportHref({
      locationIds: selection.items.length ? selection.items.map((item) => item.locationId) : filteredLocations.map((location) => location.id),
      clientName: selection.clientName,
      campaignName: selection.campaignName,
      periodStart: !periodInvalid ? selection.periodStart : "",
      periodEnd: periodValid ? selection.periodEnd : "",
      includeUnavailable: filters.availability === "CONFLICT"
    }),
    [
      filteredLocations,
      filters.availability,
      periodInvalid,
      periodValid,
      selection.campaignName,
      selection.clientName,
      selection.items,
      selection.periodEnd,
      selection.periodStart
    ]
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
              <p className="text-2xl font-black text-white">{inventory.page.total} locații potrivite</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 rounded-lg border border-focus-line bg-focus-ink/60 p-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Client oferta">
              <input
                className="focus-input bg-focus-navy/80"
                type="text"
                maxLength={160}
                value={selection.clientName}
                onChange={(event) => setSelection((current) => ({ ...current, clientName: event.target.value, clientId: undefined, campaignId: undefined }))}
                placeholder="Optional"
              />
            </Field>
            <Field label="Campanie">
              <input
                className="focus-input bg-focus-navy/80"
                type="text"
                maxLength={160}
                value={selection.campaignName}
                onChange={(event) => setSelection((current) => ({ ...current, campaignName: event.target.value, campaignId: undefined }))}
                placeholder="Optional"
              />
            </Field>
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
            <div className="min-h-[66px] rounded-lg border border-focus-line bg-focus-navy/55 p-3 text-sm md:col-span-2 xl:col-span-4">
              <p className="font-black text-white">
                {periodValid && !availabilityLoading ? <CheckCircle2 className="mr-2 inline h-4 w-4 text-emerald-300" /> : <AlertTriangle className="mr-2 inline h-4 w-4 text-focus-yellow" />}
                {availabilityLoading ? "Verificare disponibilitate..." : periodValid ? "Afisam implicit doar locatiile propunibile." : selection.periodStart ? "Disponibilitate calculata din data de start." : "Disponibilitate generala incarcata."}
              </p>
              {periodError ? <p className="mt-1 font-bold text-red-100">{periodError}</p> : null}
              {availabilityError ? <p className="mt-1 font-bold text-red-100">{availabilityError}</p> : null}
              {quoteHeldCount > 0 ? <p className="mt-1 font-bold text-amber-200">{quoteHeldCount} amplasamente sunt păstrate prin HOLD-ul acestei oferte. Revizuirea prețului nu creează o nouă rezervare; aplicarea necesită o nouă aprobare. Pentru alte locații sau date, rezolvă explicit HOLD-ul existent.</p> : null}
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

      <div className="focus-container grid gap-4 py-5 xl:grid-cols-[minmax(0,1fr)_minmax(440px,480px)] 2xl:grid-cols-[minmax(0,1fr)_520px]">
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
              <LocationSelectionFilters filters={filters} onChange={setFilters} options={initialData.options} periodMode={periodMode} priceCurrency={inventory.priceCurrency} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="focus-button secondary !min-h-0 px-3 py-2 text-xs" type="button" onClick={() => { setSearch(""); setFilters({ sort: "code", availability: periodValid ? "PROPOSABLE" : "ALL" }); }}>Resetează filtrele</button>
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

          <div aria-live="polite" className="rounded-lg border border-focus-line bg-focus-navy/80 p-3 text-sm text-slate-300">
            {inventoryLoading ? <p role="status">Se caută în întreg inventarul…</p> : <p>{inventory.locations.length} din {inventory.page.total} locații potrivite încărcate; {filteredLocations.length} respectă filtrul de disponibilitate dintre cele încărcate.</p>}
            {inventory.page.hasMore ? <p className="mt-1 text-xs">Mai există rezultate. Căutarea după cod și filtrele sunt aplicate în întreg inventarul, inclusiv dincolo de această pagină.</p> : null}
            {inventoryError ? <p role="alert" className="mt-2 font-bold text-red-200">{inventoryError}</p> : null}
          </div>
          <SelectionQualityWarnings warnings={warnings} />

          <LocationSelectionResults
            locations={filteredLocations}
            title={filters.availability === "CONFLICT" ? "Locatii indisponibile" : filters.availability === "ALL" ? "Rezultate filtrate" : "Locatii propunibile"}
            availabilityById={availabilityById}
            selectedIds={selectedIds}
            onAdd={addLocation}
            onRemove={removeLocation}
            onApplyWindow={applyAvailableWindow}
            onFindAlternatives={showAvailableAlternatives}
          />
          {inventory.page.hasMore ? <button type="button" className="focus-button secondary justify-center" disabled={inventoryLoading} onClick={() => void loadMoreInventory()}>Încarcă următoarele locații</button> : null}
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
          onCreateQuote={createCommercialQuote}
          quoteBlockedReason={!selectionLoaded ? "Se restaurează selecția…" : !selection.items.length ? "Adaugă locații pentru ofertă." : selection.items.length > 50 ? "O ofertă poate conține maximum 50 de locații." : !periodValid ? "Completează perioada ofertei." : availabilityLoading ? "Așteaptă verificarea disponibilității." : availabilityError ? "Reîncearcă verificarea disponibilității." : selection.items.some((item) => availabilityById[item.locationId]?.state !== "AVAILABLE") ? "Pentru ofertă, toate locațiile trebuie să fie disponibile pe întreaga perioadă." : null}
          handoffError={handoffError}
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
  if (sort !== "selected" && sort !== "availability") return sortSelectionLocations(locations, sort);
  const rank = (location: LocationSelectionLocationDTO) => sort === "selected"
    ? Number(!selectedIds.has(location.id)) : availabilityRank(availabilityById[location.id]?.state);
  return [...locations].sort((left, right) => rank(left) - rank(right) || compare(left.code, right.code));
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


function compare(left: string, right: string) {
  return left.localeCompare(right, "ro");
}

function selectionStorageKey(userId: string) {
  return `focus-admin-location-selection:${userId}`;
}

function buildAvailabilityExportHref(input: {
  locationIds: string[];
  clientName?: string;
  campaignName?: string;
  periodStart?: string;
  periodEnd?: string;
  includeUnavailable?: boolean;
}) {
  const params = new URLSearchParams();
  params.set("scope", "ids");
  if (input.locationIds.length) params.set("ids", input.locationIds.join(","));
  if (input.clientName?.trim()) params.set("client", input.clientName.trim());
  if (input.campaignName?.trim()) params.set("campaign", input.campaignName.trim());
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
      clientId: parsed.clientId, campaignId: parsed.campaignId, opportunityId: parsed.opportunityId,
      quoteId: parsed.quoteId, expectedRevision: parsed.expectedRevision, requestKey: parsed.requestKey,
      recipient: parsed.recipient, assumptions: parsed.assumptions, rateInputs: parsed.rateInputs,
      clientName: parsed.clientName || "",
      campaignName: parsed.campaignName || "",
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
