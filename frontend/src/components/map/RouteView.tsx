"use client";

import { LocateFixed, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { fetchAllPlaces, fetchRoute, type RouteResult } from "@/lib/api/client";
import { apiEnabled } from "@/lib/api/config";
import { ApiError, isAbort } from "@/lib/api/errors";
import { isPlausibleRoute, isValidLatLng, type LatLng } from "@/lib/map/coords";
import { decodePolyline } from "@/lib/map/polyline";
import { pick, type Place } from "@/lib/places";
import { MapCanvas } from "./MapCanvas";
import type { MapMarker } from "./LeafletMap";

type Origin = { state: "idle" } | { state: "locating" } | { state: "ok"; point: LatLng } | { state: "error"; reason: "denied" | "unavailable" | "timeout" | "unsupported" | "invalid" };
type RouteState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; route: RouteResult; line: LatLng[] | null; lineProblem: "none" | "missing" | "implausible" }
  | { state: "error"; error: ApiError };

function errorKey(e: ApiError): string {
  if (e.kind === "http") {
    if (e.status === 503) return "errNotConfigured";
    if (e.status === 502) return "errProvider";
    if (e.status === 429) return "errRate";
    if (e.status === 404) return "errPlace";
    if (e.status === 422) return "errNoCoords";
  }
  return e.kind === "timeout" || e.kind === "network" ? "errNetwork" : "errGeneric";
}

/**
 * Real route by car from the user's position to a place. The route is computed by the backend with the
 * routing provider; this screen draws only the points the provider returned. If the line is missing or
 * does not fit the origin/destination, only the numbers are shown. A straight line is never drawn.
 */
export function RouteView() {
  const t = useTranslations("Route");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const toId = useSearchParams().get("to") ?? "";

  const [places, setPlaces] = useState<Place[]>([]);
  const [placesState, setPlacesState] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [origin, setOrigin] = useState<Origin>({ state: "idle" });
  const [route, setRoute] = useState<RouteState>({ state: "idle" });
  const reqId = useRef(0);

  useEffect(() => {
    if (!apiEnabled) {
      setPlacesState("ready");
      return;
    }
    const ctrl = new AbortController();
    setPlacesState("loading");
    fetchAllPlaces(ctrl.signal)
      .then((list) => {
        setPlaces(list);
        setPlacesState("ready");
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) setPlacesState("error");
      });
    return () => ctrl.abort();
  }, [reload]);

  const routable = useMemo(() => places.filter((p) => p.coords), [places]);
  const dest = routable.find((p) => p.id === toId) ?? null;
  const destKnownButNoCoords = !dest && places.some((p) => p.id === toId);

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

  // Ask the backend whenever both ends are known.
  const originPoint = origin.state === "ok" ? origin.point : null;
  useEffect(() => {
    if (!originPoint || !dest?.coords) {
      setRoute({ state: "idle" });
      return;
    }
    const id = ++reqId.current;
    const ctrl = new AbortController();
    setRoute({ state: "loading" });
    fetchRoute({ from: originPoint, toPlace: dest.id, signal: ctrl.signal })
      .then((r) => {
        if (id !== reqId.current) return;
        let line: LatLng[] | null = null;
        let lineProblem: "none" | "missing" | "implausible" = "none";
        if (!r.geometry) lineProblem = "missing";
        else {
          const pts = decodePolyline(r.geometry);
          if (isPlausibleRoute(pts, originPoint, dest.coords!)) line = pts;
          else lineProblem = "implausible";
        }
        setRoute({ state: "ok", route: r, line, lineProblem });
      })
      .catch((e: unknown) => {
        if (isAbort(e) || id !== reqId.current) return;
        setRoute({ state: "error", error: e instanceof ApiError ? e : new ApiError("network") });
      });
    return () => ctrl.abort();
  }, [originPoint, dest, reload]);

  const markers: MapMarker[] = useMemo(() => {
    const list: MapMarker[] = [];
    if (originPoint) list.push({ id: "origin", ...originPoint, title: t("you"), kind: "user" });
    if (dest?.coords) list.push({ id: dest.id, ...dest.coords, title: pick(dest.name, locale), kind: "destination" });
    return list;
  }, [originPoint, dest, locale, t]);

  const line = route.state === "ok" ? route.line : null;
  const minutes = route.state === "ok" ? Math.max(1, Math.round(route.route.durationS / 60)) : 0;
  const km = route.state === "ok" ? route.route.distanceM / 1000 : 0;

  return (
    <div className="px-5 md:px-10">
      <h1 className="font-display text-3xl leading-[1.4] text-forest-950 md:text-4xl">{t("title")}</h1>
      <p className="mt-1 text-sm text-ink-500">{t("carOnly")}</p>

      <div className="mt-4 rounded-4xl bg-white p-4 shadow-soft md:p-5">
        <label htmlFor="route-dest" className="text-sm font-medium">
          {t("destination")}
        </label>
        <select
          id="route-dest"
          value={dest?.id ?? ""}
          disabled={placesState !== "ready" || routable.length === 0}
          onChange={(e) => router.replace(e.target.value ? { pathname, query: { to: e.target.value } } : { pathname }, { scroll: false })}
          className="mt-1.5 h-12 w-full rounded-2xl bg-mist-100 px-4 text-base"
        >
          <option value="">{t("pickDestination")}</option>
          {routable.map((p) => (
            <option key={p.id} value={p.id}>
              {pick(p.name, locale)}
            </option>
          ))}
        </select>

        {placesState === "loading" && <p className="mt-3 text-sm text-ink-500" role="status">{t("loadingPlaces")}</p>}
        {placesState === "error" && (
          <div className="mt-3 flex flex-wrap items-center gap-3" role="alert">
            <p className="text-sm">{t("errPlaces")}</p>
            <button type="button" onClick={() => setReload((k) => k + 1)} className="inline-flex h-10 items-center gap-2 rounded-full bg-lime-400 px-5 text-sm font-semibold text-forest-950">
              <RefreshCw className="size-4" aria-hidden />
              {t("retry")}
            </button>
          </div>
        )}
        {placesState === "ready" && routable.length === 0 && <p className="mt-3 text-sm text-ink-700" role="status">{t("noRoutablePlaces")}</p>}
        {destKnownButNoCoords && <p className="mt-3 text-sm text-ink-700" role="status">{t("errNoCoords")}</p>}

        <button
          type="button"
          onClick={locate}
          disabled={origin.state === "locating" || !dest}
          className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-forest-950 px-6 font-medium text-white transition hover:bg-forest-800 disabled:opacity-50"
        >
          <LocateFixed className="size-5" aria-hidden />
          {origin.state === "locating" ? t("locating") : t("useMyLocation")}
        </button>
        {!dest && placesState === "ready" && routable.length > 0 && <p className="mt-2 text-xs text-ink-500">{t("pickFirst")}</p>}
        {origin.state === "error" && (
          <p className="mt-3 text-sm text-ink-700" role="alert">
            {t(`geo.${origin.reason}`)}
          </p>
        )}
      </div>

      <div className="relative isolate z-0 mt-4 h-[50dvh] overflow-hidden rounded-4xl bg-white shadow-soft md:h-[60dvh]">
        <MapCanvas markers={markers} line={line} label={t("mapLabel")} />
        {route.state === "loading" && (
          <div className="absolute inset-0 z-[500] flex items-center justify-center bg-white/70 text-sm" role="status">
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
          <p className="font-semibold">{t(errorKey(route.error))}</p>
          <button type="button" onClick={() => setReload((k) => k + 1)} className="mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-lime-400 px-5 text-sm font-semibold text-forest-950">
            <RefreshCw className="size-4" aria-hidden />
            {t("retry")}
          </button>
        </div>
      )}
    </div>
  );
}
