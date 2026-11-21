"""The Alembic migration must create exactly what app/models.py describes."""
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
EXPECTED = {"categories", "places", "place_images", "opportunities"}


@pytest.fixture
def migrated_url(tmp_path, monkeypatch):
    pytest.importorskip("alembic")
    from alembic import command
    from alembic.config import Config

    from app.config import get_settings

    url = f"sqlite:///{tmp_path}/mig.db"
    monkeypatch.setattr(get_settings(), "database_url", url)  # migrations/env.py reads it from settings
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    command.upgrade(cfg, "head")
    yield url, cfg, command


def test_upgrade_creates_all_tables_and_matches_models(migrated_url):
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext
    from sqlalchemy import create_engine, inspect

    from app.models import Base

    url, _, _ = migrated_url
    eng = create_engine(url)
    assert EXPECTED <= set(inspect(eng).get_table_names())
    with eng.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn, opts={"compare_type": False}), Base.metadata)
    # the audit table of data migration 0002 is intentionally not part of the models
    diff = [d for d in diff if not (d[0] == "remove_table" and d[1].name.startswith("_hk_"))]
    assert diff == [], diff


def test_downgrade_removes_everything(migrated_url):
    from sqlalchemy import create_engine, inspect

    url, cfg, command = migrated_url
    command.downgrade(cfg, "base")
    assert EXPECTED.isdisjoint(set(inspect(create_engine(url)).get_table_names()))


def test_0002_moves_only_unambiguous_legacy_categories_and_is_reversible(tmp_path, monkeypatch):
    pytest.importorskip("alembic")
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, text

    from app.config import get_settings

    url = f"sqlite:///{tmp_path}/legacy.db"
    monkeypatch.setattr(get_settings(), "database_url", url)
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    command.upgrade(cfg, "0001")
    eng = create_engine(url)
    with eng.begin() as c:
        c.execute(text("INSERT INTO categories (key,title_fa,title_en,sort) VALUES ('nature','n','n',1),('history','h','h',2),('services','s','s',3)"))
        for pid, cat, src in (("p1", "nature", "manual"), ("p2", "history", "manual"), ("p3", "services", "seed-sample"), ("p4", "services", "manual")):
            c.execute(text("INSERT INTO places (id,category_key,name_fa,name_en,area_fa,area_en,summary_fa,summary_en,featured,status,verification,source,search_text,search_compact,created_at,updated_at) "
                           "VALUES (:i,:c,'x','x','','','','',0,'published','unverified',:s,'','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"), {"i": pid, "c": cat, "s": src})
    command.upgrade(cfg, "0002")
    with eng.connect() as c:
        got = dict(c.execute(text("SELECT id, category_key FROM places")).all())
        keys = {r[0] for r in c.execute(text("SELECT key FROM categories"))}
        titles = dict(c.execute(text("SELECT key, title_fa FROM categories")).all())
    assert got == {"p1": "nature_adventure", "p2": "attractions", "p3": "public_services", "p4": "services"}  # p4 untouched
    assert {"attractions", "accommodation_food", "transport", "public_services", "nature_adventure"} <= keys and "services" in keys
    assert titles["nature_adventure"] == "طبیعت و ماجراجویی" and titles["accommodation_food"] == "اقامت و پذیرایی"
    command.downgrade(cfg, "0001")
    with eng.connect() as c:
        back = dict(c.execute(text("SELECT id, category_key FROM places")).all())
    assert back == {"p1": "nature", "p2": "history", "p3": "services", "p4": "services"}
