/** Encoded-polyline decoding (pure, no imports).
 *
 *  The backend returns the route geometry exactly as the routing provider sent it ("encoded polyline").
 *  The backend itself still marks the encoding as UNVERIFIED, so this module never trusts it blindly:
 *  `isPlausibleRoute` (in coords.ts) checks the decoded line against the real start and end points, and the UI draws
 *  nothing (it never draws a straight line) when the check fails. */
import type { LatLng } from "./coords";

/** Standard "Google" polyline algorithm. precision 5 = 1e-5 degrees. Returns [] for empty/garbled input. */
export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  if (typeof encoded !== "string" || encoded.length === 0) return [];
  const factor = 10 ** precision;
  const out: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const readValue = (): number | null => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) return null; // truncated
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) return null; // not a polyline character
      result += (byte & 0x1f) * 2 ** shift; // 2**shift instead of << keeps big values safe
      shift += 5;
    } while (byte >= 0x20);
    return result % 2 === 1 ? -(result + 1) / 2 : result / 2;
  };
  while (index < encoded.length) {
    const dLat = readValue();
    const dLng = readValue();
    if (dLat === null || dLng === null) return [];
    lat += dLat;
    lng += dLng;
    out.push({ lat: lat / factor, lng: lng / factor });
  }
  return out;
}

/** Test helper / reference encoder (same algorithm), so the decoder can be verified both ways. */
export function encodePolyline(points: LatLng[], precision = 5): string {
  const factor = 10 ** precision;
  let prevLat = 0;
  let prevLng = 0;
  let out = "";
  const write = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * factor);
    const lng = Math.round(p.lng * factor);
    write(lat - prevLat);
    write(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}
