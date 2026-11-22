# Changelog: Neshan phase 1 (map, destination search, routing)

Scope of this change: the three things below, without any database change. Phase 2 (admin search/link, new
content columns, migration 0003) is NOT included.

## What changed
Backend
- `backend/app/services/neshan_search.py` (new): Neshan Search API adapter. Contract taken from the official page
  `https://platform.neshan.org/api/search/`: `GET https://api.neshan.org/v1/search?term&lat&lng`, header `Api-Key`,
  `items[].location.x = longitude`, `y = latitude`, at most 30 results. Items without title or with invalid
  coordinates are dropped.
- `backend/app/providers/registry.py`: place search now uses that adapter; `/v1/providers/status` reports
  `place_search` as `unverified` (docs-checked, no real call yet) or `off` without a key.
- `backend/app/providers/base.py`, `schemas_tools.py`, `routers/geo.py`: search results also carry
  `region`, `neighbourhood`, `kind`.
- `backend/app/services/neshan_check.py`: new command `python -m app.services.neshan_check search "ماکو" 39.29,44.50`.
- Tests: `backend/tests/test_neshan_search.py` (new), `backend/tests/test_api.py` (search is no longer 501).
- `backend/.gitignore`, `backend/.env.example` restored (they were lost as hidden files); root `.gitignore` ignores `*.db`.

Frontend
- MapLibre GL JS replaces Leaflet. No OpenStreetMap default: the style URL comes from
  `NEXT_PUBLIC_MAP_STYLE_URL`; if empty or failing, the map shows a clear message.
  Files: `package.json`, `src/lib/map/config.ts`, `src/components/map/MapLibreMap.tsx` (new, replaces `LeafletMap.tsx`),
  `MapCanvas.tsx`.
- `/route`: search any destination, pick the result yourself (nothing is auto-selected), route from GPS to the
  chosen result, offline message. A HARAKO place only pre-fills the search with its name; its database coordinates
  are not used for routing. Files: `RouteView.tsx`, `src/lib/api/client.ts` (`searchExternal`), messages.
- Place page: the route button is always available.
- `frontend/.env.local.example` restored and extended; `frontend/tests/map-lib.test.mjs` restored (`npm test`).

## Not done / waiting for documents
- Neshan MapLibre style URL and key type: not read (the docs site blocked automatic reading). You must paste the
  URL from the docs into `.env.local`.
- Pedestrian routing: contract not read, not implemented (UI says car only).
- Direction polyline encoding is still unverified; the frontend draws the line only if it matches origin and
  destination, otherwise shows distance and time only.
- Phase 2: admin search and link, new content columns, migration 0003.

## How to apply
1. Copy the files of this ZIP over the project, keeping the folder structure (`frontend/...`, `backend/...`, `docs/...`, `.gitignore`).
2. Delete `frontend/src/components/map/LeafletMap.tsx` (replaced by `MapLibreMap.tsx`).
3. `harako.db` is tracked in Git. Remove it from Git without deleting your file:
   `git rm --cached backend/harako.db`
4. Frontend: `cd frontend && npm install` (updates `package-lock.json`: leaflet out, maplibre-gl in), then
   copy `.env.local.example` to `.env.local` and fill `NEXT_PUBLIC_MAP_STYLE_URL`.
5. Backend: `NESHAN_SERVICE_KEY` must be in `backend/.env` (already used for routing). No migration is needed.

## Tests
Executed in the authoring sandbox: frontend `npm test` (7 passed); backend `parse_items` and the adapter's
no-key behaviour with a stand-in `httpx`; EN/FA message parity.
Written but NOT executed (FastAPI, httpx, pytest are not installed there): `backend/tests/test_neshan_search.py`,
the changed parts of `test_api.py`. NOT executed: `npm install`, `npm run build`, lint, typecheck against the real
type packages, the map in a browser, a real Neshan call, Android 7.
Run: `cd backend && pytest -q` and `cd frontend && npm run typecheck && npm run lint && npm run build && npm test`.
