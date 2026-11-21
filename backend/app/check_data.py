"""READ-ONLY health report of the places already in the database. Changes nothing.

    python -m app.check_data            # exit code 1 when something needs fixing
"""
import sys
from collections import Counter

from .constants import CATEGORY_KEYS
from .geo import coordinate_problem


def analyse(places: list) -> dict:
    """Pure function over objects that have id/category_key/lat/lng/status/verification/source/name_fa."""
    report = {
        "total": len(places),
        "by_category": Counter(p.category_key for p in places),
        "by_status": Counter(p.status for p in places),
        "by_verification": Counter(p.verification for p in places),
        "by_source": Counter(p.source for p in places),
        "no_coordinates": sum(1 for p in places if p.lat is None and p.lng is None),
        "legacy_or_unknown_category": [p.id for p in places if p.category_key not in CATEGORY_KEYS],
        "bad_coordinates": [(p.id, coordinate_problem(p.lat, p.lng)) for p in places if coordinate_problem(p.lat, p.lng)],
        "published_without_coordinates": [p.id for p in places if p.status == "published" and p.lat is None],
        "samples_published": [p.id for p in places if p.source == "seed-sample" and p.status == "published"],
    }
    return report


def main() -> int:
    from sqlalchemy import select

    from .db import SessionLocal
    from .models import Place

    with SessionLocal() as db:
        places = list(db.scalars(select(Place)))
    r = analyse(places)
    print(f"Places: {r['total']}")
    for k in ("by_category", "by_status", "by_verification", "by_source"):
        print(f"  {k}: {dict(r[k])}")
    print(f"  without coordinates: {r['no_coordinates']} (they cannot appear on the map or get a route)")
    bad = False
    for title, key in (("LEGACY/UNKNOWN CATEGORY (needs a human decision)", "legacy_or_unknown_category"), ("BAD COORDINATES", "bad_coordinates")):
        if r[key]:
            bad = True
            print(f"  !! {title}:")
            for item in r[key]:
                print("     ", item)
    if r["samples_published"]:
        print(f"  note: {len(r['samples_published'])} placeholder (seed-sample) places are published; set EXPOSE_SAMPLE_DATA=false or purge them before going public")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
