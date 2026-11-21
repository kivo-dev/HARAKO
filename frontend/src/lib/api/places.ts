import { sampleOpportunities, type Opportunity } from "@/lib/opportunities";
import { categoryKeys, defaultCategories, samplePlaces, type Category, type CategoryKey, type Place } from "@/lib/places";
import { API_BASE, ALLOW_SAMPLES_ON_FAILURE } from "./config";
import { ApiError } from "./errors";
import { extractList, isObj, localized, normalizeOpportunity, normalizePlace } from "./normalize";

/**
 * SERVER side data layer (server components). The result says where the data came from, so a screen can
 * tell "the backend is down" from "there is nothing here":
 *   ok      real data from the backend (may legitimately be empty)
 *   sample  no backend configured (or dev flag): built-in prototype data, must be labelled as such
 *   error   the backend is configured but the call failed. Never replaced by samples.
 */
export type Loaded<T> =
  | { status: "ok"; data: T }
  | { status: "sample"; data: T }
  | { status: "error"; data: T; error: ApiError };

const TIMEOUT_MS = 6000;

async function request(path: string): Promise<unknown> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, TIMEOUT_MS);
  try {
    // no-store: an admin edit must show up on the next page view, not five minutes later.
    const res = await fetch(`${API_BASE}${path}`, { cache: "no-store", signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new ApiError("http", res.status);
    try {
      return await res.json();
    } catch {
      throw new ApiError("bad");
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(timedOut ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}

function fail<T>(e: unknown, empty: T, sample: T): Loaded<T> {
  const error = e instanceof ApiError ? e : new ApiError("network");
  if (ALLOW_SAMPLES_ON_FAILURE) return { status: "sample", data: sample };
  return { status: "error", data: empty, error };
}

export async function getPlacesResult(): Promise<Loaded<Place[]>> {
  if (!API_BASE) return { status: "sample", data: samplePlaces };
  try {
    const list = extractList(await request("/places?limit=200")) ?? [];
    return { status: "ok", data: list.map(normalizePlace).filter((p): p is Place => p !== null) };
  } catch (e) {
    return fail(e, [], samplePlaces);
  }
}

/** Kept for callers that only need the list. */
export async function getPlaces(): Promise<Place[]> {
  return (await getPlacesResult()).data;
}

/** "notfound" = the backend answered 404 (a real "no such place"); "error" = could not find out. */
export type PlaceResult =
  | { status: "ok" | "sample"; place: Place }
  | { status: "notfound" }
  | { status: "error"; error: ApiError };

export async function getPlaceResult(id: string): Promise<PlaceResult> {
  if (!API_BASE) {
    const place = samplePlaces.find((p) => p.id === id);
    return place ? { status: "sample", place } : { status: "notfound" };
  }
  try {
    const json = await request(`/places/${encodeURIComponent(id)}`);
    const place = normalizePlace(isObj(json) && isObj(json.data) ? json.data : json);
    return place ? { status: "ok", place } : { status: "notfound" };
  } catch (e) {
    if (e instanceof ApiError && e.kind === "http" && e.status === 404) return { status: "notfound" };
    if (ALLOW_SAMPLES_ON_FAILURE) {
      const place = samplePlaces.find((p) => p.id === id);
      if (place) return { status: "sample", place };
    }
    return { status: "error", error: e instanceof ApiError ? e : new ApiError("network") };
  }
}

export async function getPlace(id: string): Promise<Place | null> {
  const r = await getPlaceResult(id);
  return r.status === "ok" || r.status === "sample" ? r.place : null;
}

export async function getOpportunitiesResult(): Promise<Loaded<Opportunity[]>> {
  if (!API_BASE) return { status: "sample", data: sampleOpportunities };
  try {
    const list = extractList(await request("/opportunities")) ?? [];
    return { status: "ok", data: list.map(normalizeOpportunity).filter((o): o is Opportunity => o !== null) };
  } catch (e) {
    return fail(e, [], sampleOpportunities);
  }
}

export async function getCategories(): Promise<Category[]> {
  if (!API_BASE) return defaultCategories;
  try {
    const list = extractList(await request("/categories")) ?? [];
    const categories = list
      .filter(isObj)
      .map((row) => {
        const title = localized(row.title);
        const rawKey = String(row.key ?? "");
        const key = (categoryKeys as readonly string[]).includes(rawKey) ? (rawKey as CategoryKey) : null;
        return title && key ? { key, title } : null;
      })
      .filter((item): item is Category => item !== null);
    return categories.length ? categories : defaultCategories;
  } catch {
    // The five categories are fixed by the product, so the built-in list is always correct here.
    return defaultCategories;
  }
}
