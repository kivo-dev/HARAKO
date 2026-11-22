"""Neshan place-search adapter and /v1/geo/search. Everything is mocked: no real call to Neshan is made."""
import asyncio

import httpx
import pytest

from app.main import app
from app.providers.base import PlaceSearchHit, ProviderDisabled, ProviderError
from app.providers.registry import get_place_search_provider
from app.services import neshan_search
from app.services.neshan_search import DEFAULT_NEAR, NeshanPlaceSearch, parse_items

DOC_SAMPLE = {
    "count": 3,
    "items": [
        {"title": "مسجد جامع", "address": "خیابان امام", "neighbourhood": "مرکز", "region": "ماکو، آذربایجان غربی",
         "type": "mosque", "category": "place", "location": {"x": 44.5, "y": 39.3}},
        {"title": "بدون مختصات", "address": "", "category": "place"},
        {"title": "مختصات نامعتبر", "category": "place", "location": {"x": 4450.0, "y": 39.3}},
    ],
}


def test_parse_maps_x_to_lng_and_y_to_lat_and_drops_bad_items():
    hits = parse_items(DOC_SAMPLE)
    assert len(hits) == 1
    h = hits[0]
    assert (h.lat, h.lng) == (39.3, 44.5)
    assert h.title == "مسجد جامع" and h.kind == "mosque" and h.category == "place" and h.region.startswith("ماکو")
    assert h.provider == "neshan"


@pytest.mark.parametrize("bad", [None, [], {}, {"items": "x"}, {"count": 1}])
def test_parse_rejects_unexpected_shape(bad):
    with pytest.raises(ProviderError):
        parse_items(bad)


def test_parse_keeps_at_most_30():
    items = [{"title": f"t{i}", "location": {"x": 44.5, "y": 39.3}} for i in range(45)]
    assert len(parse_items({"items": items})) == 30


def _patched_client(monkeypatch, handler):
    real = httpx.AsyncClient

    def factory(*a, **kw):
        kw["transport"] = httpx.MockTransport(handler)
        return real(*a, **kw)

    monkeypatch.setattr(neshan_search.httpx, "AsyncClient", factory)


def test_adapter_sends_documented_request(monkeypatch):
    seen = {}

    def handler(request: httpx.Request):
        seen["url"], seen["key"] = request.url, request.headers.get("Api-Key")
        return httpx.Response(200, json=DOC_SAMPLE)

    _patched_client(monkeypatch, handler)
    hits = asyncio.run(NeshanPlaceSearch("k-123").search("مسجد", (39.0, 44.0)))
    assert len(hits) == 1
    assert seen["key"] == "k-123"
    assert seen["url"].path == "/v1/search"
    q = dict(seen["url"].params)
    assert q == {"term": "مسجد", "lat": "39.0", "lng": "44.0"}


def test_adapter_uses_maku_centre_when_no_reference_point(monkeypatch):
    seen = {}

    def handler(request: httpx.Request):
        seen.update(dict(request.url.params))
        return httpx.Response(200, json={"count": 0, "items": []})

    _patched_client(monkeypatch, handler)
    assert asyncio.run(NeshanPlaceSearch("k").search("x")) == []
    assert (float(seen["lat"]), float(seen["lng"])) == DEFAULT_NEAR


def test_adapter_without_key_is_disabled():
    with pytest.raises(ProviderDisabled):
        asyncio.run(NeshanPlaceSearch("").search("x"))


@pytest.mark.parametrize("status", [401, 403, 429, 500])
def test_adapter_error_status_is_provider_error(monkeypatch, status):
    _patched_client(monkeypatch, lambda r: httpx.Response(status, json={}))
    with pytest.raises(ProviderError):
        asyncio.run(NeshanPlaceSearch("k").search("x"))


def test_adapter_invalid_json_and_network_error(monkeypatch):
    _patched_client(monkeypatch, lambda r: httpx.Response(200, text="not json"))
    with pytest.raises(ProviderError):
        asyncio.run(NeshanPlaceSearch("k").search("x"))

    def boom(request):
        raise httpx.ConnectError("down")

    _patched_client(monkeypatch, boom)
    with pytest.raises(ProviderError):
        asyncio.run(NeshanPlaceSearch("k").search("x"))


class FakeSearch:
    def __init__(self):
        self.calls = []

    async def search(self, query, near=None):
        self.calls.append((query, near))
        return [PlaceSearchHit("مسجد جامع", "خیابان امام", 39.3, 44.5, "place", "neshan", region="ماکو", kind="mosque")]


def test_endpoint_returns_external_unverified_results(client):
    fake = FakeSearch()
    app.dependency_overrides[get_place_search_provider] = lambda: fake
    r = client.get("/v1/geo/search", params={"q": "مسجد", "lat": 39.2, "lng": 44.4})
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "neshan"
    item = body["results"][0]
    assert item["label"] == "مسجد جامع" and item["kind"] == "mosque" and item["region"] == "ماکو"
    assert item["data_source"] == "external" and item["verified"] is False
    assert fake.calls == [("مسجد", (39.2, 44.4))]


def test_endpoint_without_key_answers_503(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "neshan_service_key", "")
    r = client.get("/v1/geo/search", params={"q": "مسجد"})
    assert r.status_code == 503


def test_endpoint_validation_and_provider_failure(client):
    assert client.get("/v1/geo/search", params={"q": "a"}).status_code == 422
    assert client.get("/v1/geo/search", params={"q": "مسجد", "lat": 39.3}).status_code == 422

    class Broken:
        async def search(self, query, near=None):
            raise ProviderError("down")

    app.dependency_overrides[get_place_search_provider] = lambda: Broken()
    assert client.get("/v1/geo/search", params={"q": "مسجد"}).status_code == 502
