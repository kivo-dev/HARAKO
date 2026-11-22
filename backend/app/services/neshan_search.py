"""Neshan Search API adapter (place search). Used to find ANY destination, also ones that are not in
HARAKO's database. Results are external, unverified suggestions; nothing is stored.

Contract (official page "سرویس جستجوی مکان‌مبنای نشان", https://platform.neshan.org/api/search/):
    GET https://api.neshan.org/v1/search?term=<text>&lat=<lat>&lng=<lng>      header  Api-Key: <key>
    -> {"count": n, "items": [{"title","address","neighbourhood","region","type",
                                "category": "place|municipal|region",
                                "location": {"x": <longitude>, "y": <latitude>}}]}
    - lat and lng are REQUIRED (the reference point; results are sorted by distance from it)
    - at most 30 results per request
The page does not say which key type is required. The key stays on the server (NESHAN_SERVICE_KEY).
Status: UNVERIFIED until one real call has been compared with this contract
(`python -m app.services.neshan_check search "ماکو" 39.29,44.50`).
"""
from typing import Optional

import httpx

from ..geo import coordinate_problem
from ..providers.base import LatLng, PlaceSearchHit, ProviderDisabled, ProviderError

BASE_URL = "https://api.neshan.org"
SEARCH_PATH = "/v1/search"
# Reference point when the caller gives none: the centre of Maku (camera position, not a place record).
DEFAULT_NEAR: LatLng = (39.29417, 44.49722)
MAX_RESULTS = 30


def _text(value) -> Optional[str]:
    return value.strip() if isinstance(value, str) and value.strip() else None


def parse_items(data: object) -> list[PlaceSearchHit]:
    """Turn the raw answer into hits. A hit without a title or with impossible coordinates is dropped
    (never repaired); an answer that is not the documented shape is an error."""
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        raise ProviderError("Unexpected search response shape")
    hits: list[PlaceSearchHit] = []
    for item in data["items"][:MAX_RESULTS]:
        if not isinstance(item, dict):
            continue
        loc = item.get("location")
        title = _text(item.get("title"))
        if not title or not isinstance(loc, dict):
            continue
        lng, lat = loc.get("x"), loc.get("y")  # x = longitude, y = latitude (per the docs)
        if isinstance(lat, bool) or isinstance(lng, bool) or not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            continue
        if coordinate_problem(float(lat), float(lng)):
            continue
        hits.append(
            PlaceSearchHit(
                title=title,
                address=_text(item.get("address")) or "",
                lat=float(lat),
                lng=float(lng),
                category=_text(item.get("category")),
                provider="neshan",
                region=_text(item.get("region")),
                neighbourhood=_text(item.get("neighbourhood")),
                kind=_text(item.get("type")),
            )
        )
    return hits


class NeshanPlaceSearch:
    def __init__(self, api_key: str, timeout_s: float = 8.0):
        self._key = api_key
        self._timeout = timeout_s

    async def search(self, query: str, near: Optional[LatLng] = None) -> list[PlaceSearchHit]:
        if not self._key:
            raise ProviderDisabled("NESHAN_SERVICE_KEY is not set")
        lat, lng = near or DEFAULT_NEAR
        params = {"term": query.strip(), "lat": f"{lat}", "lng": f"{lng}"}
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                res = await client.get(BASE_URL + SEARCH_PATH, params=params, headers={"Api-Key": self._key})
        except httpx.HTTPError as exc:
            raise ProviderError("Search provider unreachable") from exc
        if res.status_code != 200:
            raise ProviderError(f"Search provider answered with status {res.status_code}")
        try:
            data = res.json()
        except ValueError as exc:
            raise ProviderError("Search provider returned invalid JSON") from exc
        return parse_items(data)
