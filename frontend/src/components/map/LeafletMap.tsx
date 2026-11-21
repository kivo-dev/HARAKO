"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { MAP_ATTRIBUTION, MAP_MAX_ZOOM, MAP_TILE_URL, DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/map/config";
import type { LatLng } from "@/lib/map/coords";

export type MapMarker = { id: string; lat: number; lng: number; title: string; kind?: "place" | "user" | "destination" };

const COLORS = { place: "#14532d", user: "#2563eb", destination: "#dc2626" } as const;

function icon(kind: NonNullable<MapMarker["kind"]>, selected: boolean) {
  const size = selected ? 30 : 24;
  const fill = selected ? "#a3e635" : COLORS[kind];
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:9999px;background:${fill};border:4px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.45);box-sizing:border-box"></span>`,
  });
}

/**
 * Thin wrapper around Leaflet. It draws exactly what it is given: markers and, optionally, a route line
 * made of real points. It never invents a line between two markers.
 * The wrapper is `isolate`d so Leaflet's internal z-indexes (up to 1000) cannot climb over the BottomNav.
 */
export default function LeafletMap({
  markers,
  selectedId,
  onSelect,
  line,
  label,
}: {
  markers: MapMarker[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  line?: LatLng[] | null;
  label: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const fitted = useRef("");

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], DEFAULT_ZOOM);
    L.tileLayer(MAP_TILE_URL, { attribution: MAP_ATTRIBUTION, maxZoom: MAP_MAX_ZOOM }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const t = setTimeout(() => m.invalidateSize(), 50);
    return () => {
      clearTimeout(t);
      m.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    if (line && line.length > 1) {
      L.polyline(
        line.map((p) => [p.lat, p.lng] as [number, number]),
        { color: "#1d4ed8", weight: 5, opacity: 0.85 },
      ).addTo(g);
    }
    for (const mk of markers) {
      const kind = mk.kind ?? "place";
      const marker = L.marker([mk.lat, mk.lng], { icon: icon(kind, mk.id === selectedId), title: mk.title, alt: mk.title, keyboard: true });
      if (kind === "place") marker.on("click", () => onSelectRef.current?.(mk.id));
      marker.addTo(g);
    }
    // Re-frame only when the set of things to show changes, not on every selection.
    const key = `${markers.map((x) => x.id).join(",")}|${line?.length ?? 0}`;
    if (fitted.current !== key) {
      fitted.current = key;
      const pts: [number, number][] = [
        ...(line ?? []).map((p) => [p.lat, p.lng] as [number, number]),
        ...markers.map((x) => [x.lat, x.lng] as [number, number]),
      ];
      if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { padding: [32, 32], maxZoom: 15 });
      else if (pts.length === 1) m.setView(pts[0], 14);
    }
  }, [markers, selectedId, line]);

  return <div ref={el} role="region" aria-label={label} className="h-full w-full" />;
}
