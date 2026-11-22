/** Map configuration. The map is the Neshan map, drawn with MapLibre GL JS.
 *
 *  NEXT_PUBLIC_MAP_STYLE_URL is the style URL that Neshan's MapLibre documentation gives for the web map.
 *  Put it in .env.local (never in Git). It may contain the Neshan MAP key (the public, browser key):
 *  restrict that key to your domain in the Neshan panel. NEVER put the SERVICE key here: every visitor
 *  can read NEXT_PUBLIC_ values.
 *
 *  There is NO default and NO fallback to another map provider: if the variable is empty the map screens
 *  say so instead of drawing something else. */
export const MAP_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "";
export const mapConfigured = MAP_STYLE_URL !== "";
export const MAP_MAX_ZOOM = Number(process.env.NEXT_PUBLIC_MAP_MAX_ZOOM) || 19;

/** Initial view when there is nothing to show yet: Maku town centre (Wikipedia/OSM, see
 *  database/harako_places_v0.2.json "area_centers"). It is a camera position, not a marker. */
export const DEFAULT_CENTER = { lat: 39.29417, lng: 44.49722 };
export const DEFAULT_ZOOM = 11;
export const NESHAN_MAP_API_KEY =
  process.env.NEXT_PUBLIC_NESHAN_MAP_API_KEY || "";