"""Run:  pytest database/test_create_review.py   (pure Python, no dependencies)"""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("create_review", Path(__file__).with_name("create_review.py"))
cr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cr)


def key(**tags):
    return cr.classify(tags)[0]


def test_hotels_and_guest_houses_are_accommodation_even_with_tourism_or_historic_tags():
    for kind in ("hotel", "motel", "hostel", "guest_house"):
        assert key(tourism=kind) == "accommodation_food"
    assert key(tourism="hotel", historic="yes") == "accommodation_food"  # the old bug
    assert key(tourism="guest_house", natural="peak") == "accommodation_food"


def test_food_is_accommodation_and_food_category():
    for kind in ("restaurant", "cafe", "fast_food", "food_court"):
        assert key(amenity=kind) == "accommodation_food"
    assert key(amenity="restaurant", historic="building") == "accommodation_food"


def test_real_attractions_and_historic_sites():
    assert key(tourism="attraction") == "attractions"
    assert key(tourism="museum") == "attractions"
    assert key(historic="castle") == "attractions"
    assert key(historic="ruins", tourism="attraction") == "attractions"


def test_a_bare_tourism_tag_is_not_automatically_an_attraction():
    assert key(tourism="information") == "public_services"
    assert key(tourism="something_new") is None  # unclassified, a human decides


def test_transport_public_and_nature():
    assert key(amenity="bus_station") == "transport"
    assert key(public_transport="station") == "transport"
    assert key(highway="bus_stop") == "transport"
    assert key(amenity="hospital") == "public_services"
    assert key(amenity="police") == "public_services"
    assert key(natural="peak") == "nature_adventure"
    assert key(natural="spring") == "nature_adventure"
    assert key(tourism="camp_site") == "nature_adventure"
    assert key(leisure="nature_reserve") == "nature_adventure"
    assert key(tourism="viewpoint") == "nature_adventure"
    assert key(tourism="attraction", natural="spring") == "nature_adventure"  # natural attraction


def test_unclassified_objects_are_not_silently_public_services():
    assert key(building="yes") is None
    assert key() is None


def test_labels_are_the_approved_persian_names():
    assert cr.CATEGORY_LABELS == {
        "attractions": "جاذبه‌های گردشگری",
        "accommodation_food": "اقامت و پذیرایی",
        "transport": "حمل‌ونقل",
        "public_services": "خدمات عمومی",
        "nature_adventure": "طبیعت و ماجراجویی",
    }


# ---------- geometry ----------
def test_point_is_lat_lon_not_lon_lat():
    lat, lon, m = cr.geometry_point({"type": "Point", "coordinates": [44.5, 39.3]})  # GeoJSON order is lon, lat
    assert (lat, lon, m) == (39.3, 44.5, "point")


def test_polygon_centroid_is_area_weighted_not_a_vertex_average():
    # A square with many extra vertices along ONE side: vertex average is dragged to that side.
    ring = [[0, 0], [10, 0], [10, 10], [0, 10]] + [[0, 10 - i * 0.1] for i in range(1, 100)]
    lat, lon, m = cr.geometry_point({"type": "Polygon", "coordinates": [ring]})
    assert m == "polygon_centroid"
    assert abs(lon - 5) < 0.2 and abs(lat - 5) < 0.2
    naive_lon = sum(p[0] for p in ring) / len(ring)
    assert naive_lon < 3  # the old averaging method would have been far off


def test_c_shaped_polygon_gets_a_point_inside_it():
    # C shape: centroid lies in the empty bay of the C.
    c = [[0, 0], [10, 0], [10, 2], [2, 2], [2, 8], [10, 8], [10, 10], [0, 10]]
    lat, lon, m = cr.geometry_point({"type": "Polygon", "coordinates": [c]})
    assert m == "polygon_point_on_surface"
    assert cr._in_polygon([[tuple(p) for p in c]], lon, lat)


def test_polygon_with_hole_never_returns_a_point_in_the_hole():
    outer = [[0, 0], [10, 0], [10, 10], [0, 10]]
    hole = [[2, 2], [8, 2], [8, 8], [2, 8]]
    lat, lon, m = cr.geometry_point({"type": "Polygon", "coordinates": [outer, hole]})
    assert cr._in_polygon([[tuple(p) for p in outer], [tuple(p) for p in hole]], lon, lat)


def test_multipolygon_uses_largest_part_and_is_marked_approximate():
    small = [[[0, 0], [1, 0], [1, 1], [0, 1]]]
    big = [[[20, 20], [30, 20], [30, 30], [20, 30]]]
    lat, lon, m = cr.geometry_point({"type": "MultiPolygon", "coordinates": [small, big]})
    assert 20 < lon < 30 and 20 < lat < 30 and m.endswith("_of_largest_part")


def test_line_midpoint_and_degenerate_inputs():
    assert cr.geometry_point({"type": "LineString", "coordinates": [[0, 0], [10, 0]]}) == (0.0, 5.0, "line_midpoint")
    assert cr.geometry_point(None)[2] == "missing"
    assert cr.geometry_point({"type": "Polygon", "coordinates": []})[2] == "missing"
    assert cr.geometry_point({"type": "Point", "coordinates": ["x", "y"]})[2] == "invalid"
    assert cr.geometry_point({"type": "Banana", "coordinates": []})[2] == "unsupported"


def test_coordinate_flags():
    assert cr.coordinate_flags(39.3, 44.5) == []
    assert cr.coordinate_flags(44.5, 39.3) == ["possible_lat_lng_swap"]
    assert cr.coordinate_flags(95, 10) == ["coordinates_out_of_range"]
    assert cr.coordinate_flags(None, None) == ["no_coordinates"]
    assert cr.coordinate_flags(48.8, 2.3) == ["outside_expected_region"]


def test_rows_keep_old_columns_first_and_add_flags():
    data = {"features": [{"id": "node/1", "properties": {"@id": "node/1", "tourism": "hotel", "historic": "yes"},
                          "geometry": {"type": "Point", "coordinates": [44.5, 39.3]}}]}
    row = cr.build_rows(data)[0]
    assert list(cr.FIELDS[:12]) == ["osm_id", "name", "category", "latitude", "longitude", "coordinate_method",
                                    "amenity", "tourism", "shop", "historic", "natural", "leisure"]
    assert row["category"] == "اقامت و پذیرایی" and "unnamed" in row["review_flags"]
