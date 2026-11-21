"""canonical categories: the five approved top-level categories

DATA-ONLY migration (no schema change except one small audit table). Safe and reversible:
  * creates/refreshes the five approved category rows (exact Persian/English titles);
  * moves places off the legacy prototype keys, but only where the meaning is unambiguous:
        nature   -> nature_adventure
        history  -> attractions
        services -> public_services   ONLY for placeholder rows (source = 'seed-sample')
    A real place still on 'services' is left untouched (it may be a hotel or a bus stop) and must be
    reviewed by a human: `python -m app.check_data` lists them;
  * deletes NO place; removes a legacy category row only when nothing refers to it any more;
  * records every moved place (id + old key) in `_hk_category_migration_0002`, so `downgrade` restores
    exactly what was changed and nothing else.

BEFORE RUNNING on a real database: copy the database file (SQLite) or run pg_dump (PostgreSQL).

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

AUDIT = "_hk_category_migration_0002"
CATEGORIES = [
    ("attractions", "جاذبه‌های گردشگری", "Tourist attractions", 1),
    ("accommodation_food", "اقامت و پذیرایی", "Accommodation and dining", 2),
    ("transport", "حمل‌ونقل", "Transportation", 3),
    ("public_services", "خدمات عمومی", "Public services", 4),
    ("nature_adventure", "طبیعت و ماجراجویی", "Nature and adventure", 5),
]
# (old key, new key, only placeholder rows?)
MOVES = [("nature", "nature_adventure", False), ("history", "attractions", False), ("services", "public_services", True)]
LEGACY_TITLES = {"nature": ("طبیعت", "Nature", 1), "history": ("تاریخی", "Historical", 2), "services": ("خدمات", "Services", 3)}


def upgrade() -> None:
    bind = op.get_bind()
    op.create_table(
        AUDIT,
        sa.Column("place_id", sa.String(80), primary_key=True),
        sa.Column("old_key", sa.String(40), nullable=False),
        sa.Column("new_key", sa.String(40), nullable=False),
    )
    for key, fa, en, sort in CATEGORIES:
        exists = bind.execute(sa.text("SELECT 1 FROM categories WHERE key = :k"), {"k": key}).first()
        params = {"k": key, "fa": fa, "en": en, "s": sort}
        if exists:
            bind.execute(sa.text("UPDATE categories SET title_fa = :fa, title_en = :en, sort = :s WHERE key = :k"), params)
        else:
            bind.execute(sa.text("INSERT INTO categories (key, title_fa, title_en, sort) VALUES (:k, :fa, :en, :s)"), params)

    for old, new, samples_only in MOVES:
        extra = " AND source = 'seed-sample'" if samples_only else ""
        bind.execute(
            sa.text(f"INSERT INTO {AUDIT} (place_id, old_key, new_key) SELECT id, :old, :new FROM places WHERE category_key = :old{extra}"),
            {"old": old, "new": new},
        )
        bind.execute(sa.text(f"UPDATE places SET category_key = :new WHERE category_key = :old{extra}"), {"old": old, "new": new})
        bind.execute(
            sa.text("DELETE FROM categories WHERE key = :old AND NOT EXISTS (SELECT 1 FROM places WHERE category_key = :old)"),
            {"old": old},
        )


def downgrade() -> None:
    bind = op.get_bind()
    # Bring back the legacy category rows that the places moved by this migration came from.
    for old in {r[0] for r in bind.execute(sa.text(f"SELECT DISTINCT old_key FROM {AUDIT}"))}:
        if not bind.execute(sa.text("SELECT 1 FROM categories WHERE key = :k"), {"k": old}).first():
            fa, en, sort = LEGACY_TITLES.get(old, (old, old, 99))
            bind.execute(
                sa.text("INSERT INTO categories (key, title_fa, title_en, sort) VALUES (:k, :fa, :en, :s)"),
                {"k": old, "fa": fa, "en": en, "s": sort},
            )
    bind.execute(
        sa.text(
            f"UPDATE places SET category_key = (SELECT old_key FROM {AUDIT} a WHERE a.place_id = places.id) "
            f"WHERE id IN (SELECT place_id FROM {AUDIT}) AND category_key = (SELECT new_key FROM {AUDIT} a WHERE a.place_id = places.id)"
        )
    )
    op.drop_table(AUDIT)
    # The five approved category rows are left in place on purpose: removing them could orphan places.
