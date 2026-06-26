"use client";

import { useEffect, useRef } from "react";
import type { LocationDTO } from "@/types/location";

type LeafletModule = typeof import("leaflet");

export function AdminSalesMap({
  locations,
  selectedIds,
  onSelect
}: {
  locations: LocationDTO[];
  selectedIds?: string[];
  onSelect: (location: LocationDTO) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const selectedIdsRef = useRef(selectedIds || []);
  const boundsKeyRef = useRef("");

  useEffect(() => {
    selectedIdsRef.current = selectedIds || [];
  }, [selectedIds]);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      if (!containerRef.current || mapRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        scrollWheelZoom: true,
        zoomControl: false
      }).setView([44.45, 26.1], 9);

      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
      }).addTo(map);
      mapRef.current = map;

      window.setTimeout(() => map.invalidateSize(), 120);
    }

    setup();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (layerRef.current) map.removeLayer(layerRef.current);

    const layer = L.layerGroup();
    const bounds: [number, number][] = [];
    const selectedSet = new Set(selectedIdsRef.current);
    const boundsKey = locations.map((location) => location.id).join("|");

    for (const location of locations) {
      if (location.latDisplay == null || location.lngDisplay == null) continue;

      const markerWidth = Math.max(42, Math.min(112, location.code.length * 7 + 22));
      const marker = L.marker([location.latDisplay, location.lngDisplay], {
        riseOnHover: true,
        icon: L.divIcon({
          className: "",
          html: `<span class="map-marker ${statusClass(location)}${selectedSet.has(location.id) ? " selected" : ""}" title="${escapeHtml(
            markerTitle(location)
          )}">${escapeHtml(location.code)}</span>`,
          iconSize: [markerWidth, 30],
          iconAnchor: [markerWidth / 2, 15]
        })
      });

      marker.on("click", () => onSelect(location));
      marker.bindTooltip(markerTitle(location));
      marker.addTo(layer);
      bounds.push([location.latDisplay, location.lngDisplay]);
    }

    layer.addTo(map);
    layerRef.current = layer;

    if (bounds.length) {
      if (boundsKeyRef.current !== boundsKey) {
        map.fitBounds(bounds, { padding: [26, 26], maxZoom: bounds.length === 1 ? 15 : 12 });
        boundsKeyRef.current = boundsKey;
      }
    }
  }, [locations, onSelect, selectedIds]);

  useEffect(() => {
    if (!selectedIds || selectedIds.length !== 1) return;
    const selected = locations.find((location) => location.id === selectedIds[0]);
    if (!selected || selected.latDisplay == null || selected.lngDisplay == null || !mapRef.current) return;
    mapRef.current.flyTo([selected.latDisplay, selected.lngDisplay], 15, { duration: 0.4 });
  }, [locations, selectedIds]);

  return <div ref={containerRef} className="h-[340px] min-h-[340px] rounded-lg border border-focus-line" />;
}

function statusClass(location: LocationDTO) {
  if (location.publicStatus === "AVAILABLE") return location.availabilityDetail ? "available_from" : "available";
  return location.publicStatus.toLowerCase();
}

function markerTitle(location: LocationDTO) {
  return `${location.code} - ${location.city || "N/A"} - ${location.availabilityLabel}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
