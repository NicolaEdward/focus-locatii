"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { LocationDTO } from "@/types/location";

type LeafletModule = typeof import("leaflet");
type MarkerClusterOptions = Parameters<NonNullable<LeafletModule["markerClusterGroup"]>>[0] & {
  chunkedLoading?: boolean;
  chunkInterval?: number;
  chunkDelay?: number;
};

const CARTO_VOYAGER_TILES = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

function LocationMapComponent({
  locations,
  onSelect,
  fitKey = "initial"
}: {
  locations: LocationDTO[];
  onSelect: (location: LocationDTO) => void;
  fitKey?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const lastFitKeyRef = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function setupMap() {
      if (!containerRef.current || mapRef.current) return;

      const L = await import("leaflet");
      (window as typeof window & { L?: LeafletModule }).L = L;
      await import("leaflet.markercluster");
      if (cancelled || !containerRef.current) return;

      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        preferCanvas: true,
        scrollWheelZoom: false,
        zoomControl: false,
        zoomSnap: 0.25
      }).setView([44.45, 26.1], 10);

      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer(CARTO_VOYAGER_TILES, {
        maxZoom: 20,
        subdomains: "abcd",
        detectRetina: true,
        attribution: CARTO_ATTRIBUTION
      }).addTo(map);

      mapRef.current = map;
      setMapReady(true);
    }

    setupMap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    if (isExpanded) document.body.style.overflow = "hidden";

    const timers = [0, 80, 220, 520].map((delay) =>
      window.setTimeout(() => {
        mapRef.current?.invalidateSize();
      }, delay)
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      document.body.style.overflow = previousOverflow;
    };
  }, [isExpanded]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isEscapeKey(event) || !isExpanded) return;
      if (document.querySelector('[aria-label="Inchide mini prezentarea"]')) return;
      event.preventDefault();
      setIsExpanded(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!mapReady || !L || !map) return;

    if (layerRef.current) {
      map.removeLayer(layerRef.current);
    }

    const clusterOptions: MarkerClusterOptions = {
      disableClusteringAtZoom: 18,
      maxClusterRadius: (zoom) => {
        if (zoom <= 8) return 28;
        if (zoom <= 10) return 18;
        if (zoom <= 12) return 10;
        return 6;
      },
      showCoverageOnHover: false,
      spiderfyOnEveryZoom: false,
      spiderfyDistanceMultiplier: 1.35,
      spiderfyOnMaxZoom: true,
      zoomToBoundsOnClick: true,
      chunkedLoading: true,
      chunkInterval: 60,
      chunkDelay: 20,
      iconCreateFunction: (cluster) => {
        const childMarkers = cluster.getAllChildMarkers?.() ?? [];
        const statusClass = clusterStatusClass(childMarkers);
        return L.divIcon({
          className: "",
          html: `<span class="map-cluster ${statusClass}" title="${clusterTitle(statusClass)}"><span>${cluster.getChildCount()}</span></span>`,
          iconSize: [42, 42],
          iconAnchor: [21, 21]
        });
      }
    };

    const layer =
      typeof L.markerClusterGroup === "function"
        ? L.markerClusterGroup(clusterOptions)
        : L.layerGroup();

    const bounds: [number, number][] = [];

    for (const location of locations) {
      if (location.latDisplay == null || location.lngDisplay == null) continue;
      const statusClass = location.publicStatus.toLowerCase();
      const markerWidth = Math.max(38, Math.min(104, location.code.length * 7 + 18));
      const marker = L.marker([location.latDisplay, location.lngDisplay], {
        riseOnHover: true,
        riseOffset: 1200,
        icon: L.divIcon({
          className: "",
          html: `<span class="map-marker ${statusClass}" title="${escapeHtml(location.code)}"><span class="map-marker-dot"></span><span>${escapeHtml(location.code)}</span></span>`,
          iconSize: [markerWidth, 28],
          iconAnchor: [markerWidth / 2, 14]
        })
      });

      marker.on("click", () => onSelect(location));
      (marker.options as import("leaflet").MarkerOptions & { statusClass?: string }).statusClass = statusClass;
      layer.addLayer(marker);
      bounds.push([location.latDisplay, location.lngDisplay]);
    }

    layer.addTo(map);
    layerRef.current = layer;

    const shouldFit = bounds.length && lastFitKeyRef.current !== fitKey;
    if (shouldFit) {
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
      lastFitKeyRef.current = fitKey;
    }
  }, [fitKey, locations, mapReady, onSelect]);

  function toggleExpanded() {
    setIsExpanded((current) => !current);
  }

  return (
    <div
      ref={wrapperRef}
      className={
        isExpanded
          ? "fixed inset-0 z-[90] h-screen min-h-screen overflow-hidden bg-focus-navy"
          : "premium-map relative z-0 h-full min-h-[340px] overflow-hidden rounded-lg border border-focus-line md:min-h-[480px]"
      }
    >
      <div ref={containerRef} className="h-full min-h-[340px] w-full md:min-h-[480px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="rounded-lg border border-white/15 bg-focus-navy/92 px-3 py-2 shadow-lg">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-focus-yellow">Harta portofoliu</p>
          <p className="text-xs font-bold text-slate-200">Coordonate publice de prezentare</p>
        </div>
      </div>
      <button
        type="button"
        className="focus-button secondary absolute bottom-4 left-4 z-20 !min-h-0 px-3 py-2 text-xs"
        onClick={() => {
          const map = mapRef.current;
          const points = locations
            .filter((location) => location.latDisplay != null && location.lngDisplay != null)
            .map((location) => [location.latDisplay!, location.lngDisplay!] as [number, number]);
          if (map && points.length) map.fitBounds(points, { padding: [36, 36], maxZoom: 15 });
        }}
      >
        Vezi toate locatiile
      </button>
      <button
        type="button"
        className="focus-button secondary absolute right-4 top-4 z-20 !min-h-0 px-3 py-2 text-xs"
        onClick={toggleExpanded}
        aria-label={isExpanded ? "Inchide harta fullscreen" : "Mareste harta fullscreen"}
        aria-pressed={isExpanded}
      >
        {isExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        {isExpanded ? "Inchide" : "Fullscreen"}
      </button>
    </div>
  );
}

export const LocationMap = memo(LocationMapComponent);

function isEscapeKey(event: KeyboardEvent) {
  return event.key === "Escape" || event.key === "Esc" || event.code === "Escape";
}

function clusterStatusClass(markers: import("leaflet").Marker[]) {
  const statuses = markers.map((marker) => (marker.options as import("leaflet").MarkerOptions & { statusClass?: string }).statusClass);
  if (!statuses.length) return "unknown";
  if (statuses.some((status) => status === "booked" || status === "reserved" || status === "available_from")) return "booked";
  if (statuses.every((status) => status === "available")) return "available";
  return "unknown";
}

function clusterTitle(statusClass: string) {
  if (statusClass === "available") return "Toate locatiile din grup sunt disponibile";
  if (statusClass === "available_from") return "Grup cu locatii inchiriate";
  if (statusClass === "booked") return "Grup cu locatii rezervate sau inchiriate";
  return "Grup cu status de verificat";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
