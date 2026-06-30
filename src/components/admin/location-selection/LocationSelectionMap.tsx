"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Crosshair } from "lucide-react";
import type { LocationSelectionAvailability, LocationSelectionLocationDTO } from "@/lib/location-selection-dto";

type LeafletModule = typeof import("leaflet");
type MarkerClusterOptions = Parameters<NonNullable<LeafletModule["markerClusterGroup"]>>[0] & {
  chunkedLoading?: boolean;
  chunkInterval?: number;
  chunkDelay?: number;
};

const CARTO_VOYAGER_TILES = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export const LocationSelectionMap = memo(function LocationSelectionMap({
  locations,
  availabilityById,
  selectedIds,
  hoveredId,
  fitKey,
  onSelect
}: {
  locations: LocationSelectionLocationDTO[];
  availabilityById: Record<string, LocationSelectionAvailability>;
  selectedIds: Set<string>;
  hoveredId: string | null;
  fitKey: string;
  onSelect: (location: LocationSelectionLocationDTO) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const lastFitKeyRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function setup() {
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
      setReady(true);
    }
    setup();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    if (layerRef.current) map.removeLayer(layerRef.current);

    const clusterOptions: MarkerClusterOptions = {
            disableClusteringAtZoom: 18,
            maxClusterRadius: 18,
            showCoverageOnHover: false,
            chunkedLoading: true,
            chunkInterval: 50,
            chunkDelay: 20,
            iconCreateFunction: (cluster) =>
              L.divIcon({
                className: "",
                html: `<span class="map-cluster ${clusterClass(cluster.getAllChildMarkers?.() || [])}"><span>${cluster.getChildCount()}</span></span>`,
                iconSize: [42, 42],
                iconAnchor: [21, 21]
              })
          };
    const layer =
      typeof L.markerClusterGroup === "function"
        ? L.markerClusterGroup(clusterOptions as Parameters<NonNullable<LeafletModule["markerClusterGroup"]>>[0])
        : L.layerGroup();

    const bounds: [number, number][] = [];
    for (const location of locations) {
      if (location.displayLat == null || location.displayLng == null) continue;
      const availability = availabilityById[location.id];
      const state = availability?.state || "UNKNOWN";
      const selected = selectedIds.has(location.id);
      const hovered = hoveredId === location.id;
      const markerWidth = Math.max(40, Math.min(112, location.code.length * 7 + 22));
      const marker = L.marker([location.displayLat, location.displayLng], {
        riseOnHover: true,
        riseOffset: 1200,
        icon: L.divIcon({
          className: "",
          html: `<span class="map-marker ${markerClass(availability)} ${selected || hovered ? "selected" : ""}" title="${escapeHtml(location.code)}"><span class="map-marker-dot"></span><span>${escapeHtml(location.code)}</span></span>`,
          iconSize: [markerWidth, 28],
          iconAnchor: [markerWidth / 2, 14]
        })
      });
      (marker.options as import("leaflet").MarkerOptions & { statusClass?: string }).statusClass = markerClass(availability);
      marker.on("click", () => onSelect(location));
      marker.bindPopup(popupHtml(location, availabilityById[location.id], selected), { closeButton: false, maxWidth: 260 });
      layer.addLayer(marker);
      bounds.push([location.displayLat, location.displayLng]);
    }

    layer.addTo(map);
    layerRef.current = layer;
    if (bounds.length && lastFitKeyRef.current !== fitKey) {
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
      lastFitKeyRef.current = fitKey;
    }
  }, [availabilityById, fitKey, hoveredId, locations, onSelect, ready, selectedIds]);

  return (
    <section className="premium-map relative z-0 min-h-[520px] overflow-hidden rounded-lg border border-focus-line bg-focus-navy/80">
      <div ref={containerRef} className="h-full min-h-[520px] w-full" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="rounded-lg border border-white/15 bg-focus-navy/92 px-3 py-2 shadow-lg">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-focus-yellow">Harta selectie interna</p>
          <p className="text-xs font-bold text-slate-200">Coordonate de prezentare, nu coordonate private</p>
        </div>
      </div>
      <button
        type="button"
        className="focus-button secondary absolute bottom-4 left-4 z-20 !min-h-0 px-3 py-2 text-xs"
        onClick={() => {
          const map = mapRef.current;
          const points = locations
            .filter((location) => location.displayLat != null && location.displayLng != null)
            .map((location) => [location.displayLat!, location.displayLng!] as [number, number]);
          if (map && points.length) {
            const L = leafletRef.current;
            if (L) map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 15 });
          }
        }}
      >
        <Crosshair size={16} />
        Recentreaza
      </button>
    </section>
  );
});

function markerClass(availability?: LocationSelectionAvailability) {
  if (availability?.tone === "green") return "available";
  if (availability?.tone === "red") return "booked";
  if (availability?.tone === "yellow") return "reserved";
  return "unknown";
}

function clusterClass(markers: import("leaflet").Marker[]) {
  const states = markers.map((marker) => (marker.options as import("leaflet").MarkerOptions & { statusClass?: string }).statusClass);
  if (states.some((state) => state === "booked")) return "booked";
  if (states.some((state) => state === "reserved")) return "reserved";
  if (states.every((state) => state === "available")) return "available";
  return "unknown";
}

function popupHtml(location: LocationSelectionLocationDTO, availability: LocationSelectionAvailability | undefined, selected: boolean) {
  const unavailable = availability?.state === "CONFLICT";
  const action = selected ? "Selectata - click pentru scoatere" : unavailable ? "Indisponibila in perioada selectata" : "Click pentru adaugare";
  return `<div style="min-width:200px">
    <strong>${escapeHtml(location.code)}</strong>
    <div>${escapeHtml(location.city || "")} ${escapeHtml(location.area || "")}</div>
    <div>${escapeHtml(availability?.label || "Alege perioada")}</div>
    <div style="margin-top:6px;font-weight:800">${action}</div>
  </div>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
