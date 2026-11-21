/** Pure coordinate helpers (no imports, so they can be unit-tested with plain Node). */
export type LatLng = { lat: number; lng: number };

/** True only for two real numbers inside the valid ranges. (0,0) is treated as "missing": it is the
 *  classic value of a failed or empty GPS/geocoder result and is never inside HARAKO's region. */
export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

/** "39.29,44.43" -> {lat, lng}; anything else -> null. Used for ?from= and ?to= query parameters. */
export function parseLatLng(value: string | null | undefined): LatLng | null {
  if (!value) return null;
  const parts = value.split(",");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0].trim());
  const lng = Number(parts[1].trim());
  return parts[0].trim() !== "" && parts[1].trim() !== "" && isValidLatLng(lat, lng) ? { lat, lng } : null;
}

export function formatLatLng(p: LatLng): string {
  return `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}

/** The line is believable when every point is a valid coordinate and it starts near the origin and ends
 *  near the destination. Roads are snapped, so a few km of tolerance is normal. */
export function isPlausibleRoute(points: LatLng[], origin: LatLng, destination: LatLng, toleranceKm = 5): boolean {
  if (points.length < 2) return false;
  if (!points.every((p) => isValidLatLng(p.lat, p.lng))) return false;
  return haversineKm(points[0], origin) <= toleranceKm && haversineKm(points[points.length - 1], destination) <= toleranceKm;
}
