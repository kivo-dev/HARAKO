/** Map provider configuration. EVERYTHING that names a tile provider lives here (and in the env), so
 *  switching to another provider (Neshan tiles, a self-hosted server, ...) changes no component.
 *
 *  Default: the public OpenStreetMap tile server. Its usage policy allows normal interactive use with
 *  visible attribution, but forbids bulk download/prefetching and heavy traffic. It is fine for
 *  development and a small launch; for real traffic set NEXT_PUBLIC_MAP_TILE_URL to a provider you
 *  have an agreement with. Never put a paid/secret key in these variables' defaults. */
export const MAP_TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAP_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
export const MAP_MAX_ZOOM = Number(process.env.NEXT_PUBLIC_MAP_MAX_ZOOM) || 19;

/** Initial view when there is nothing to show yet: Maku town centre (Wikipedia/OSM, see
 *  database/harako_places_v0.2.json "area_centers"). It is a camera position, not a marker. */
export const DEFAULT_CENTER = { lat: 39.29417, lng: 44.49722 };
export const DEFAULT_ZOOM = 11;
