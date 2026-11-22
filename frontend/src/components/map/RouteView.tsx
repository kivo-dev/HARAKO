"use client";

import { LocateFixed, RefreshCw, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { fetchPlace, fetchRoute, searchExternal, type RouteResult, type SearchResult } from "@/lib/api/client";
import { apiEnabled } from "@/lib/api/config";
import { ApiError, isAbort } from "@/lib/api/errors";
import { DEFAULT_CENTER } from "@/lib/map/config";
import { isPlausibleRoute, isValidLatLng, type LatLng } from "@/lib/map/coords";
import { decodePolyline } from "@/lib/map/polyline";
import { MapCanvas } from "./MapCanvas";
import type { MapMarker } from "./MapLibreMap";

type Origin =
  | { state: "idle" }
  | { state: "locating" }
  | { state: "ok"; point: LatLng }
  | { state: "error"; reason: "denied" | "unavailable" | "timeout" | "unsupported" | "invalid" };
type Search =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; results: SearchResult[] }
  | { state: "error"; error: ApiError };
type RouteState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; route: RouteResult; line: LatLng[] | null; lineProblem: "none" | "missing" | "implausible" }
  | { state: "error"; error: ApiError };

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function errorKey(e: ApiError, kind: "route" | "search"): string {
  if (e.kind === "http") {
    if (e.status === 503) return kind === "route" ? "errNotConfigured" : "errSearchNotConfigured";
    if (e.status === 502) return kind === "route" ? "errProvider" : "errSearchProvider";
    if (e.status === 429) return "errRate";
    if (e.status === 404) return "errPlace";
    if (e.status === 422) return "errBadInput";
  }
  return e.kind === "timeout" || e.kind === "network" ? "errNetwork" : "errGeneric";
}

/**
 * Real route by car from the user's position to a destination.
 *  - The destination is ALWAYS a result of the provider's Search API that the user picked. Nothing is chosen
 *    automatically and no coordinate from HARAKO's own database is used for routing.
 *  - Opening it from a HARAKO place (?to=<id>) only prefills the search box with that place's name; the user
 *    still picks the matching result.
 *  - The route is computed by the backend with the routing provider; only the points it returned are drawn.
 *    A missing or implausible line is never replaced by a straight line.
 *  - Without internet, search and routing are switched off with a clear message (no offline routing exists).
 */
export function RouteView() {
  const t = useTranslations("Route");
  const toId = useSearchParams().get("to") ?? "";
  const online = useOnline();

  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search>({ state: "idle" });
  const [chosen, setChosen] = useState<SearchResult | null>(null);
  const [origin, setOrigin] = useState<Origin>({ state: "idle" });
  const [route, setRoute] = useState<RouteState>({ state: "idle" });
  const [reload, setReload] = useState(0);
  const searchCtl = useRef<AbortController | null>(null);
  const searchId = useRef(0);
  const routeId = useRef(0);

  const originPoint = origin.state === "ok" ? origin.point : null;

  const runSearch = useCallback(async (text: string, near: LatLng) => {
    const q = text.trim();
    searchCtl.current?.abort();
    if (q.length < 2) {
      setSearch({ state: "idle" });
      return;
    }
    const id = ++searchId.current;
    const ctrl = new AbortController();
    searchCtl.current = ctrl;
    setSearch({ state: "loading" });
    setChosen(null);
    try {
      const results = await searchExternal({ q, near, signal: ctrl.signal });
      if (id === searchId.current) setSearch({ state: "ok", results });
    } catch (e) {
      if (isAbort(e) || id !== searchId.current) return;
      setSearch({ state: "error", error: e instanceof ApiError ? e : new ApiError("network") });
    }
  }, []);

  // Opened from a HARAKO place: use its NAME to search. The place's own coordinates are not used.
  useEffect(() => {
    if (!toId || !apiEnabled) return;
    const ctrl = new AbortController();
    fetchPlace(toId, ctrl.signal)
      .then((p) => {
        if (!p) return;
        const text = [p.name.fa || p.name.en, p.area.fa].filter(Boolean).join(" ");
        setQuery(text);
        runSearch(text, DEFAULT_CENTER);
      })
      .catch(() => {
        /* the user can still type a destination */
      });
    return () => ctrl.abort();
  }, [toId, runSearch]);

  useEffect(() => () => searchCtl.current?.abort(), []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Free search is sorted around the user when known, otherwise around Maku.
    runSearch(query, originPoint ?? DEFAULT_CENTER);
  }

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setOrigin({ state: "error", reason: "unsupported" });
      return;
    }
    setOrigin({ state: "locating" });
    setRoute({ state: "idle" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        if (!isValidLatLng(lat, lng)) setOrigin({ state: "error", reason: "invalid" });
        else setOrigin({ state: "ok", point: { lat, lng } });
      },
      (err) => setOrigin({ state: "error", reason: err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }

  // Ask the backend whenever origin and the CHOSEN search result are known.
  useEffect(() => {
    if (!originPoint || !chosen || !online) {
      setRoute({ state: "idle" });
      return;
    }
    const id = ++routeId.current;
    const ctrl = new AbortController();
    const dest = { lat: chosen.lat, lng: chosen.lng };
    setRoute({ state: "loading" });
    fetchRoute({ from: originPoint, to: dest, signal: ctrl.signal })
      .then((r) => {
        if (id !== routeId.current) return;
        let line: LatLng[] | null = null;
        let lineProblem: "none" | "missing" | "implausible" = "none";
        if (!r.geometry) lineProblem = "missing";
        else {
          const pts = decodePolyline(r.geometry);
          if (isPlausibleRoute(pts, originPoint, dest)) line = pts;
          else lineProblem = "implausible";
        }
        setRoute({ state: "ok", route: r, line, lineProblem });
      })
      .catch((e: unknown) => {
        if (isAbort(e) || id !== routeId.current) return;
        setRoute({ state: "error", error: e instanceof ApiError ? e : new ApiError("network") });
      });
    return () => ctrl.abort();
  }, [originPoint, chosen, online, reload]);

  const results = search.state === "ok" ? search.results : [];
  const markers: MapMarker[] = useMemo(() => {
    const list: MapMarker[] = [];
    if (originPoint) list.push({ id: "origin", ...originPoint, title: t("you"), kind: "user" });
    if (chosen) list.push({ id: "dest", lat: chosen.lat, lng: chosen.lng, title: chosen.label, kind: "destination" });
    else results.forEach((r, i) => list.push({ id: `r${i}`, lat: r.lat, lng: r.lng, title: r.label, kind: "place" }));
    return list;
  }, [originPoint, chosen, results, t]);

  const onMapSelect = useCallback(
    (id: string) => {
      const i = Number(id.slice(1));
      if (id.startsWith("r") && results[i]) setChosen(results[i]);
    },
    [results],
  );

  const line = route.state === "ok" ? route.line : null;
  const minutes = route.state === "ok" ? Math.max(1, Math.round(route.route.durationS / 60)) : 0;
  const km = route.state === "ok" ? route.route.distanceM / 1000 : 0;
  const disabled = !online || !apiEnabled;

  return (
    <div className="px-5 md:px-10">
      <h1 className="font-display text-3xl leading-[1.4] text-forest-950 md:text-4xl">{t("title")}</h1>
      <p className="mt-1 text-sm text-ink-500">{t("carOnly")}</p>

      {!online && (
        <p role="alert" className="mt-3 rounded-2xl bg-white px-4 py-3 text-sm text-ink-700 shadow-soft">
          {t("offline")}
        </p>
      )}
      {online && !apiEnabled && (
        <p role="alert" className="mt-3 rounded-2xl bg-white px-4 py-3 text-sm text-ink-700 shadow-soft">
          {t("noBackend")}
        </p>
      )}

      <div className="mt-4 rounded-4xl bg-white p-4 shadow-soft md:p-5">
        <form role="search" onSubmit={onSubmit}>
          <label htmlFor="route-q" className="text-sm font-medium">
            {t("destination")}
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="route-q"
              type="search"
              value={query}
              disabled={disabled}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-12 min-w-0 flex-1 rounded-2xl bg-mist-100 px-4 text-base outline-none focus:ring-2 focus:ring-lime-500"
            />
            <button
              type="submit"
              disabled={disabled || search.state === "loading"}
              aria-label={t("searchButton")}
              className="inline-flex h-12 shrink-0 items-center gap-2 rounded-full bg-forest-950 px-5 text-sm font-medium text-white disabled:opacity-50"
            >
              <Search className="size-4" aria-hidden />
              {t("searchButton")}
            </button>
          </div>
        </form>

        {search.state === "loading" && (
          <p className="mt-3 text-sm text-ink-500" role="status">
            {t("searching")}
          </p>
        )}
        {search.state === "error" && (
          <div className="mt-3 flex flex-wrap items-center gap-3" role="alert">
            <p className="text-sm">{t(errorKey(search.error, "search"))}</p>
            <button
              type="button"
              onClick={() => runSearch(query, originPoint ?? DEFAULT_CENTER)}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-lime-400 px-5 text-sm font-semibold text-forest-950"
            >
              <RefreshCw className="size-4" aria-hidden />
              {t("retry")}
            </button>
          </div>
        )}
        {search.state === "ok" && results.length === 0 && (
          <div className="mt-3" role="status">
            <p className="text-sm font-semibold">{t("noResults")}</p>
            <p className="text-sm text-ink-500">{t("noResultsHint")}</p>
          </div>
        )}

        {chosen ? (
          <div className="mt-3 rounded-2xl bg-lime-300/40 p-3" role="status">
            <p className="text-xs text-ink-700">{t("chosen")}</p>
            <p className="font-semibold">{chosen.label}</p>
            {(chosen.address || chosen.region) && <p className="text-sm text-ink-700">{[chosen.address, chosen.region].filter(Boolean).join("، ")}</p>}
            <button type="button" onClick={() => setChosen(null)} className="mt-2 h-10 rounded-full bg-white px-5 text-sm font-medium">
              {t("change")}
            </button>
          </div>
        ) : (
          results.length > 0 && (
            <div className="mt-3">
              <p className="text-sm text-ink-700">{results.length > 1 ? t("pickResult") : t("confirmResult")}</p>
              <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                {results.map((r, i) => (
                  <li key={`${r.lat},${r.lng},${i}`}>
                    <button type="button" onClick={() => setChosen(r)} className="w-full rounded-2xl bg-mist-100 px-4 py-3 text-start transition hover:bg-mist-50">
                      <span className="block font-medium">{r.label}</span>
                      <span className="block text-sm text-ink-500">{[r.address, r.neighbourhood, r.region, r.kind].filter(Boolean).join("، ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        )}

        <button
          type="button"
          onClick={locate}
          disabled={origin.state === "locating" || disabled}
          className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-forest-950 px-6 font-medium text-white transition hover:bg-forest-800 disabled:opacity-50"
        >
          <LocateFixed className="size-5" aria-hidden />
          {origin.state === "locating" ? t("locating") : t("useMyLocation")}
        </button>
        {!chosen && originPoint && <p className="mt-2 text-xs text-ink-500">{t("pickFirst")}</p>}
        {origin.state === "error" && (
          <p className="mt-3 text-sm text-ink-700" role="alert">
            {t(`geo.${origin.reason}`)}
          </p>
        )}
      </div>

      <div className="relative isolate z-0 mt-4 h-[50dvh] overflow-hidden rounded-4xl bg-white shadow-soft md:h-[60dvh]">
        <MapCanvas markers={markers} line={line} label={t("mapLabel")} onSelect={onMapSelect} />
        {route.state === "loading" && (
          <div className="absolute inset-0 z-[5] flex items-center justify-center bg-white/70 text-sm" role="status">
            {t("calculating")}
          </div>
        )}
      </div>

      {route.state === "ok" && (
        <div className="mt-4 rounded-4xl bg-white p-5 shadow-soft" role="status">
          <div className="flex gap-8">
            <div>
              <p className="text-xs text-ink-500">{t("distance")}</p>
              <p className="text-2xl font-semibold">{t("km", { km: Math.round(km * 10) / 10 })}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">{t("duration")}</p>
              <p className="text-2xl font-semibold">
                {minutes >= 60 ? t("hoursMinutes", { hours: Math.floor(minutes / 60), minutes: minutes % 60 }) : t("minutes", { minutes })}
              </p>
            </div>
          </div>
          {route.lineProblem === "missing" && <p className="mt-3 text-sm text-ink-700">{t("noLine")}</p>}
          {route.lineProblem === "implausible" && <p className="mt-3 text-sm text-ink-700">{t("badLine")}</p>}
          {route.route.provider && <p className="mt-3 text-xs text-ink-500">{t("provider", { provider: route.route.provider })}</p>}
        </div>
      )}
      {route.state === "error" && (
        <div className="mt-4 rounded-4xl bg-white p-5 shadow-soft" role="alert">
          <p className="font-semibold">{t(errorKey(route.error, "route"))}</p>
          <button type="button" onClick={() => setReload((k) => k + 1)} className="mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-lime-400 px-5 text-sm font-semibold text-forest-950">
            <RefreshCw className="size-4" aria-hidden />
            {t("retry")}
          </button>
        </div>
      )}
    </div>
  );
}
