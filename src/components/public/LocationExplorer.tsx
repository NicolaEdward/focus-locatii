"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { Filter, Search, ShoppingBag, SlidersHorizontal } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CategoryDTO, LocationDTO } from "@/types/location";
import { LocationCard } from "@/components/public/LocationCard";
import { MediaPlanBar } from "@/components/public/MediaPlanBar";
import { LocationMiniPreview } from "@/components/public/LocationMiniPreview";
import { LocationPresentationOverlay } from "@/components/public/LocationPresentationOverlay";
import { PortfolioHero } from "@/components/public/PortfolioHero";
import { ShortlistDrawer } from "@/components/public/ShortlistDrawer";

const LocationMap = dynamic(() => import("@/components/public/LocationMap").then((mod) => mod.LocationMap), {
  ssr: false,
  loading: () => <div className="grid min-h-[480px] place-items-center rounded-lg border border-focus-line">Se incarca harta...</div>
});

type Filters = {
  search: string;
  category: string;
  city: string;
  type: string;
  status: string;
  premium: boolean;
};

const defaultFilters: Filters = {
  search: "",
  category: "",
  city: "",
  type: "",
  status: "",
  premium: false
};

const PAGE_SIZE = 24;

export function LocationExplorer({
  locations: initialLocations,
  categories
}: {
  locations: LocationDTO[];
  categories: CategoryDTO[];
}) {
  const [locations, setLocations] = useState<LocationDTO[]>(initialLocations);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [previewLocation, setPreviewLocation] = useState<LocationDTO | null>(null);
  const [presentationLocation, setPresentationLocation] = useState<LocationDTO | null>(null);
  const [shortlist, setShortlist] = useState<string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const locationsSignatureRef = useRef(locationsSignature(initialLocations));
  const deferredFilters = useDeferredValue(filters);

  useEffect(() => {
    setLocations(initialLocations);
    locationsSignatureRef.current = locationsSignature(initialLocations);
  }, [initialLocations]);

  useEffect(() => {
    let cancelled = false;

    async function refreshLocations() {
      try {
        const response = await fetch("/api/locations");
        if (!response.ok) return;

        const payload = await response.json();
        const nextLocations = Array.isArray(payload) ? payload : payload.locations;
        if (!Array.isArray(nextLocations) || cancelled) return;

        const nextSignature = locationsSignature(nextLocations);
        if (nextSignature === locationsSignatureRef.current) return;

        locationsSignatureRef.current = nextSignature;
        setLocations(nextLocations);
        setPreviewLocation((current) =>
          current ? nextLocations.find((location: LocationDTO) => location.id === current.id) || current : current
        );
        setPresentationLocation((current) =>
          current ? nextLocations.find((location: LocationDTO) => location.id === current.id) || current : current
        );
      } catch {
        // Keep the current portfolio visible if a background refresh fails.
      }
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") refreshLocations();
    }

    refreshLocations();
    const intervalId = window.setInterval(refreshLocations, 60_000);
    window.addEventListener("focus", refreshLocations);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshLocations);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("focus-shortlist");
    if (stored) setShortlist(JSON.parse(stored));
  }, []);

  useEffect(() => {
    window.localStorage.setItem("focus-shortlist", JSON.stringify(shortlist));
  }, [shortlist]);

  useEffect(() => {
    if (!selectionNotice) return;
    const timer = window.setTimeout(() => setSelectionNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [selectionNotice]);

  const cities = useMemo(() => unique(locations.map((location) => location.city)), [locations]);
  const types = useMemo(() => unique(locations.map((location) => location.type)), [locations]);
  const locationCodeById = useMemo(() => new Map(locations.map((location) => [location.id, location.code])), [locations]);

  const filtered = useMemo(() => {
    return locations.filter((location) => {
      const text = [
        location.address,
        location.city,
        location.county,
        location.code,
        location.type,
        location.categoryName
      ]
        .join(" ")
        .toLowerCase();
      const search = deferredFilters.search.toLowerCase();
      if (search && !text.includes(search)) return false;
      if (deferredFilters.category && location.categorySlug !== deferredFilters.category) return false;
      if (deferredFilters.city && location.city !== deferredFilters.city) return false;
      if (deferredFilters.type && location.type !== deferredFilters.type) return false;
      if (deferredFilters.status === "AVAILABLE" && location.publicStatus !== "AVAILABLE") return false;
      if (deferredFilters.status === "RENTED" && location.publicStatus !== "BOOKED") return false;
      if (deferredFilters.status === "RESERVED" && location.publicStatus !== "RESERVED") return false;
      if (deferredFilters.premium && !location.isPremium) return false;
      return true;
    });
  }, [deferredFilters, locations]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filters]);

  const visibleLocations = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const shortlistSet = useMemo(() => new Set(shortlist), [shortlist]);
  const selectedLocations = useMemo(() => locations.filter((location) => shortlistSet.has(location.id)), [locations, shortlistSet]);
  const mapFitKey = useMemo(
    () =>
      `${deferredFilters.search}|${deferredFilters.category}|${deferredFilters.city}|${deferredFilters.type}|${deferredFilters.status}|${deferredFilters.premium}`,
    [deferredFilters]
  );
  const toggleShortlist = useCallback(
    (id: string) => {
      setShortlist((current) => {
        const isSelected = current.includes(id);
        if (!isSelected) setSelectionNotice(`${locationCodeById.get(id) || "Locatia"} a fost adaugata in selectie.`);
        return isSelected ? current.filter((item) => item !== id) : [...current, id];
      });
    },
    [locationCodeById]
  );

  const openPreview = useCallback((location: LocationDTO) => {
    setPreviewLocation(location);
  }, []);

  const openPresentation = useCallback((location: LocationDTO) => {
    setPreviewLocation(null);
    setPresentationLocation(location);
  }, []);

  return (
    <main className="focus-shell pb-32">
      <PortfolioHero locations={locations} selectedCount={selectedLocations.length} onOpenShortlist={() => setDrawerOpen(true)} />

      <section id="portfolio-map" className="focus-container grid gap-8 py-8">
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <aside className="focus-card no-print h-fit rounded-lg p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-lg bg-focus-yellow text-focus-navy">
                <SlidersHorizontal size={22} />
              </span>
              <div>
                <p className="text-xs font-black uppercase text-focus-yellow">Catalog outdoor media</p>
                <h1 className="font-display text-3xl font-black uppercase leading-none text-white">Gaseste locatii</h1>
              </div>
            </div>

            <div className="mt-6 grid gap-4">
              <label className="grid gap-2">
                <span className="flex items-center gap-2 text-sm font-bold text-slate-200">
                  <Search size={16} /> Cauta
                </span>
                <input
                  className="focus-input"
                  value={filters.search}
                  onChange={(event) => setFilters({ ...filters, search: event.target.value })}
                  placeholder="Cod, zona, adresa, oras"
                />
              </label>

              <Select label="Categorie" value={filters.category} onChange={(category) => setFilters({ ...filters, category })}>
                <option value="">Toate categoriile</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.slug}>
                    {category.name}
                  </option>
                ))}
              </Select>

              <Select label="Oras / zona" value={filters.city} onChange={(city) => setFilters({ ...filters, city })}>
                <option value="">Toate orasele</option>
                {cities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </Select>

              <Select label="Format media" value={filters.type} onChange={(type) => setFilters({ ...filters, type })}>
                <option value="">Toate tipurile</option>
                {types.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>

              <Select label="Disponibilitate" value={filters.status} onChange={(status) => setFilters({ ...filters, status })}>
                <option value="">Toate statusurile</option>
                <option value="AVAILABLE">Disponibil acum</option>
                <option value="RENTED">Inchiriat</option>
                <option value="RESERVED">Rezervat</option>
              </Select>

              <label className="flex items-center justify-between rounded-lg border border-focus-line px-3 py-2">
                <span className="font-bold">Premium</span>
                <input
                  type="checkbox"
                  checked={filters.premium}
                  onChange={(event) => setFilters({ ...filters, premium: event.target.checked })}
                />
              </label>

              <button type="button" className="focus-button secondary" onClick={() => setFilters(defaultFilters)}>
                <Filter size={18} />
                Curata filtrele
              </button>
            </div>
          </aside>

          <section className="grid gap-5">
            <LocationMap
              locations={filtered}
              onSelect={openPreview}
              fitKey={mapFitKey}
            />
          </section>
        </div>

        <section id="portfolio-list" className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-black uppercase text-focus-yellow">Selectie comerciala</p>
              <h2 className="font-display text-4xl font-black uppercase">Locatii pentru campanie</h2>
              <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-slate-300">
                Deschide prezentarea, verifica imaginile si adauga pozitiile potrivite in selectia ta.
              </p>
            </div>
            <button className="focus-button no-print" type="button" onClick={() => setDrawerOpen(true)}>
              <ShoppingBag size={20} />
              Selectia ta ({selectedLocations.length})
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleLocations.map((location) => (
              <LocationCard
                key={location.id}
                location={location}
                onOpen={openPreview}
                onShortlist={toggleShortlist}
                isShortlisted={shortlistSet.has(location.id)}
              />
            ))}
          </div>

          {visibleLocations.length < filtered.length ? (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                className="focus-button secondary no-print"
                onClick={() => setVisibleCount((current) => Math.min(current + PAGE_SIZE, filtered.length))}
              >
                Arata mai multe locatii ({filtered.length - visibleLocations.length})
              </button>
            </div>
          ) : null}
        </section>
      </section>

      <AnimatePresence>
        {previewLocation ? (
          <LocationMiniPreview
            location={previewLocation}
            onClose={() => setPreviewLocation(null)}
            onOpenPresentation={() => openPresentation(previewLocation)}
            onShortlist={() => toggleShortlist(previewLocation.id)}
            isShortlisted={shortlistSet.has(previewLocation.id)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {presentationLocation ? (
          <LocationPresentationOverlay
            location={presentationLocation}
            onClose={() => setPresentationLocation(null)}
            onShortlist={() => toggleShortlist(presentationLocation.id)}
            isShortlisted={shortlistSet.has(presentationLocation.id)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {selectionNotice ? (
          <motion.div
            className="no-print fixed right-4 top-24 z-50 max-w-sm rounded-lg border border-focus-yellow/60 bg-focus-navy/95 px-4 py-3 text-sm font-black uppercase text-white shadow-focus"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {selectionNotice}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {selectedLocations.length && !drawerOpen ? (
          <MediaPlanBar locations={selectedLocations} onOpen={() => setDrawerOpen(true)} />
        ) : null}
      </AnimatePresence>

      <ShortlistDrawer
        locations={selectedLocations}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onRemove={(id) => toggleShortlist(id)}
      />
    </main>
  );
}

function Select({
  label,
  value,
  onChange,
  children
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-bold text-slate-200">{label}</span>
      <select className="focus-input" value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function unique(values: Array<string | null>) {
  return Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
}

function locationsSignature(locations: LocationDTO[]) {
  return JSON.stringify(
    locations.map((location) => ({
      id: location.id,
      code: location.code,
      categoryName: location.categoryName,
      city: location.city,
      county: location.county,
      address: location.address,
      type: location.type,
      size: location.size,
      sqm: location.sqm,
      illum: location.illum,
      rateCard: location.rateCard,
      rateCardValue: location.rateCardValue,
      installationRemoval: location.installationRemoval,
      installationRemovalValue: location.installationRemovalValue,
      availabilityText: location.availabilityText,
      availableFrom: location.availableFrom,
      availableUntil: location.availableUntil,
      bookedFrom: location.bookedFrom,
      bookedUntil: location.bookedUntil,
      status: location.status,
      publicStatus: location.publicStatus,
      availabilityLabel: location.availabilityLabel,
      availabilityDetail: location.availabilityDetail,
      latDisplay: location.latDisplay,
      lngDisplay: location.lngDisplay,
      mainPhotoUrl: location.mainPhotoUrl,
      productionSketchUrl: location.productionSketchUrl,
      isPremium: location.isPremium,
      isFeatured: location.isFeatured,
      images: location.images.map((image) => ({
        id: image.id,
        url: image.url,
        sortOrder: image.sortOrder,
        isMain: image.isMain
      })),
      updatedAt: location.updatedAt
    }))
  );
}
