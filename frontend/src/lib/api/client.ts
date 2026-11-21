import type { Opportunity } from "@/lib/opportunities";
import type { Place } from "@/lib/places";
import { API_BASE } from "./config";
import { ApiError, isAbort } from "./errors";
import { extractList, isObj, normalizeOpportunity, normalizePlace } from "./normalize";

/**
 * BROWSER side data layer: calls made while the user is using the app. Always fresh (no cache).
 * The backend must allow the app's address (CORS).
 *
 *   GET {base}/places?category=&q=&limit=&offset=   places (category = one of the five approved keys)
 *   GET {base}/places/{id}                          one place (404 -> null)
 *   GET {base}/suggestions?limit=6                  "Our suggestions" (the backend decides)
 *   GET {base}/opportunities?sector=                economic opportunities
 *   GET {base}/route?from_lat&from_lng&(to_place | to_lat&to_lng)&mode=car   real route from the routing provider
 *
 * Every function THROWS an ApiError when the call fails. Nothing here returns an empty list on failure and
 * nothing falls back to sample data: the screen decides how to show "loading", "empty" and "error".
 */
type Params = Record<string, string | number | undefined>;

const TIMEOUT_MS = 8000;

async function getJson(path: string, params: Params, signal?: AbortSignal): Promise<unknown> {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") query.set(k, String(v));
  const qs = query.toString();

  // AbortSignal.timeout()/any() are missing in older Android WebViews, so the timer is done by hand.
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const res = await fetch(`${API_BASE}${path}${qs ? `?${qs}` : ""}`, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      let code: string | undefined;
      try {
        const body: unknown = await res.json();
        const detail = isObj(body) ? body.detail : undefined;
        if (isObj(detail) && typeof detail.code === "string") code = detail.code;
      } catch {
        /* the error body is optional */
      }
      throw new ApiError("http", res.status, code);
    }
    try {
      return await res.json();
    } catch {
      throw new ApiError("bad");
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (signal?.aborted && isAbort(e)) throw e; // the caller cancelled: not an error
    if (timedOut) throw new ApiError("timeout");
    throw new ApiError("network");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

const toPlaces = (json: unknown) => (extractList(json) ?? []).map(normalizePlace).filter((p): p is Place => p !== null);
const totalOf = (json: unknown, fallback: number) => (isObj(json) && typeof json.total === "number" ? json.total : fallback);

export async function fetchPlaces(p: {
  category?: string;
  q?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<{ items: Place[]; total: number }> {
  const json = await getJson("/places", { category: p.category, q: p.q, limit: p.limit ?? 200, offset: p.offset }, p.signal);
  const items = toPlaces(json);
  return { items, total: totalOf(json, items.length) };
}

/** Every published place (pages of 200, at most 5 pages = 1000). Used by the map. */
export async function fetchAllPlaces(signal?: AbortSignal): Promise<Place[]> {
  const all: Place[] = [];
  for (let page = 0; page < 5; page++) {
    const { items, total } = await fetchPlaces({ limit: 200, offset: page * 200, signal });
    all.push(...items);
    if (all.length >= total || items.length === 0) break;
  }
  return all;
}

/** One place. null = the server says it does not exist (404). Any other failure throws. */
export async function fetchPlace(id: string, signal?: AbortSignal): Promise<Place | null> {
  try {
    const json = await getJson(`/places/${encodeURIComponent(id)}`, {}, signal);
    return normalizePlace(isObj(json) && isObj(json.data) ? json.data : json);
  } catch (e) {
    if (e instanceof ApiError && e.kind === "http" && e.status === 404) return null;
    throw e;
  }
}

export async function fetchSuggestions(p: { limit?: number; signal?: AbortSignal } = {}): Promise<Place[]> {
  return toPlaces(await getJson("/suggestions", { limit: p.limit ?? 6 }, p.signal));
}

export async function fetchOpportunities(p: { sector?: string; signal?: AbortSignal }): Promise<Opportunity[]> {
  const list = extractList(await getJson("/opportunities", { sector: p.sector }, p.signal)) ?? [];
  return list.map(normalizeOpportunity).filter((o): o is Opportunity => o !== null);
}

export type RouteResult = {
  provider: string;
  mode: string;
  distanceM: number;
  durationS: number;
  /** Encoded polyline exactly as the provider sent it, or undefined. Decode with lib/map/polyline. */
  geometry?: string;
};

/** Real route from the backend (which asks the routing provider). The destination is a place id OR a
 *  coordinate pair. Only "car" exists on the backend today. */
export async function fetchRoute(p: {
  from: { lat: number; lng: number };
  toPlace?: string;
  to?: { lat: number; lng: number };
  signal?: AbortSignal;
}): Promise<RouteResult> {
  const json = await getJson(
    "/route",
    { from_lat: p.from.lat, from_lng: p.from.lng, to_place: p.toPlace, to_lat: p.to?.lat, to_lng: p.to?.lng, mode: "car" },
    p.signal,
  );
  if (!isObj(json)) throw new ApiError("bad");
  const distance = Number(json.distance_m);
  const duration = Number(json.duration_s);
  if (!Number.isFinite(distance) || !Number.isFinite(duration)) throw new ApiError("bad");
  return {
    provider: String(json.provider ?? ""),
    mode: String(json.mode ?? "car"),
    distanceM: distance,
    durationS: duration,
    geometry: typeof json.geometry === "string" && json.geometry ? json.geometry : undefined,
  };
}
