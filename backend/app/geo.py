"""Small geographic helpers. Plain maths, no PostGIS needed for a region this size.
If "near me" ever gets heavy (thousands of places), move the distance filter into PostGIS."""
import math

EARTH_RADIUS_KM = 6371.0088


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def bounding_box(lat: float, lng: float, radius_km: float) -> tuple[float, float, float, float]:
    """(min_lat, max_lat, min_lng, max_lng): a cheap square that contains the circle.
    Used to cut the SQL query down before the exact distance is computed."""
    dlat = math.degrees(radius_km / EARTH_RADIUS_KM)
    cos_lat = max(math.cos(math.radians(lat)), 1e-6)
    dlng = math.degrees(radius_km / (EARTH_RADIUS_KM * cos_lat))
    return lat - dlat, lat + dlat, lng - dlng, lng + dlng


# Rough bounding box of Iran. HARAKO is an Iranian region, so a point outside it is almost certainly a typo,
# and a point that would be inside it only after swapping lat/lng is a reversed pair.
IRAN_BBOX = (24.0, 40.0, 43.5, 63.5)  # min_lat, max_lat, min_lng, max_lng


def coordinate_problem(lat, lng) -> "str | None":
    """None when the pair is acceptable (both empty counts as acceptable: place without coordinates yet).
    Otherwise a short message that says what to fix. Never raises, never changes the values."""
    if lat is None and lng is None:
        return None
    if lat is None or lng is None:
        return "lat and lng must be given together (عرض و طول جغرافی باید با هم وارد شوند)"
    try:
        la, lo = float(lat), float(lng)
    except (TypeError, ValueError):
        return "lat/lng must be numbers (مختصات باید عدد باشد)"
    if not (math.isfinite(la) and math.isfinite(lo)):
        return "lat/lng must be finite numbers (مختصات نامعتبر)"
    if not (-90 <= la <= 90 and -180 <= lo <= 180):
        return f"coordinates out of range: lat={la}, lng={lo} (مختصات خارج از محدودهٔ زمین)"
    min_lat, max_lat, min_lng, max_lng = IRAN_BBOX
    inside = min_lat <= la <= max_lat and min_lng <= lo <= max_lng
    swapped = min_lat <= lo <= max_lat and min_lng <= la <= max_lng
    if not inside and swapped:
        return f"lat and lng look reversed: lat={la}, lng={lo}; Maku is about lat 39.3, lng 44.5 (جای عرض و طول جابه‌جا شده است)"
    if not inside:
        return f"coordinates are outside Iran: lat={la}, lng={lo} (مختصات خارج از ایران است)"
    return None
