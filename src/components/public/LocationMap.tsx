"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LocationDTO } from "@/types/location";

type LeafletModule = typeof import("leaflet");

export function LocationMap({
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
        scrollWheelZoom: true,
        zoomControl: false
      }).setView([44.45, 26.1], 10);

      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
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

    const layer =
      typeof L.markerClusterGroup === "function"
        ? L.markerClusterGroup({
            disableClusteringAtZoom: 18,
            maxClusterRadius: (zoom) => {
              if (zoom <= 8) return 28;
              if (zoom <= 10) return 18;
              if (zoom <= 12) return 10;
              return 6;
            },
            showCoverageOnHover: false,
            spiderfyOnEveryZoom: true,
            spiderfyDistanceMultiplier: 1.75,
            spiderfyOnMaxZoom: true,
            zoomToBoundsOnClick: false,
            iconCreateFunction: (cluster) => {
              const childMarkers = cluster.getAllChildMarkers?.() ?? [];
              const statusClass = clusterStatusClass(childMarkers);
              return L.divIcon({
                className: "",
                html: `<span class="map-cluster ${statusClass}" title="${clusterTitle(statusClass)}">${cluster.getChildCount()}</span>`,
                iconSize: [38, 38],
                iconAnchor: [19, 19]
              });
            }
          })
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
          html: `<span class="map-marker ${statusClass}" title="${escapeHtml(location.code)}">${escapeHtml(location.code)}</span>`,
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
          : "relative z-0 h-full min-h-[480px] overflow-hidden rounded-lg border border-focus-line"
      }
    >
      <div ref={containerRef} className="h-full min-h-[480px] w-full" />
      <button
        type="button"
        className="focus-button secondary absolute left-4 top-4 z-20"
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
        className="focus-button secondary absolute right-4 top-4 z-20"
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
