"""OSM GeoJSON -> osm_review.csv (a REVIEW file: nothing here is final, verified data).

Run from anywhere:   python database/create_review.py [input.geojson] [output.csv]

What changed compared with the first version (see tests/test_create_review.py):
  * Classification order fixed. Accommodation and food rules run FIRST, so a hotel that also has a
    `tourism` or `historic` tag is no longer filed as a tourist attraction. A bare `tourism=*` tag is not
    enough to be an attraction any more; only real attraction values are.
  * Objects that match no rule are left UNCLASSIFIED (empty category + review flag) instead of being
    silently filed under "public services".
  * Polygon/line coordinates use an area-weighted centroid, and when that centroid falls outside the
    polygon (L-shaped or curved shapes) a point guaranteed to be inside is used. Such coordinates are
    marked approximate. Missing coordinates stay missing; nothing is invented.
  * `review_flags` lists things a human must check (unnamed, approximate coordinates, outside the
    expected Iran box, possible lat/lng swap, unclassified).
Existing columns keep their names and order; the new columns are appended at the end.
"""
import csv
import json
import sys
from pathlib import Path
from typing import Any, Optional

HERE = Path(__file__).resolve().parent

# Approved top-level categories: key -> Persian label (exact wording approved by the project owner).
CATEGORY_LABELS = {
    "attractions": "جاذبه‌های گردشگری",
    "accommodation_food": "اقامت و پذیرایی",
    "transport": "حمل‌ونقل",
    "public_services": "خدمات عمومی",
    "nature_adventure": "طبیعت و ماجراجویی",
}

# Rough bounding box of Iran. Used ONLY to raise a review flag, never to drop or change a record.
IRAN_BBOX = (24.0, 40.0, 43.5, 63.5)  # min_lat, max_lat, min_lng, max_lng

ACCOMMODATION_TOURISM = {"hotel", "motel", "hostel", "guest_house", "apartment", "chalet", "resort"}
ACCOMMODATION_BUILDING = {"hotel"}
FOOD_AMENITY = {"restaurant", "cafe", "fast_food", "food_court", "ice_cream", "bar", "pub", "biergarten"}
TRANSPORT_AMENITY = {"bus_station", "taxi", "parking", "ferry_terminal", "car_rental", "bicycle_rental", "bus_stop"}
TRANSPORT_HIGHWAY = {"bus_stop", "rest_area", "services"}
TRANSPORT_RAILWAY = {"station", "halt", "tram_stop"}
TRANSPORT_AEROWAY = {"aerodrome", "terminal", "helipad"}
PUBLIC_AMENITY = {
    "hospital", "clinic", "doctors", "dentist", "pharmacy", "police", "fire_station", "bank", "atm",
    "toilets", "fuel", "post_office", "townhall", "courthouse", "school", "university", "college",
    "kindergarten", "library", "marketplace", "community_centre", "bureau_de_change", "drinking_water",
}
NATURE_NATURAL = {
    "peak", "spring", "wetland", "water", "cave_entrance", "waterfall", "valley", "ridge", "volcano",
    "hot_spring", "glacier", "cliff", "beach", "bare_rock", "saddle",
}
NATURE_LEISURE = {"nature_reserve", "park", "camp_site", "garden", "picnic_table", "fishing", "hiking"}
NATURE_TOURISM = {"camp_site", "caravan_site", "picnic_site", "viewpoint", "wilderness_hut", "alpine_hut"}
ATTRACTION_TOURISM = {"attraction", "museum", "gallery", "artwork", "zoo", "theme_park", "aquarium"}
PUBLIC_TOURISM = {"information"}


def classify(tags: dict[str, Any]) -> tuple[Optional[str], str]:
    """-> (category key or None, rule that matched). Order matters: specific facility types first,
    broad tags (`tourism`, `historic`) LAST."""
    tourism = tags.get("tourism") or ""
    amenity = tags.get("amenity") or ""
    leisure = tags.get("leisure") or ""

    # 1. accommodation (before anything that mentions tourism/historic)
    if tourism in ACCOMMODATION_TOURISM or tags.get("building") in ACCOMMODATION_BUILDING or leisure == "resort":
        return "accommodation_food", f"tourism={tourism or tags.get('building') or leisure}"
    # 2. food and drink
    if amenity in FOOD_AMENITY:
        return "accommodation_food", f"amenity={amenity}"
    # 3. transport
    if amenity in TRANSPORT_AMENITY or tags.get("highway") in TRANSPORT_HIGHWAY or tags.get("public_transport"):
        return "transport", "transport tag"
    if tags.get("railway") in TRANSPORT_RAILWAY or tags.get("aeroway") in TRANSPORT_AEROWAY:
        return "transport", "railway/aeroway tag"
    # 4. public facilities
    if amenity in PUBLIC_AMENITY or tags.get("shop") or tags.get("office") or tags.get("healthcare"):
        return "public_services", f"amenity/shop={amenity or tags.get('shop') or tags.get('office')}"
    # 5. nature and adventure (an attraction that is a natural feature is nature, so this precedes 6)
    if tags.get("natural") in NATURE_NATURAL or leisure in NATURE_LEISURE or tourism in NATURE_TOURISM:
        return "nature_adventure", "natural/leisure/tourism nature tag"
    # 6. real attractions and historic sites
    if tourism in ATTRACTION_TOURISM:
        return "attractions", f"tourism={tourism}"
    if tags.get("historic"):
        return "attractions", f"historic={tags['historic']}"
    if amenity == "place_of_worship" and (tags.get("heritage") or tags.get("wikidata")):
        return "attractions", "listed place of worship"
    if tourism in PUBLIC_TOURISM:
        return "public_services", f"tourism={tourism}"
    if amenity == "place_of_worship":
        return "public_services", "place_of_worship"
    return None, "no rule matched"


# ---------------------------------------------------------------- geometry (pure Python)
Ring = list[tuple[float, float]]  # (lon, lat)


def _ring_area_centroid(ring: Ring) -> tuple[float, float, float]:
    """Signed area and centroid of a closed ring (shoelace). Relative to the first vertex for accuracy."""
    x0, y0 = ring[0]
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        x1, y1, x2, y2 = x1 - x0, y1 - y0, x2 - x0, y2 - y0
        cross = x1 * y2 - x2 * y1
        a += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    a /= 2.0
    if abs(a) < 1e-18:
        return 0.0, x0, y0
    return a, x0 + cx / (6.0 * a), y0 + cy / (6.0 * a)


def _inside(ring: Ring, x: float, y: float) -> bool:
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def _in_polygon(rings: list[Ring], x: float, y: float) -> bool:
    return _inside(rings[0], x, y) and not any(_inside(h, x, y) for h in rings[1:])


def _point_on_surface(rings: list[Ring]) -> Optional[tuple[float, float]]:
    """A point guaranteed to be inside the polygon: scan lines at several heights, take the middle of
    the widest inside interval."""
    ys = [p[1] for p in rings[0]]
    lo, hi = min(ys), max(ys)
    best: Optional[tuple[float, float, float]] = None  # width, x, y
    for i in range(1, 20):
        y = lo + (hi - lo) * i / 20.0
        xs: list[float] = []
        for ring in rings:
            for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
                if (y1 > y) != (y2 > y):
                    xs.append((x2 - x1) * (y - y1) / (y2 - y1) + x1)
        xs.sort()
        for a, b in zip(xs[0::2], xs[1::2]):
            mid = (a + b) / 2.0
            if b - a > (best[0] if best else 0) and _in_polygon(rings, mid, y):
                best = (b - a, mid, y)
    return (best[1], best[2]) if best else None


def _line_midpoint(line: Ring) -> tuple[float, float]:
    segs = [((x1, y1), (x2, y2), ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5) for (x1, y1), (x2, y2) in zip(line, line[1:])]
    total = sum(s[2] for s in segs)
    if total == 0:
        return line[0]
    half = total / 2.0
    for (x1, y1), (x2, y2), length in segs:
        if half <= length and length > 0:
            t = half / length
            return x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
        half -= length
    return line[-1]


def _pair(v: Any) -> Optional[tuple[float, float]]:
    if isinstance(v, (list, tuple)) and len(v) >= 2 and all(isinstance(n, (int, float)) and not isinstance(n, bool) for n in v[:2]):
        return float(v[0]), float(v[1])
    return None


def _ring(v: Any) -> Ring:
    return [p for p in (_pair(i) for i in (v or [])) if p is not None]


def geometry_point(geometry: Optional[dict]) -> tuple[Optional[float], Optional[float], str]:
    """GeoJSON geometry -> (lat, lon, method). Methods: point, polygon_centroid, polygon_point_on_surface,
    line_midpoint, multi_largest_polygon (suffix of the two polygon methods), missing, invalid.
    Anything but `point` is an APPROXIMATION and must be verified by a human."""
    if not geometry or not isinstance(geometry, dict):
        return None, None, "missing"
    gtype, coords = geometry.get("type"), geometry.get("coordinates")
    try:
        if gtype == "Point":
            p = _pair(coords)
            return (p[1], p[0], "point") if p else (None, None, "invalid")
        if gtype == "LineString":
            line = _ring(coords)
            if len(line) < 2:
                return (line[0][1], line[0][0], "point") if line else (None, None, "missing")
            x, y = _line_midpoint(line)
            return y, x, "line_midpoint"
        if gtype in ("Polygon", "MultiPolygon"):
            polys = [coords] if gtype == "Polygon" else list(coords or [])
            polys = [[_ring(r) for r in poly if len(_ring(r)) >= 3] for poly in polys]
            polys = [p for p in polys if p]
            if not polys:
                return None, None, "missing"
            # the largest polygon (by outer-ring area) represents a multipolygon
            poly = max(polys, key=lambda p: abs(_ring_area_centroid(p[0])[0]))
            area, cx, cy = _ring_area_centroid(poly[0])
            suffix = "" if gtype == "Polygon" else "_of_largest_part"
            if area != 0 and _in_polygon(poly, cx, cy):
                return cy, cx, "polygon_centroid" + suffix
            pt = _point_on_surface(poly)
            if pt:
                return pt[1], pt[0], "polygon_point_on_surface" + suffix
            return None, None, "invalid"
    except (TypeError, ValueError, ZeroDivisionError):
        return None, None, "invalid"
    return None, None, "unsupported"


def coordinate_flags(lat: Optional[float], lon: Optional[float]) -> list[str]:
    if lat is None or lon is None:
        return ["no_coordinates"]
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return ["coordinates_out_of_range"]
    min_lat, max_lat, min_lng, max_lng = IRAN_BBOX
    if min_lat <= lat <= max_lat and min_lng <= lon <= max_lng:
        return []
    if min_lat <= lon <= max_lat and min_lng <= lat <= max_lng:
        return ["possible_lat_lng_swap"]
    return ["outside_expected_region"]


# ---------------------------------------------------------------- CSV
FIELDS = [
    "osm_id", "name", "category", "latitude", "longitude", "coordinate_method",
    "amenity", "tourism", "shop", "historic", "natural", "leisure",
    # appended in v0.3 of this script:
    "category_key", "classification_rule", "coordinate_approximate", "review_flags",
]


def build_rows(data: dict) -> list[dict[str, Any]]:
    rows = []
    for feature in data.get("features", []):
        tags = feature.get("properties") or {}
        osm_id = tags.get("@id", feature.get("id", ""))
        name = tags.get("name") or tags.get("name:fa") or tags.get("name:en") or ""
        lat, lon, method = geometry_point(feature.get("geometry"))
        key, rule = classify(tags)
        flags = coordinate_flags(lat, lon)
        if not name:
            flags.append("unnamed")
        if key is None:
            flags.append("unclassified")
        approximate = method not in ("point",)
        if approximate and lat is not None:
            flags.append("approximate_coordinates")
        rows.append({
            "osm_id": osm_id, "name": name,
            "category": CATEGORY_LABELS.get(key, ""),
            "latitude": lat, "longitude": lon, "coordinate_method": method,
            "amenity": tags.get("amenity", ""), "tourism": tags.get("tourism", ""), "shop": tags.get("shop", ""),
            "historic": tags.get("historic", ""), "natural": tags.get("natural", ""), "leisure": tags.get("leisure", ""),
            "category_key": key or "", "classification_rule": rule,
            "coordinate_approximate": "yes" if approximate else "no",
            "review_flags": ";".join(flags),
        })
    return rows


def main(argv: list[str]) -> int:
    source = Path(argv[1]) if len(argv) > 1 else HERE / "osm_raw.geojson"
    output = Path(argv[2]) if len(argv) > 2 else HERE / "osm_review.csv"
    with source.open("r", encoding="utf-8") as f:
        data = json.load(f)
    rows = build_rows(data)
    with output.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Done! {len(rows)} records exported to {output}")
    print(f"Named records: {sum(bool(r['name']) for r in rows)}")
    print(f"Missing coordinates: {sum(r['latitude'] is None for r in rows)}")
    print(f"Unclassified (needs human review): {sum(r['category_key'] == '' for r in rows)}")
    print(f"Approximate coordinates (polygon/line): {sum(r['coordinate_approximate'] == 'yes' for r in rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
