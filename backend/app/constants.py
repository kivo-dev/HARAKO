PUBLISHED = "published"  # status: draft | published | inactive
VERIFIED = "verified"  # verification: unverified | verified
SAMPLE_SOURCE = "seed-sample"  # `source` value of placeholder records; hidden when EXPOSE_SAMPLE_DATA=false

# The ONE approved list of top-level categories (key -> titles). Frontend, database, API, admin, seed and
# the data-import scripts all use these exact keys. Persian titles are exactly as approved.
CATEGORY_TITLES = {
    "attractions": {"fa": "جاذبه‌های گردشگری", "en": "Tourist attractions"},
    "accommodation_food": {"fa": "اقامت و پذیرایی", "en": "Accommodation and dining"},
    "transport": {"fa": "حمل‌ونقل", "en": "Transportation"},
    "public_services": {"fa": "خدمات عمومی", "en": "Public services"},
    "nature_adventure": {"fa": "طبیعت و ماجراجویی", "en": "Nature and adventure"},
}
CATEGORY_KEYS = tuple(CATEGORY_TITLES)  # also the display order

# Prototype keys that older databases/code may still contain. Only UNAMBIGUOUS ones are migrated
# automatically. "services" was a catch-all: it may hold accommodation or transport, so it is NOT remapped
# for real records (placeholders only; see app/categories.py and migration 0002).
LEGACY_CATEGORY_MAP = {"nature": "nature_adventure", "history": "attractions"}
LEGACY_AMBIGUOUS = {"services": "public_services"}  # only for source == "seed-sample"
# Spellings seen in source data files that mean one of the approved keys.
CATEGORY_ALIASES = {"transportation": "transport"}
