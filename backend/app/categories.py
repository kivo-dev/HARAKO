"""The approved category taxonomy: lookup, validation and the safe legacy-key migration.

Rules (see also migration 0002):
  * exactly five top-level categories (app/constants.py CATEGORY_TITLES);
  * `/categories` always returns all five, in order, even while a category has no places yet;
  * unknown category filters are an error (422), never a silent empty result;
  * legacy keys are migrated only when the meaning is unambiguous, and NO record is ever deleted.
"""
import logging
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from .constants import CATEGORY_KEYS, CATEGORY_TITLES, LEGACY_AMBIGUOUS, LEGACY_CATEGORY_MAP, SAMPLE_SOURCE
from .models import Category, Place
from .schemas import CategoryOut, Localized

log = logging.getLogger("harako.categories")


def check_category(category: Optional[str]) -> Optional[str]:
    """Used by every endpoint that filters by category. Empty = no filter."""
    if not category:
        return None
    if category not in CATEGORY_KEYS:
        raise HTTPException(422, {"code": "unknown_category", "message": f"Unknown category '{category}'", "allowed": list(CATEGORY_KEYS)})
    return category


def canonical_categories(db: Session) -> list[CategoryOut]:
    """All five approved categories. Titles come from the database row when it exists (so a typo fix in
    the admin shows up), otherwise from the constants. Legacy/extra rows are not returned."""
    rows = {c.key: c for c in db.scalars(select(Category))}
    out = []
    for key in CATEGORY_KEYS:
        row = rows.get(key)
        title = Localized(fa=row.title_fa, en=row.title_en) if row else Localized(**CATEGORY_TITLES[key])
        out.append(CategoryOut(key=key, title=title))
    return out


def ensure_canonical_rows(db: Session) -> None:
    """Create/refresh the five category rows with the approved titles. Never touches places."""
    for i, key in enumerate(CATEGORY_KEYS, start=1):
        row = db.get(Category, key) or Category(key=key)
        row.title_fa, row.title_en, row.sort = CATEGORY_TITLES[key]["fa"], CATEGORY_TITLES[key]["en"], i
        db.add(row)
    db.flush()


def migrate_legacy_categories(db: Session) -> dict:
    """Move places off prototype keys. Returns a report; deletes no place.

    nature -> nature_adventure, history -> attractions (unambiguous).
    services -> public_services ONLY for placeholder records (source "seed-sample"); a real record that
    still says "services" could be a hotel or a bus stop, so it is left where it is and reported.
    A legacy category row is removed only when no place refers to it any more."""
    ensure_canonical_rows(db)
    report: dict = {"moved": {}, "needs_review": []}
    for old, new in LEGACY_CATEGORY_MAP.items():
        n = db.execute(update(Place).where(Place.category_key == old).values(category_key=new)).rowcount or 0
        if n:
            report["moved"][f"{old}->{new}"] = n
    for old, new in LEGACY_AMBIGUOUS.items():
        n = db.execute(update(Place).where(Place.category_key == old, Place.source == SAMPLE_SOURCE).values(category_key=new)).rowcount or 0
        if n:
            report["moved"][f"{old}->{new} (samples only)"] = n
        report["needs_review"] += list(db.scalars(select(Place.id).where(Place.category_key == old)))
    db.flush()
    for old in (*LEGACY_CATEGORY_MAP, *LEGACY_AMBIGUOUS):
        if db.scalar(select(func.count()).select_from(Place).where(Place.category_key == old)) == 0:
            db.execute(delete(Category).where(Category.key == old))
    if report["needs_review"]:
        log.warning("Places still on the legacy 'services' category need a manual decision: %s", report["needs_review"])
    return report
