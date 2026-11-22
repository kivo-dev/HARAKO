"use client";

import { MapPin, RefreshCw, Route as RouteIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@/i18n/navigation";
import { fetchAllPlaces } from "@/lib/api/client";
import { apiEnabled } from "@/lib/api/config";
import { isAbort } from "@/lib/api/errors";
import { categoryIcons, categoryKeys, pick, samplePlaces, type CategoryKey, type Place } from "@/lib/places";
import { MapCanvas } from "./MapCanvas";
import type { MapMarker } from "./MapLibreMap";

type Status = "loading" | "ready" | "error";

/** Map of every published place that has valid coordinates. Places without coordinates are counted, not drawn. */
export function MapView() {
  const t = useTranslations("Map");
  const tc = useTranslations("Categories");
  const locale = useLocale();
  const focus = useSearchParams().get("place");

  const [places, setPlaces] = useState<Place[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [category, setCategory] = useState<CategoryKey | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(focus);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!apiEnabled) {
      setPlaces(samplePlaces);
      setStatus("ready");
      return;
    }
    const ctrl = new AbortController();
    setStatus("loading");
    fetchAllPlaces(ctrl.signal)
      .then((list) => {
        setPlaces(list);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) setStatus("error");
      });
    return () => ctrl.abort();
  }, [reloadKey]);

  const withCoords = useMemo(() => places.filter((p) => p.coords), [places]);
  const shown = useMemo(() => withCoords.filter((p) => category === "all" || p.category === category), [withCoords, category]);
  const markers: MapMarker[] = useMemo(
    () => shown.map((p) => ({ id: p.id, lat: p.coords!.lat, lng: p.coords!.lng, title: pick(p.name, locale) })),
    [shown, locale],
  );
  const selected = shown.find((p) => p.id === selectedId) ?? null;
  const missing = places.length - withCoords.length;
  const onSelect = useCallback((id: string) => setSelectedId(id), []);

  return (
    <div className="px-5 md:px-10">
      <h1 className="font-display text-3xl leading-[1.4] text-forest-950 md:text-4xl">{t("title")}</h1>

      <div className="no-scrollbar -mx-5 mt-4 flex gap-2 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:px-0">
        {(["all", ...categoryKeys] as const).map((key) => {
          const Icon = key === "all" ? MapPin : categoryIcons[key];
          const active = category === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setCategory(key);
                setSelectedId(null);
              }}
              className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-5 text-sm font-medium transition ${
                active ? "bg-forest-950 text-white" : "bg-white text-ink-700 hover:bg-mist-50"
              }`}
            >
              <Icon className="size-4" aria-hidden />
              {key === "all" ? t("all") : tc(key)}
            </button>
          );
        })}
      </div>

      {/* isolate = own stacking context, so the map can never paint over the bottom navigation */}
      <div className="relative isolate z-0 mt-4 h-[62dvh] overflow-hidden rounded-4xl bg-white shadow-soft md:h-[70dvh]">
        <MapCanvas markers={markers} selectedId={selectedId} onSelect={onSelect} label={t("mapLabel")} />

        {status === "loading" && (
          <div className="absolute inset-0 z-[500] flex items-center justify-center bg-white/70 text-sm text-ink-700" role="status">
            {t("loading")}
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 z-[500] flex flex-col items-center justify-center gap-3 bg-white/90 p-6 text-center" role="alert">
            <p className="font-semibold">{t("error")}</p>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-lime-400 px-6 text-sm font-semibold text-forest-950"
            >
              <RefreshCw className="size-4" aria-hidden />
              {t("retry")}
            </button>
          </div>
        )}
        {status === "ready" && shown.length === 0 && (
          <p className="pointer-events-none absolute inset-x-4 top-4 z-[500] rounded-2xl bg-white/95 px-4 py-3 text-center text-sm text-ink-700 shadow-soft" role="status">
            {withCoords.length === 0 ? t("empty") : t("emptyFilter")}
          </p>
        )}

        {selected && (
          <div className="absolute inset-x-3 bottom-3 z-[500] rounded-3xl bg-white p-4 shadow-float">
            <p className="text-xs text-ink-500">{tc(selected.category)}</p>
            <h2 className="mt-0.5 text-base font-semibold">{pick(selected.name, locale)}</h2>
            <div className="mt-3 flex gap-2">
              <Link
                href={`/discover/${selected.id}`}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-forest-950 px-4 text-sm font-medium text-white"
              >
                {t("details")}
              </Link>
              <Link
                href={{ pathname: "/route", query: { to: selected.id } }}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-lime-400 px-4 text-sm font-semibold text-forest-950"
              >
                <RouteIcon className="size-4" aria-hidden />
                {t("routeHere")}
              </Link>
            </div>
          </div>
        )}
      </div>

      {status === "ready" && missing > 0 && withCoords.length > 0 && (
        <p className="mt-3 text-center text-xs text-ink-500">{t("missingCoords", { count: missing })}</p>
      )}
    </div>
  );
}
