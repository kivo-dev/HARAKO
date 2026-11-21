/** Base URL of the backend, e.g. http://localhost:8000/v1. Empty = no backend yet, the built-in
 *  sample data is used (and labelled as sample). */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "");
export const apiEnabled = Boolean(API_BASE);

/** Development aid only (NEXT_PUBLIC_ALLOW_SAMPLES=1): when the backend IS configured but fails, show the
 *  built-in samples instead of an error. Off by default. In production leave it unset: a failed request
 *  must look like a failure, never like real data. */
export const ALLOW_SAMPLES_ON_FAILURE = process.env.NEXT_PUBLIC_ALLOW_SAMPLES === "1";
