/**
 * Classifies a failed database/API call made on behalf of a verified MCP caller.
 *
 * Fail-closed: every outcome here is an error; a backend outage must never be
 * reported as "no permissions" nor as "reconnect the assistant". Only genuine
 * credential rejections suggest re-authentication. Diagnostics expose stable
 * codes only — never raw messages, tokens, hosts or row data.
 */
export type BackendFailureKind =
  | "AUTH_REQUIRED"
  | "SESSION_UNVERIFIED"
  | "BACKEND_UNAVAILABLE"
  | "EXECUTION_UNAVAILABLE";

export interface BackendFailure {
  kind: BackendFailureKind;
  /** Safe, coarse signal: e.g. "PGRST002", "HTTP_522", "57014", "NETWORK", "TIMEOUT". */
  signal: string;
}

interface ErrLike { code?: unknown; message?: unknown; status?: unknown; name?: unknown }

const UNAVAILABLE_SQLSTATES = new Set(["57014", "57P01", "57P02", "57P03", "53300", "53400", "08000", "08001", "08003", "08006", "55P03"]);
const NETWORK_RX = /fetch failed|failed to fetch|network|econnre|econnrefused|enotfound|eai_again|dns|socket|connection (?:terminated|reset|refused)|upstream|bad gateway|service unavailable|gateway time/i;
const TIMEOUT_RX = /timeout|timed out|aborted/i;
const SCHEMA_RX = /schema cache/i;

export function classifyBackendFailure(error: unknown, status?: number | null): BackendFailure {
  const e = (error ?? {}) as ErrLike;
  const code = typeof e.code === "string" ? e.code : "";
  const msg = typeof e.message === "string" ? e.message : typeof error === "string" ? error : "";
  const st = typeof status === "number" ? status : typeof e.status === "number" ? e.status : null;

  if (code === "PGRST002" || SCHEMA_RX.test(msg)) return { kind: "BACKEND_UNAVAILABLE", signal: "PGRST002" };
  if (UNAVAILABLE_SQLSTATES.has(code)) return { kind: "BACKEND_UNAVAILABLE", signal: code };
  if (st !== null && st >= 500) return { kind: "BACKEND_UNAVAILABLE", signal: `HTTP_${st}` };
  if (st === 408 || TIMEOUT_RX.test(msg) || e.name === "AbortError") return { kind: "BACKEND_UNAVAILABLE", signal: "TIMEOUT" };
  if (NETWORK_RX.test(msg) || e.name === "TypeError") return { kind: "BACKEND_UNAVAILABLE", signal: "NETWORK" };

  if (code === "PGRST301" || code === "PGRST302" || code === "PGRST303" || st === 401) return { kind: "AUTH_REQUIRED", signal: code || "HTTP_401" };
  if (code === "42501" || code === "42883" || code === "PGRST202" || st === 403 || st === 404) {
    return { kind: "EXECUTION_UNAVAILABLE", signal: code || `HTTP_${st}` };
  }
  return { kind: "SESSION_UNVERIFIED", signal: code || (st !== null ? `HTTP_${st}` : "UNKNOWN") };
}

const TEXT: Record<BackendFailureKind, string> = {
  AUTH_REQUIRED: "Andromeda rechazó la credencial de esta conexión. Vuelve a conectar el asistente e inicia sesión en Andromeda.",
  SESSION_UNVERIFIED: "No se pudo verificar la sesión de esta conexión; no se autoriza proponer cambios. Reintenta en unos minutos; si persiste, revisa la conexión en Andromeda → Configuración → Conexiones.",
  BACKEND_UNAVAILABLE: "El servicio de datos de Andromeda no está respondiendo en este momento (falla temporal del servidor, no de tu cuenta). No hace falta reconectar: reintenta en unos minutos. No se autoriza proponer cambios mientras tanto.",
  EXECUTION_UNAVAILABLE: "La verificación de permisos no está disponible para esta conexión en este momento; no se autoriza proponer cambios. No es necesario reconectar.",
};

export function backendFailureText(f: BackendFailure): string {
  return TEXT[f.kind];
}

/** Picks the most actionable failure: an outage outranks credential/permission symptoms it may cause. */
export function worstFailure(fs: BackendFailure[]): BackendFailure | null {
  const order: BackendFailureKind[] = ["BACKEND_UNAVAILABLE", "AUTH_REQUIRED", "EXECUTION_UNAVAILABLE", "SESSION_UNVERIFIED"];
  for (const k of order) { const f = fs.find((x) => x.kind === k); if (f) return f; }
  return null;
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
