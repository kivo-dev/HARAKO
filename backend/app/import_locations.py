"""Import the curated research file (database/harako_places_v0.2.json) into the database.

    python -m app.import_locations ../database/harako_places_v0.2.json --dry-run      # look first
    python -m app.import_locations ../database/harako_places_v0.2.json                # then import

Safety rules (nothing here deletes anything):
  * records are matched by `id`; ids never change;
  * a record that already exists is updated ONLY if it was created by this importer (source
    "curated-v0.2"). Anything edited or created in the admin panel (any other source) is skipped and
    reported, so manual work is never overwritten;
  * missing coordinates stay missing (NULL). Nothing is guessed. Pairs that fail validation (out of range,
    outside Iran, lat/lng reversed) are rejected and reported, the rest still import;
  * `verification` is "verified" only when the file says "verified". "partially_verified" and
    "unverified" both import as unverified, so the app can tell them apart from verified records;
  * by default records that are at least partially verified are published; "unverified" ones are saved
    as drafts (hidden) until someone reviews them. Change with --publish.
Not stored (the schema has no columns for them yet): sources, notes, inside_free_zone, coords_status,
opening hours, price, contact. They stay in the JSON file.
"""
import json
import sys
from pathlib import Path
from typing import Any, Optional

from .constants import CATEGORY_ALIASES, CATEGORY_KEYS

SOURCE = "curated-v0.2"


def _text(v: Any) -> str:
    return v.strip() if isinstance(v, str) and v.strip() else ""


def convert_location(loc: dict, publish: str = "partially_verified") -> tuple[Optional[dict], list[str]]:
    """JSON record -> dict for the importer, plus a list of problems. Pure function (unit tested).
    publish: "none" | "partially_verified" | "all"."""
    problems: list[str] = []
    pid = _text(loc.get("id"))
    if not pid:
        return None, ["record without id"]
    raw_cat = _text(loc.get("category"))
    category = CATEGORY_ALIASES.get(raw_cat, raw_cat)
    if category not in CATEGORY_KEYS:
        return None, [f"{pid}: unknown category '{raw_cat}'"]
    name = loc.get("name") or {}
    if not (_text(name.get("fa")) or _text(name.get("en"))):
        return None, [f"{pid}: no name"]
    desc = loc.get("description") or {}
    point = loc.get("location") or {}
    lat, lng = point.get("lat"), point.get("lng")
    status_in = _text(loc.get("verification_status")) or "unverified"
    published = publish == "all" or (publish == "partially_verified" and status_in in ("partially_verified", "verified"))
    out = {
        "id": pid,
        "category": category,
        "name": {"fa": _text(name.get("fa")), "en": _text(name.get("en"))},
        "area": {"fa": _text(loc.get("area")), "en": ""},
        "summary": {"fa": _text(desc.get("fa")), "en": _text(desc.get("en"))},
        "lat": lat if lat is not None else None,
        "lng": lng if lng is not None else None,
        "status": "published" if published else "draft",
        "verification": "verified" if status_in == "verified" else "unverified",
        "images": [u for u in (loc.get("images") or []) if isinstance(u, str) and u],
    }
    if (lat is None) != (lng is None):
        problems.append(f"{pid}: only one of lat/lng is set; imported WITHOUT coordinates")
        out["lat"] = out["lng"] = None
    return out, problems


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in argv
    publish = "partially_verified"
    for a in argv[1:]:
        if a.startswith("--publish="):
            publish = a.split("=", 1)[1]
    if publish not in ("none", "partially_verified", "all"):
        print("--publish must be none | partially_verified | all")
        return 2
    path = Path(args[0]) if args else Path(__file__).resolve().parent.parent.parent / "database" / "harako_places_v0.2.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    records = data.get("locations") or data.get("places") or []

    from sqlalchemy.orm import Session  # noqa: F401  (imported lazily: this module's pure part needs nothing)

    from .categories import ensure_canonical_rows
    from .db import SessionLocal, init_db
    from .models import Place, PlaceImage

    created = updated = skipped = rejected = 0
    notes: list[str] = []
    if not dry:
        init_db()
    with SessionLocal() as db:
        if not dry:
            ensure_canonical_rows(db)
        for loc in records:
            d, problems = convert_location(loc, publish)
            notes += problems
            if d is None:
                rejected += 1
                continue
            existing = db.get(Place, d["id"])
            if existing is not None and existing.source != SOURCE:
                skipped += 1
                notes.append(f"{d['id']}: exists with source '{existing.source}', left untouched")
                continue
            p = existing or Place(id=d["id"])
            p.category_key = d["category"]
            p.name_fa, p.name_en = d["name"]["fa"], d["name"]["en"]
            p.area_fa, p.area_en = d["area"]["fa"], d["area"]["en"]
            p.summary_fa, p.summary_en = d["summary"]["fa"], d["summary"]["en"]
            p.lat, p.lng = d["lat"], d["lng"]
            p.status, p.verification, p.source = d["status"], d["verification"], SOURCE
            if d["images"]:
                p.images = [PlaceImage(url=u, sort=i) for i, u in enumerate(d["images"])]
            try:
                if not dry:
                    db.add(p)
                    db.flush()  # validation (coordinates, category) runs here
            except ValueError as exc:
                db.rollback()
                rejected += 1
                notes.append(f"{d['id']}: REJECTED, {exc}")
                continue
            created, updated = (created + 1, updated) if existing is None else (created, updated + 1)
        if not dry:
            db.commit()
        else:
            db.rollback()
    print(f"{'DRY RUN: ' if dry else ''}created {created}, updated {updated}, skipped {skipped}, rejected {rejected} (of {len(records)})")
    for n in notes:
        print(" -", n)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
