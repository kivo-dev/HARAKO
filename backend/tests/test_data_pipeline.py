"""Pure-Python parts of the data pipeline (no web framework needed)."""
import json
from pathlib import Path
from types import SimpleNamespace

from app.check_data import analyse
from app.constants import CATEGORY_KEYS, CATEGORY_TITLES
from app.geo import coordinate_problem
from app.import_locations import convert_location

DATA = Path(__file__).resolve().parents[2] / "database" / "harako_places_v0.2.json"


def test_category_titles_are_exactly_the_approved_persian_labels():
    assert [CATEGORY_TITLES[k]["fa"] for k in CATEGORY_KEYS] == ["جاذبه‌های گردشگری", "اقامت و پذیرایی", "حمل‌ونقل", "خدمات عمومی", "طبیعت و ماجراجویی"]


def test_importer_maps_transportation_to_transport_and_never_invents_coordinates():
    d, problems = convert_location({"id": "a", "category": "transportation", "name": {"fa": "ترمینال", "en": None}, "location": {"lat": None, "lng": None}})
    assert d["category"] == "transport" and d["lat"] is None and d["lng"] is None and problems == []


def test_importer_rejects_unknown_category_and_half_coordinates():
    assert convert_location({"id": "a", "category": "hotels", "name": {"fa": "x"}})[0] is None
    d, problems = convert_location({"id": "a", "category": "attractions", "name": {"fa": "x"}, "location": {"lat": 39.3, "lng": None}})
    assert d["lat"] is None and d["lng"] is None and problems


def test_importer_verification_and_publication_rules():
    base = {"id": "a", "category": "attractions", "name": {"fa": "x"}}
    d, _ = convert_location({**base, "verification_status": "partially_verified"})
    assert d["verification"] == "unverified" and d["status"] == "published"  # partial is NOT verified
    d, _ = convert_location({**base, "verification_status": "unverified"})
    assert d["status"] == "draft"
    d, _ = convert_location({**base, "verification_status": "unverified"}, publish="all")
    assert d["status"] == "published"
    d, _ = convert_location({**base, "verification_status": "verified"})
    assert d["verification"] == "verified"


def test_the_real_research_file_converts_completely_with_stable_ids():
    rows = json.loads(DATA.read_text(encoding="utf-8"))["locations"]
    converted = [convert_location(r) for r in rows]
    assert all(d is not None and not p for d, p in converted)
    assert [d["id"] for d, _ in converted] == [r["id"] for r in rows]  # ids unchanged
    assert {d["category"] for d, _ in converted} <= set(CATEGORY_KEYS)
    assert all(coordinate_problem(d["lat"], d["lng"]) is None for d, _ in converted)
    assert sum(d["lat"] is not None for d, _ in converted) == 2  # only the 2 cross-checked ones; no coordinate invented


def test_check_data_finds_legacy_categories_and_bad_coordinates():
    p = lambda i, c, la=None, ln=None, st="published", src="manual": SimpleNamespace(id=i, category_key=c, lat=la, lng=ln, status=st, verification="unverified", source=src, name_fa="x")
    r = analyse([p("a", "attractions", 39.3, 44.5), p("b", "services"), p("c", "transport", 44.5, 39.3), p("d", "transport", src="seed-sample")])
    assert r["legacy_or_unknown_category"] == ["b"]
    assert [i for i, _ in r["bad_coordinates"]] == ["c"]
    assert r["samples_published"] == ["d"] and r["no_coordinates"] == 2
