"use client";

import { useEffect, useRef } from "react";
import type { LocationDTO } from "@/types/location";

export function AdminGpsMap({
  locations,
  activeId,
  onMove
}: {
  locations: LocationDTO[];
  activeId?: string | null;
  onMove: (id: string, lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      if (!containerRef.current || mapRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;
      leafletRef.current = L;
      const map = L.map(containerRef.current).setView([44.45, 26.1], 10);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
      }).addTo(map);
      mapRef.current = map;
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
    const points: [number, number][] = [];

    for (const location of locations) {
      if (location.latDisplay == null || location.lngDisplay == null) continue;
      const markerWidth = Math.max(48, Math.min(124, location.code.length * 8 + 22));
      const marker = L.marker([location.latDisplay, location.lngDisplay], {
        draggable: true,
        icon: L.divIcon({
          className: "",
          html: `<span class="map-marker ${location.gpsAuditStatus === "OK" ? "available" : "available_from"}">${escapeHtml(
            location.code
          )}</span>`,
          iconSize: [markerWidth, 36],
          iconAnchor: [markerWidth / 2, 18]
        })
      });

      marker.bindTooltip(`${location.code} - ${location.gpsAuditStatus}`);
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        onMove(location.id, pos.lat, pos.lng);
      });
      marker.addTo(layer);
      points.push([location.latDisplay, location.lngDisplay]);
    }

    layer.addTo(map);
    layerRef.current = layer;
    if (points.length) map.fitBounds(points, { padding: [32, 32], maxZoom: 16 });
  }, [locations, onMove]);

  useEffect(() => {
    const active = locations.find((location) => location.id === activeId);
    if (!active || active.latDisplay == null || active.lngDisplay == null || !mapRef.current) return;
    mapRef.current.flyTo([active.latDisplay, active.lngDisplay], 16);
  }, [activeId, locations]);

  return <div ref={containerRef} className="h-[520px] rounded-lg border border-focus-line" />;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
