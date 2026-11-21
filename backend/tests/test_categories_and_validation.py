"""Categories, filters and record validation on a real temporary database (needs the full dependencies)."""
import pytest

from app.constants import CATEGORY_KEYS
from app.db import SessionLocal
from app.models import Category, Place

APPROVED_FA = ["جاذبه‌های گردشگری", "اقامت و پذیرایی", "حمل‌ونقل", "خدمات عمومی", "طبیعت و ماجراجویی"]


def ids(res):
    return [i["id"] for i in res.json()["items"]]


def add_places():
    with SessionLocal() as db:
        db.add_all([Category(key=k, title_fa="x", title_en="x", sort=i) for i, k in enumerate(CATEGORY_KEYS)])
        db.flush()
        for key in CATEGORY_KEYS:
            db.add(Place(id=f"{key}-1", category_key=key, name_fa=f"جای {key}", name_en=f"Place {key}", area_fa="ماکو", status="published", source="manual"))
        db.add(Place(id="hotel-maku", category_key="accommodation_food", name_fa="هتل ماکو", name_en="Maku Hotel", area_fa="ماکو", status="published", source="manual"))
        db.commit()


def test_categories_api_returns_all_five_in_order_even_with_an_empty_database(client):
    r = client.get("/v1/categories")
    assert [c["key"] for c in r.json()] == list(CATEGORY_KEYS)
    assert [c["title"]["fa"] for c in r.json()] == APPROVED_FA  # exact approved Persian labels, from constants


def test_categories_api_ignores_legacy_rows(client):
    with SessionLocal() as db:
        db.add(Category(key="services", title_fa="خدمات", title_en="Services", sort=9))
        db.commit()
    assert [c["key"] for c in client.get("/v1/categories").json()] == list(CATEGORY_KEYS)


@pytest.mark.parametrize("key", CATEGORY_KEYS)
def test_each_category_filter_returns_only_that_category(client, key):
    add_places()
    r = client.get("/v1/places", params={"category": key})
    assert r.status_code == 200
    assert {i["category"] for i in r.json()["items"]} == {key}


def test_all_categories_when_no_filter_and_empty_category_is_a_normal_empty_result(client):
    add_places()
    assert len(ids(client.get("/v1/places"))) == 6
    with SessionLocal() as db:
        db.query(Place).filter(Place.category_key == "transport").delete()
        db.commit()
    r = client.get("/v1/places", params={"category": "transport"})
    assert r.status_code == 200 and r.json()["items"] == [] and r.json()["total"] == 0


def test_unknown_and_legacy_category_is_422_not_a_silent_empty_list(client):
    add_places()
    for bad in ("history", "nature", "services", "transportation", "nonsense"):
        r = client.get("/v1/places", params={"category": bad})
        assert r.status_code == 422, bad
        assert r.json()["detail"]["allowed"] == list(CATEGORY_KEYS)
    assert client.get("/v1/places/nearby", params={"lat": 39.3, "lng": 44.5, "category": "history"}).status_code == 422


def test_search_combined_with_category(client):
    add_places()
    assert ids(client.get("/v1/places", params={"q": "هتل", "category": "accommodation_food"})) == ["hotel-maku"]
    assert ids(client.get("/v1/places", params={"q": "هتل", "category": "attractions"})) == []
    assert ids(client.get("/v1/places", params={"q": "ماكو"})) != []  # Arabic kaf matches Persian ک


def test_search_still_works_after_an_edit(client):
    add_places()
    with SessionLocal() as db:
        p = db.get(Place, "hotel-maku")
        p.name_fa = "مهمانسرای بازرگان"  # edit through the ORM, like the admin panel does
        db.commit()
    assert ids(client.get("/v1/places", params={"q": "مهمانسرای"})) == ["hotel-maku"]
    assert ids(client.get("/v1/places", params={"q": "هتل ماکو"})) == []


# ---------- record validation (admin panel, seed, importer all go through the same checks) ----------
def make(**kw):
    base = dict(id="x", category_key="attractions", name_fa="ن", status="draft", source="manual")
    base.update(kw)
    return Place(**base)


def commit(place):
    with SessionLocal() as db:
        db.add(Category(key="attractions", title_fa="x", title_en="x", sort=1))
        db.flush()
        db.add(place)
        db.commit()


@pytest.mark.parametrize("lat,lng", [(44.5, 39.3), (95, 44), (39.3, 190), (39.3, None), (None, 44.5), (48.85, 2.35)])
def test_bad_coordinates_are_rejected(client, lat, lng):
    with pytest.raises(ValueError):
        commit(make(lat=lat, lng=lng))


def test_good_and_missing_coordinates_are_accepted(client):
    commit(make(lat=39.29, lng=44.43))
    with SessionLocal() as db:
        db.add(make(id="y", lat=None, lng=None))
        db.commit()


def test_rating_and_category_are_validated(client):
    with pytest.raises(ValueError):
        commit(make(rating=7))
    with pytest.raises(ValueError):
        commit(make(category_key="history"))
