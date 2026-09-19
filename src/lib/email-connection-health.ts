/**
 * email-connection-health — THE single mailbox-health policy.
 *
 * Four subsystems used to answer "is the mailbox healthy?" with three
 * different rules (screen, MCP tool, daily digest, SQL detector). They now
 * share this one function; the SQL detector mirrors it verbatim and the
 * digest imports the same thresholds through `EMAIL_HEALTH_POLICY`.
 *
 * Facts the policy rests on:
 *  - `token_expires_at` is the Microsoft ACCESS token (~1 h). Its expiry is
 *    normal OAuth behaviour and NEVER, on its own, a reason to warn.
 *  - `last_refresh_at` is stamped on EVERY renewal attempt, successful or
 *    not. The last SUCCESSFUL renewal lives in `last_refresh_success_at`.
 *  - A revocation written by Microsoft (failure_code present) is a failure;
 *    a revocation written by the user's own disconnect (failure_code null)
 *    is not.
 */

export const EMAIL_HEALTH_POLICY = {
  /** No successful renewal for this long = the channel is down. */
  staleRenewalHours: 24,
  /** Consecutive failed renewals that turn a warning into a hard failure. */
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

/** Last renewal that actually succeeded, in epoch ms, or null. */
export function lastSuccessfulRenewal(c: EmailHealthInput, now = Date.now()): number | null {
  void now;
  if (c.last_refresh_success_at) return Date.parse(c.last_refresh_success_at);
  // Legacy rows predating the dedicated column: `last_refresh_at` only means
  // "success" when the outcome recorded alongside it says so.
  if (c.last_refresh_outcome === "SUCCESS" && c.last_refresh_at) return Date.parse(c.last_refresh_at);
  return null;
}

/**
 * Revocation the user did NOT ask for. `outlook-disconnect` clears
 * `failure_code`; `ensureAccessToken` sets it on terminal Microsoft errors.
 */
export function isExternalRevocation(c: EmailHealthInput): boolean {
  return Boolean(c.revoked_at) && Boolean(c.failure_code);
}

export function emailConnectionHealth(
  c: EmailHealthInput | null,
  now = Date.now(),
): EmailConnectionHealth {
  if (!c) return "NO_CONECTADO";
  if (c.status === "PENDING") return "CONECTANDO";
  if (c.status === "ERROR" || c.status === "REVOKED" || c.revoked_at) return "ERROR";
  if (c.last_refresh_outcome === "FAILED") return "POR_VENCER";
  if ((c.refresh_failure_count ?? 0) >= EMAIL_HEALTH_POLICY.failureCountThreshold) return "POR_VENCER";
  const lastOk = lastSuccessfulRenewal(c, now);
  const staleRenewal =
    lastOk === null || lastOk < now - EMAIL_HEALTH_POLICY.staleRenewalHours * 3_600_000;
  // An expired access token matters only when renewal has also gone quiet.
  const expires = c.token_expires_at ? Date.parse(c.token_expires_at) : null;
  if (staleRenewal && (expires === null || expires < now)) return "POR_VENCER";
  return "ACTIVA";
}

/** Plain-Spanish reason behind a non-ACTIVA state, for UI and MCP alike. */
export function emailHealthReason(c: EmailHealthInput | null, now = Date.now()): string | null {
  const h = emailConnectionHealth(c, now);
  if (!c || h === "ACTIVA") return null;
  if (h === "NO_CONECTADO") return "No hay ninguna casilla conectada.";
  if (h === "CONECTANDO") return "La conexión está a medio completar.";
  if (h === "ERROR") {
    return isExternalRevocation(c)
      ? "Microsoft retiró el permiso: hay que volver a conectar la casilla."
      : c.revoked_at
        ? "La casilla fue desconectada."
        : "La conexión está en error.";
  }
  if (c.last_refresh_outcome === "FAILED" || (c.refresh_failure_count ?? 0) >= EMAIL_HEALTH_POLICY.failureCountThreshold) {
    return `La renovación automática falló ${c.refresh_failure_count ?? 1} vez(ces) seguidas.`;
  }
  return `No hay una renovación exitosa desde hace más de ${EMAIL_HEALTH_POLICY.staleRenewalHours} horas.`;
}
