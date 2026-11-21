/** A failed backend call. `kind` says what happened so screens can tell "no results" from "broken":
 *   http     the server answered with an error status (see `status`)
 *   timeout  no answer in time
 *   network  the server could not be reached (offline, wrong address, CORS)
 *   bad      the answer was not understandable JSON */
export type ApiErrorKind = "http" | "timeout" | "network" | "bad";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  /** Machine-readable `detail.code` from the backend, when it sent one. */
  readonly code?: string;

  constructor(kind: ApiErrorKind, status = 0, code?: string, message?: string) {
    super(message ?? `API ${kind}${status ? ` ${status}` : ""}`);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/** The request was cancelled on purpose (a newer one replaced it, or the screen closed). Not a failure. */
export function isAbort(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: string }).name === "AbortError";
}
