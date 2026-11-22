// Run: npm test   (Node 22+, no dependencies: it loads the TypeScript sources directly)
import assert from "node:assert/strict";
import test from "node:test";
import { formatLatLng, haversineKm, isPlausibleRoute, isValidLatLng, parseLatLng } from "../src/lib/map/coords.ts";
import { decodePolyline, encodePolyline } from "../src/lib/map/polyline.ts";

test("isValidLatLng", () => {
  assert.equal(isValidLatLng(39.29, 44.43), true);
  for (const [a, b] of [[0, 0], [91, 0], [0, 181], [NaN, 1], [1, Infinity], ["39", "44"], [null, 4], [undefined, undefined]]) {
    assert.equal(isValidLatLng(a, b), false, `${a},${b}`);
  }
});

test("parseLatLng", () => {
  assert.deepEqual(parseLatLng("39.29,44.43"), { lat: 39.29, lng: 44.43 });
  assert.deepEqual(parseLatLng(" 39.29 , 44.43 "), { lat: 39.29, lng: 44.43 });
  for (const bad of ["", null, undefined, "39.29", "a,b", "1,2,3", "95,10", ",", "0,0"]) assert.equal(parseLatLng(bad), null, String(bad));
  assert.equal(formatLatLng({ lat: 39.294170001, lng: 44.4972 }), "39.29417,44.49720");
});

test("haversineKm: Maku to Bazargan is roughly 20 km", () => {
  const km = haversineKm({ lat: 39.29417, lng: 44.49722 }, { lat: 39.38972, lng: 44.38917 });
  assert.ok(km > 12 && km < 18, String(km));
});

test("polyline: the documented reference example decodes correctly", () => {
  // Reference sample from the polyline algorithm documentation.
  const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.deepEqual(pts, [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }]);
});

test("polyline: encode then decode returns the same points", () => {
  const line = [{ lat: 39.29417, lng: 44.49722 }, { lat: 39.3, lng: 44.45 }, { lat: 39.38972, lng: 44.38917 }];
  const back = decodePolyline(encodePolyline(line));
  assert.equal(back.length, 3);
  back.forEach((p, i) => {
    assert.ok(Math.abs(p.lat - line[i].lat) < 1e-5 && Math.abs(p.lng - line[i].lng) < 1e-5);
  });
});

test("polyline: garbage and empty input give an empty list, never a throw", () => {
  assert.deepEqual(decodePolyline(""), []);
  assert.deepEqual(decodePolyline("   "), []);
  assert.deepEqual(decodePolyline("_p~iF"), []); // truncated pair
  assert.deepEqual(decodePolyline(/** @type {any} */ (undefined)), []);
});

test("isPlausibleRoute accepts a line that fits the endpoints and rejects the rest", () => {
  const o = { lat: 39.29417, lng: 44.49722 };
  const d = { lat: 39.38972, lng: 44.38917 };
  const good = [{ lat: 39.2942, lng: 44.4972 }, { lat: 39.34, lng: 44.44 }, { lat: 39.3897, lng: 44.3892 }];
  assert.equal(isPlausibleRoute(good, o, d), true);
  assert.equal(isPlausibleRoute(good.slice(0, 1), o, d), false); // a single point is not a line
  assert.equal(isPlausibleRoute([{ lat: 10, lng: 10 }, { lat: 11, lng: 11 }], o, d), false); // far from both ends
  assert.equal(isPlausibleRoute([...good.slice(0, 2), { lat: NaN, lng: 1 }], o, d), false);
  assert.equal(isPlausibleRoute(good, d, o), false); // reversed direction does not match
});
