/**
 * Classifies a failed database/API call made on behalf of a verified MCP caller.
 *
 * Fail-closed: every outcome is an error. An observed backend outage is never
 * reported as "no permissions" and does not by itself justify reconnecting;
 * it also does not rule out a coexisting credential problem. Diagnostics expose
 * only whitelisted signal formats — never raw messages, tokens or row data.
 */
export type BackendFailureKind =
  | "AUTH_REQUIRED"
  | "SESSION_UNVERIFIED"
  | "BACKEND_UNAVAILABLE"
  | "EXECUTION_UNAVAILABLE";

export interface BackendFailure {
  kind: BackendFailureKind;
  /** Whitelisted: SQLSTATE (5 chars), PGRSTnnn, HTTP_nnn, NETWORK, TIMEOUT, INTERNAL or UNKNOWN. */
  signal: string;
}

interface ErrLike { code?: unknown; message?: unknown; status?: unknown; name?: unknown; cause?: unknown }

const SAFE_CODE_RX = /^(?:PGRST\d{3}|[0-9A-Z]{5})$/;
/** PostgREST connection/schema-load failures (not missing objects). */
const PGRST_UNAVAILABLE = new Set(["PGRST000", "PGRST001", "PGRST002", "PGRST003"]);
const PGRST_AUTH = new Set(["PGRST300", "PGRST301", "PGRST302", "PGRST303"]);
/** Function/route missing or not executable for this caller. */
const EXECUTION_CODES = new Set(["PGRST202", "PGRST203", "42501", "42883"]);
const UNAVAILABLE_SQLSTATES = new Set(["57014", "57P01", "57P02", "57P03", "53300", "53400", "08000", "08001", "08003", "08006", "55P03"]);
/** Transport evidence only; a bare TypeError is a programming error, not a network outage. */
const NETWORK_RX = /fetch failed|failed to fetch|networkerror|network request failed|econnreset|econnrefused|enotfound|eai_again|socket hang up|connection (?:terminated|reset|refused)/i;
const TIMEOUT_RX = /timed? ?out|etimedout/i;
const SCHEMA_LOAD_RX = /could not query the database for the schema cache/i;

function safeCode(raw: unknown): string | null {
  return typeof raw === "string" && SAFE_CODE_RX.test(raw) ? raw : null;
}

export function classifyBackendFailure(error: unknown, status?: number | null): BackendFailure {
  const e = (error ?? {}) as ErrLike;
  const code = safeCode(e.code);
  const msg = typeof e.message === "string" ? e.message : "";
  const causeMsg = typeof (e.cause as ErrLike | undefined)?.message === "string" ? String((e.cause as ErrLike).message) : "";
  const causeCode = typeof (e.cause as ErrLike | undefined)?.code === "string" ? String((e.cause as ErrLike).code) : "";
  const st = typeof status === "number" ? status : typeof e.status === "number" ? e.status : null;

  // Explicit codes take precedence over message heuristics (PGRST202 also mentions "schema cache").
  if (code) {
    if (PGRST_UNAVAILABLE.has(code) || UNAVAILABLE_SQLSTATES.has(code)) return { kind: "BACKEND_UNAVAILABLE", signal: code };
    if (EXECUTION_CODES.has(code)) return { kind: "EXECUTION_UNAVAILABLE", signal: code };
    if (PGRST_AUTH.has(code)) return { kind: "AUTH_REQUIRED", signal: code };
  }
  if (st !== null && st >= 500) return { kind: "BACKEND_UNAVAILABLE", signal: `HTTP_${st}` };
  if (SCHEMA_LOAD_RX.test(msg)) return { kind: "BACKEND_UNAVAILABLE", signal: "PGRST002" };
  if (st === 408 || e.name === "AbortError" || e.name === "TimeoutError" || TIMEOUT_RX.test(msg)) return { kind: "BACKEND_UNAVAILABLE", signal: "TIMEOUT" };
  if (NETWORK_RX.test(msg) || NETWORK_RX.test(causeMsg) || NETWORK_RX.test(causeCode)) return { kind: "BACKEND_UNAVAILABLE", signal: "NETWORK" };
  if (st === 401) return { kind: "AUTH_REQUIRED", signal: "HTTP_401" };
  if (st === 403 || st === 404) return { kind: "EXECUTION_UNAVAILABLE", signal: `HTTP_${st}` };
  if (error instanceof Error && !code && st === null) return { kind: "SESSION_UNVERIFIED", signal: "INTERNAL" };
  return { kind: "SESSION_UNVERIFIED", signal: code ?? (st !== null ? `HTTP_${st}` : "UNKNOWN") };
}

const TEXT: Record<BackendFailureKind, string> = {
  AUTH_REQUIRED: "Andromeda rechazó la credencial de esta conexión. Vuelve a conectar el asistente e inicia sesión en Andromeda.",
  SESSION_UNVERIFIED: "No se pudo verificar la sesión de esta conexión; no se autoriza proponer cambios. Reintenta más tarde; si persiste, revisa la conexión en Andromeda → Configuración → Conexiones.",
  BACKEND_UNAVAILABLE: "El servicio de datos de Andromeda no respondió a esta consulta. Este fallo por sí solo no indica que haya que reconectar, aunque no descarta otro problema de la conexión. Reintenta más tarde; mientras tanto no se autoriza proponer cambios.",
  EXECUTION_UNAVAILABLE: "La verificación de permisos no está disponible para esta conexión en este momento; no se autoriza proponer cambios. Este fallo no indica por sí solo que haya que reconectar.",
};

export function backendFailureText(f: BackendFailure): string {
  return TEXT[f.kind];
}

/** Picks the most actionable failure: an observed outage outranks symptoms it may cause. */
export function worstFailure(fs: BackendFailure[]): BackendFailure | null {
  const order: BackendFailureKind[] = ["BACKEND_UNAVAILABLE", "AUTH_REQUIRED", "EXECUTION_UNAVAILABLE", "SESSION_UNVERIFIED"];
  for (const k of order) { const f = fs.find((x) => x.kind === k); if (f) return f; }
  return null;
}

/** Both branches carry every field so narrowing works without strictNullChecks. */
export type SettledQuery<T> =
  | { ok: true; data: T; count: number | null; failure: null }
  | { ok: false; data: null; count: null; failure: BackendFailure };

/** Runs a query builder (or its construction) fail-closed: sync throws, rejections and error payloads all classify. */
export async function settleQuery<T>(make: () => PromiseLike<{ data: T; error: unknown; status?: number; count?: number | null }>):
  Promise<SettledQuery<T>> {
  try {
    const res = await make();
    if (res.error) return { ok: false, data: null, count: null, failure: classifyBackendFailure(res.error, res.status) };
    return { ok: true, data: res.data, count: res.count ?? null, failure: null };
  } catch (thrown) {
    return { ok: false, data: null, count: null, failure: classifyBackendFailure(thrown) };
  }
}

/** Error result with machine-readable diagnostics (no sensitive detail). */
export function backendFailureResult(f: BackendFailure) {
  const text = backendFailureText(f);
  const structuredContent = {
    reason: f.kind,
    signal: f.signal,
    access_verified: false,
    can_manage: false,
    retryable: f.kind === "BACKEND_UNAVAILABLE",
    reconnect_recommended: f.kind === "AUTH_REQUIRED",
    observed_at: new Date().toISOString(),
  };
  return {
    content: [{ type: "text" as const, text: `${text}\n\n\`\`\`json\n${JSON.stringify(structuredContent)}\n\`\`\`` }],
    structuredContent,
    isError: true,
  };
}
