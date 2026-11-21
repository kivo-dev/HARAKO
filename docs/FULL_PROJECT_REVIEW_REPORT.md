# HARAKO – Full project review: report

Branch: `harako-final-fixes`. Nothing here was run against a real database, a real Neshan key or a real browser (see "Not executed").

## 1. Bugs found (with cause)

| # | Bug | Cause | Where |
|---|-----|-------|-------|
| 1 | Category "services" / wrong categories, 404 and empty lists | Backend, frontend and CSV used different category names; `backendCategory()` guessed a mapping; the server layer returned `null` on ANY failure so errors looked like "no data" | `app/constants.py`, `src/lib/api/*` |
| 2 | `create_review.py` mis-classified places (a hotel with a tourism tag became an attraction, etc.) and used the first polygon vertex, not a centre | rule order + `coords[0]` | `database/create_review.py` |
| 3 | No validation of coordinates, rating or category when an admin saved a place | none existed | `app/models.py` |
| 4 | Unknown category silently returned an empty list | no check | `routers/places.py` |
| 5 | Admin could create/rename categories and break the taxonomy | CategoryAdmin was editable | `app/admin.py` |
| 6 | Search/filter showed stale or old results; failure looked like "no results" | no abort/ordering guard, error swallowed, 5-minute cache | `DiscoverBrowser`, `places.ts` |
| 7 | Silent sample fallback when the API failed | `Suggestions`, `getCategories`, normalizers | `src/lib/api/*` |
| 8 | Unknown sector coerced to "trade"; invalid coordinates accepted | `normalize.ts` | `normalize.ts` |
| 9 | `/map` and `/route` were "coming soon" placeholders | not implemented | `src/app/.../map`, `route` |
| 10 | Place page showed "route"/"map" buttons for places without coordinates, linked to nothing specific; pages were pre-built from sample ids | static params + `revalidate` | `discover/[id]/page.tsx` |
| 11 | Opportunities page destructured `{items, failed}` from a function that returned an array; `Discover.serverDown` message did not exist | type/contract drift | `opportunities/page.tsx`, messages |
| 12 | Landing "suggested" chips were sample places, not categories | hard-coded | `Landing.tsx` |
| 13 | `AbortSignal.timeout()` is missing in older Android WebViews | API use | `places.ts` (now a manual timer) |

## 2. What was changed

Database / data: `database/create_review.py` rewritten (explicit order accommodation → food → transport → public → nature → attractions; `None` when no rule matches; area-weighted polygon centroid with point-on-surface fallback; line midpoint; coordinate flags; new columns `category_key, classification_rule, coordinate_approximate, review_flags`). Your `osm_review.csv` is NOT overwritten.

Backend: canonical taxonomy and legacy map (`constants.py`), coordinate rules (`geo.py`), model validation on insert/update (`models.py`), `categories.py`, 422 `{code:"unknown_category", allowed:[...]}`, read-only CategoryAdmin, reversible data-only migration `0002` with an audit table (nothing is deleted; ambiguous legacy rows are left for manual review), `import_locations.py` (dry-run by default) and `check_data.py`.

Frontend: strict data layer (`ApiError`, `Loaded<T>`, timeouts, no silent samples), URL-driven discover (`?q=&category=`) with request cancellation + ordering guard + loading/empty/error/retry states, suggestions without fake fallback, detail page that distinguishes 404 from "server unreachable" and hides route/map when there are no coordinates, real `/map` (Leaflet) and `/route` (backend → Neshan, car only, geolocation on button press, polyline plausibility check, never a straight line), landing chips are the five categories, EN/FA messages in parity.

## 3. Tests

Executed here and passing:
- `database/test_create_review.py` – 15
- `frontend tests/map-lib.test.mjs` – 7 (`npm test`)
- backend pure tests (`test_scoring`, `test_mappers`, `test_data_pipeline`) – 17 tests (`--noconftest`); the earlier full pure run was 60
- Migration `0002` SQL logic checked on real sqlite3 through a shim
- EN/FA message key parity and used-key check (script)
- A syntax/logic type-check with `tsc` using stub module types (no real `@types`), no errors in the new/changed files other than stub noise

Written but NOT executed (no FastAPI/SQLAlchemy/alembic/sqladmin in the sandbox): `backend/tests/test_categories_and_validation.py`, the 0002 test in `test_migrations.py`, `test_api.py` HTTP tests.

## 4. Not executed – please run locally

```
cd backend && pip install -r requirements-dev.txt && pytest -q
cd backend && alembic upgrade head          # back up the DB first; alembic downgrade -1 is supported
cd .. && npm install && npm run typecheck && npm run lint && npm run build && npm test
```
Also by hand: the admin panel (edit a place, bad coordinates must be rejected), `/discover` search + category chips + refresh + back button, `/map`, `/route` with a real Neshan key on the backend, the bottom navigation on a phone, Android 7 (not tested at all, so no claim is made).

## 5. Open items / limits

- Neshan route geometry: the backend still marks the polyline encoding as unverified. The frontend decodes it as precision-5 and draws it only if it fits the origin and destination; otherwise it shows distance and time only. Verify with one real call.
- Default map tiles are the public OpenStreetMap server: fine for development and light use, not for heavy traffic. Switch with `NEXT_PUBLIC_MAP_TILE_URL`. A Neshan map key is a different key and is NOT in the frontend.
- The `Place` model has no columns for sources, notes, opening hours, price or contact, so the importer cannot store them; add columns in a later migration.
- Nakhchivan points and unnamed peaks in the OSM extract need a human review (`review_flags`).
- Legacy `services` rows that are real records stay for manual review.
- Tourist accounts and the AI assistant were not touched.
