/**
 * emailConnectionHealth — Deno mirror of `src/lib/email-connection-health.ts`.
 *
 * The screen, the MCP tool, the daily digest and the SQL detector must reach
 * the SAME verdict from the same row. The web side imports the TS module; edge
 * functions cannot reach `src/`, so this file carries a verbatim copy of the
 * policy. Any change here must be applied there too (and to the SQL detector).
 *
 * Key distinctions the policy encodes:
 *  - `token_expires_at` is the Microsoft ACCESS token (~1 h). Never, on its
 *    own, a reason to warn.
 *  - `last_refresh_at` is stamped on every ATTEMPT; `last_refresh_success_at`
 *    only on a renewal that actually worked.
 *  - A revocation WITH `failure_code` is Microsoft withdrawing the grant (a
 *    real incident). A revocation WITHOUT it is the user's own disconnect —
 *    a decision, not a failure, and it raises nothing anywhere.
 */

export const EMAIL_HEALTH_POLICY = {
  staleRenewalHours: 24,
  failureCountThreshold: 3,
} as const;

export type EmailConnectionHealth =
  | "NO_CONECTADO"
  | "CONECTANDO"
  | "ACTIVA"
  | "POR_VENCER"
  | "ERROR";

export interface EmailHealthInput {
  status?: string | null;
  revoked_at?: string | null;
  failure_code?: string | null;
  last_refresh_at?: string | null;
  last_refresh_success_at?: string | null;
  last_refresh_outcome?: string | null;
  refresh_failure_count?: number | null;
  token_expires_at?: string | null;
}

export function lastSuccessfulRenewal(c: EmailHealthInput): number | null {
  if (c.last_refresh_success_at) return Date.parse(c.last_refresh_success_at);
  if (c.last_refresh_outcome === "SUCCESS" && c.last_refresh_at) return Date.parse(c.last_refresh_at);
  return null;
}

/** Revocation the user did NOT ask for. */
export function isExternalRevocation(c: EmailHealthInput): boolean {
  return Boolean(c.revoked_at) && Boolean(c.failure_code);
}

/** Disconnect the user performed deliberately: never an incident. */
export function isVoluntaryDisconnect(c: EmailHealthInput): boolean {
  return Boolean(c.revoked_at) && !c.failure_code;
}

export function emailConnectionHealth(c: EmailHealthInput | null, now = Date.now()): EmailConnectionHealth {
  if (!c) return "NO_CONECTADO";
  if (c.status === "PENDING") return "CONECTANDO";
  if (c.status === "ERROR" || c.status === "REVOKED" || c.revoked_at) return "ERROR";
  if (c.last_refresh_outcome === "FAILED") return "POR_VENCER";
  if ((c.refresh_failure_count ?? 0) >= EMAIL_HEALTH_POLICY.failureCountThreshold) return "POR_VENCER";
  const lastOk = lastSuccessfulRenewal(c);
  const staleRenewal = lastOk === null || lastOk < now - EMAIL_HEALTH_POLICY.staleRenewalHours * 3_600_000;
  const expires = c.token_expires_at ? Date.parse(c.token_expires_at) : null;
  // An expired — or absent — access token matters only when renewal has also
  // gone quiet. A null expiry does not prove the grant is alive.
  if (staleRenewal && (expires === null || expires < now)) return "POR_VENCER";
  return "ACTIVA";
}

export interface DigestConnectionIssue {
  status: string;
  severity: "CRITICAL" | "WARNING";
  headline: string;
  detail: string;
  sinceKey: "lastOk" | "lastAttempt" | "lastSync";
}

/**
 * The digest's view of the same verdict. Returns null when there is nothing to
 * report — including a voluntary disconnect, which the SQL detector also skips.
 */
export function digestConnectionIssue(
  c: EmailHealthInput,
  now = Date.now(),
): DigestConnectionIssue | null {
  if (isVoluntaryDisconnect(c)) return null;
  const health = emailConnectionHealth(c, now);
  if (health === "ACTIVA" || health === "NO_CONECTADO" || health === "CONECTANDO") return null;

  if (health === "ERROR") {
    return {
      status: isExternalRevocation(c) ? "REVOCADA POR MICROSOFT" : "CONEXIÓN EN ERROR",
      severity: "CRITICAL",
      headline: "La conexión con su buzón está caída",
      detail:
        "Ningún correo del despacho se está vinculando a los expedientes. La evidencia de lo que hizo la firma no se está capturando desde que la conexión falló.",
      sinceKey: "lastOk",
    };
  }

  const failing =
    c.last_refresh_outcome === "FAILED" ||
    (c.refresh_failure_count ?? 0) >= EMAIL_HEALTH_POLICY.failureCountThreshold;
  if (failing) {
    return {
      status: "RENOVACIÓN FALLIDA",
      severity: "WARNING",
      headline: "La renovación automática del buzón está fallando",
      detail:
        "Todavía funciona, pero si sigue fallando dejará de vincularse correspondencia. Reconéctelo cuando pueda.",
      sinceKey: "lastAttempt",
    };
  }
  return {
    status: "SIN RENOVACIÓN",
    severity: "CRITICAL",
    headline: `El buzón lleva más de ${EMAIL_HEALTH_POLICY.staleRenewalHours} horas sin renovar su credencial`,
    detail: "La vinculación de correspondencia está detenida hasta que reconecte el buzón.",
    sinceKey: "lastOk",
  };
}
