"use client";

import maplibregl from "@neshan-maps-platform/maplibre-sdk";
import "@neshan-maps-platform/maplibre-sdk/style.css";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_MAX_ZOOM, MAP_STYLE_URL } from "@/lib/map/config";
import type { LatLng } from "@/lib/map/coords";

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  kind?: "place" | "user" | "destination";
};

const COLORS = {
  place: "#14532d",
  user: "#2563eb",
  destination: "#dc2626",
} as const;

const ROUTE_SOURCE = "harako-route";
const ROUTE_LAYER = "harako-route-line";

// تایپ‌های سازگار با SDK نشون
type NeshanMap = InstanceType<typeof maplibregl.Map>;
type NeshanMarker = InstanceType<typeof maplibregl.Marker>;

function markerElement(
  m: MapMarker,
  selected: boolean,
  onSelect?: (id: string) => void,
): HTMLElement {
  const kind = m.kind ?? "place";
  const size = selected ? 30 : 24;
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", m.title);
  el.title = m.title;
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:9999px;padding:0;cursor:${
    kind === "place" ? "pointer" : "default"
  };background:${selected ? "#a3e635" : COLORS[kind]};border:4px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.45);box-sizing:border-box`;
  if (kind === "place" && onSelect) {
    el.addEventListener("click", () => onSelect(m.id));
  }
  return el;
}

/**
 * Thin wrapper around Neshan MapLibre SDK.
 * It draws exactly what it is given: markers and, optionally, a route line made of real points.
 * MapLibre uses [longitude, latitude] order; everything outside this file uses {lat, lng}.
 */
export default function MapLibreMap({
  markers,
  selectedId,
  onSelect,
  line,
  label,
  onError,
}: {
  markers: MapMarker[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  line?: LatLng[] | null;
  label: string;
  /** The style/tiles could not be loaded (wrong URL, key refused, offline). */
  onError?: () => void;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<NeshanMap | null>(null);
  const live = useRef<NeshanMarker[]>([]);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const fitted = useRef("");

  useEffect(() => {
    if (!el.current || map.current) return;

    const apiKey = process.env.NEXT_PUBLIC_NESHAN_MAP_API_KEY;

    if (!apiKey) {
      console.error("Neshan API Key is missing. Please set NEXT_PUBLIC_NESHAN_API_KEY in your .env file.");
      onErrorRef.current?.();
      return;
    }

    const m = new maplibregl.Map({
      container: el.current,
      style: MAP_STYLE_URL,
      center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
      zoom: DEFAULT_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      attributionControl: { compact: true },
      apiKey: apiKey,
    });

    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    m.on("load", () => setReady(true));

    m.on("error", (e) => {
      const status = (e as unknown as { error?: { status?: number } }).error?.status;
      if (!m.isStyleLoaded() || status === 401 || status === 403) {
        onErrorRef.current?.();
      }
    });

    map.current = m;

    return () => {
      live.current.forEach((x) => x.remove());
      live.current = [];
      m.remove();
      map.current = null;
      setReady(false);
    };
  }, []);

  // Route line
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;

    const coords = (line ?? []).map((p) => [p.lng, p.lat]);
    const data = {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates: coords },
    };

    const src = m.getSource(ROUTE_SOURCE) as any;
    if (src) {
      src.setData(data);
    } else {
      m.addSource(ROUTE_SOURCE, { type: "geojson", data });
      m.addLayer({
        id: ROUTE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#1d4ed8", "line-width": 5, "line-opacity": 0.85 },
      });
    }
  }, [line, ready]);

  // Markers
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;

    live.current.forEach((x) => x.remove());
    live.current = markers.map((mk) =>
      new maplibregl.Marker({
        element: markerElement(mk, mk.id === selectedId, (id) => onSelectRef.current?.(id)),
      })
        .setLngLat([mk.lng, mk.lat])
        .addTo(m),
    );

    // Re-frame only when the set of things to show changes
    const key = `${markers.map((x) => x.id).join(",")}|${line?.length ?? 0}`;
    if (fitted.current !== key) {
      fitted.current = key;
      const pts: [number, number][] = [
        ...(line ?? []).map((p) => [p.lng, p.lat] as [number, number]),
        ...markers.map((x) => [x.lng, x.lat] as [number, number]),
      ];

      if (pts.length > 1) {
        const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
        pts.forEach((p) => b.extend(p));
        m.fitBounds(b, { padding: 48, maxZoom: 15, duration: 0 });
      } else if (pts.length === 1) {
        m.jumpTo({ center: pts[0], zoom: 14 });
      }
    }
  }, [markers, selectedId, line, ready]);

  return <div ref={el} role="region" aria-label={label} className="h-full w-full" />;
}
