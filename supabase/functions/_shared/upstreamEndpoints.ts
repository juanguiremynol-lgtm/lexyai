/**
 * upstreamEndpoints.ts — ITERATION 46 (C).
 *
 * Twice now we have declared an endpoint "missing" when it was simply on
 * another host: the PP_COVERAGE census in iteration 35, and /reserva/estado
 * plus /clase-proceso in iteration 44. The endpoints existed both times.
 *
 * The defect is structural: base URLs lived next to the call site, so every
 * new endpoint invited a fresh guess. This module is the single place where
 * "which host serves this path" is decided, and `upstream-endpoint-probe`
 * walks it end to end so a wrong host is reported as a wrong host instead of
 * being misread as a missing feature.
 *
 * ITER46 corrects three things GCP's enumeration exposed:
 *   1. The parameter is `numero_radicacion`, not `radicado`. Our probes were
 *      sending the wrong name and reading the resulting error as absence.
 *   2. A 200 is not proof. GCP's endpoints answer 200 with an error envelope,
 *      so every endpoint now declares a SUCCESS ASSERTION on the body; a probe
 *      that cannot assert success is reported as INDETERMINADO, not RESUELVE.
 *   3. `allUsers` is not granted on the Cloud Run services, so an unauthenticated
 *      401 is the EXPECTED answer and proves the route exists. It is recorded as
 *      RESUELVE_GUARDADO rather than being conflated with a healthy 200.
 */

export type UpstreamHostKey =
  | "cpnu_read"
  | "cpnu_jobs"
  | "samai_read"
  | "samai_estados"
  | "publicaciones"
  | "tutelas"
  | "andromeda_read";

interface HostSpec {
  readonly key: UpstreamHostKey;
  readonly label: string;
  /** Env override, checked first. */
  readonly envVar: string;
  /** Known-good default. Public Cloud Run URLs — not secrets. */
  readonly defaultBaseUrl: string;
  /** API key env vars, in precedence order. */
  readonly keyEnvVars: readonly string[];
  /** Header name the host expects the key in. */
  readonly keyHeader: string;
  /**
   * ITER47 — has the default host been VERIFIED to exist, by a live probe that
   * got the APPLICATION (not Google's frontend) to answer?
   *
   *  VERIFICADO   — the service answered as itself, e.g. samai-read-api's
   *                 /health returns {"ok":true,"service":"samai-read-api"}.
   *  INEXISTENTE  — Google Frontend serves its own "Page not found" HTML with
   *                 no application response: no Cloud Run service is deployed
   *                 under this name. The default is a GUESS and must never be
   *                 presented to an operator as a value to configure.
   */
  readonly hostState?: "VERIFICADO" | "INEXISTENTE" | "SIN_VERIFICAR";
  /** Probe evidence, so the claim above can be re-checked rather than trusted. */
  readonly hostEvidence?: string;
}

export const UPSTREAM_HOSTS: Record<UpstreamHostKey, HostSpec> = {
  cpnu_read: {
    key: "cpnu_read",
    label: "CPNU Read API",
    envVar: "CPNU_READ_BASE_URL",
    defaultBaseUrl: "https://cpnu-read-api-11974381924.us-central1.run.app",
    keyEnvVars: ["CPNU_X_API_KEY", "EXTERNAL_X_API_KEY"],
    keyHeader: "X-API-Key",
    hostState: "VERIFICADO",
    hostEvidence:
      "GET /health -> 200 {ok:true, service:cpnu-read-api} (probado 2026-08-08).",
  },
  cpnu_jobs: {
    key: "cpnu_jobs",
    label: "CPNU HTTPS Jobs",
    envVar: "CPNU_BASE_URL",
    defaultBaseUrl: "https://cpnu-https-jobs-11974381924.us-central1.run.app",
    keyEnvVars: ["CPNU_X_API_KEY", "EXTERNAL_X_API_KEY"],
    keyHeader: "X-API-Key",
  },
  samai_read: {
    key: "samai_read",
    label: "SAMAI Read API",
    envVar: "SAMAI_BASE_URL",
    defaultBaseUrl: "https://samai-read-api-11974381924.us-central1.run.app",
    keyEnvVars: ["SAMAI_X_API_KEY", "EXTERNAL_X_API_KEY"],
    keyHeader: "X-API-Key",
    hostState: "VERIFICADO",
    hostEvidence:
      "GET /health -> 200 {ok:true, service:samai-read-api} (probado 2026-08-08). El host por defecto es CORRECTO: si SAMAI falla, lo que sobra es el override de entorno, no el default.",
  },
  samai_estados: {
    key: "samai_estados",
    label: "SAMAI Estados",
    envVar: "SAMAI_ESTADOS_BASE_URL",
    defaultBaseUrl: "https://samai-estados-api-11974381924.us-central1.run.app",
    keyEnvVars: ["SAMAI_ESTADOS_API_KEY", "EXTERNAL_X_API_KEY"],
    keyHeader: "X-API-Key",
    hostState: "VERIFICADO",
    hostEvidence:
      "GET /health -> 200 y /openapi.json -> 200 (probado 2026-08-08).",
  },
  publicaciones: {
    key: "publicaciones",
    label: "Publicaciones Procesales",
    envVar: "PUBLICACIONES_BASE_URL",
    defaultBaseUrl: "https://publicaciones-procesales-api-11974381924.us-central1.run.app",
    keyEnvVars: ["PUBLICACIONES_X_API_KEY", "EXTERNAL_X_API_KEY"],
    keyHeader: "X-API-Key",
    hostState: "VERIFICADO",
    hostEvidence:
      "GET /health -> 200; las rutas de datos responden 401 (guardadas), lo que prueba que existen (probado 2026-08-08).",
  },
  tutelas: {
    key: "tutelas",
    label: "Tutelas API",
    envVar: "TUTELAS_BASE_URL",
    defaultBaseUrl: "https://tutelas-api-11974381924.us-central1.run.app",
    keyEnvVars: ["TUTELAS_X_API_KEY", "EXTERNAL_X_API_KEY"],
    keyHeader: "X-API-Key",
    hostState: "INEXISTENTE",
    hostEvidence:
      "Toda ruta (/, /health, /radicados) devuelve el HTML 404 propio de Google Frontend, SIN respuesta de la aplicacion: no hay servicio Cloud Run desplegado con este nombre. No podemos suministrar un valor correcto; debe darlo GCP (probado 2026-08-08).",
  },
  andromeda_read: {
    key: "andromeda_read",
    label: "Andromeda Read API",
    envVar: "ANDROMEDA_BASE_URL",
    defaultBaseUrl: "https://andromeda-read-api-11974381924.us-central1.run.app",
    keyEnvVars: ["ANDROMEDA_API_KEY"],
    keyHeader: "X-API-Key",
    hostState: "VERIFICADO",
    hostEvidence:
      "Toda ruta responde 401 desde la aplicacion (guardada), lo que prueba que el servicio existe (probado 2026-08-08).",
  },
};

/**
 * Env read that tolerates a non-Deno host: this registry is also imported by
 * the app-side contract tests, where `Deno` does not exist.
 */
function readEnv(name: string): string | undefined {
  const d = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  return d?.env?.get(name);
}

export function upstreamBaseUrl(host: UpstreamHostKey): string {
  // Read through a guard: this registry is also imported by the app-side tests,
  // where `Deno` does not exist.
  const spec = UPSTREAM_HOSTS[host];
  const fromEnv = (readEnv(spec.envVar) ?? "").trim().replace(/\/+$/, "");
  return fromEnv || spec.defaultBaseUrl;
}

export function upstreamHeaders(host: UpstreamHostKey): Record<string, string> {
  const spec = UPSTREAM_HOSTS[host];
  const headers: Record<string, string> = { Accept: "application/json" };
  for (const envVar of spec.keyEnvVars) {
    const v = (readEnv(envVar) ?? "").trim();
    if (v) {
      headers[spec.keyHeader] = v;
      break;
    }
  }
  return headers;
}

export interface UpstreamEndpoint {
  readonly key: string;
  readonly host: UpstreamHostKey;
  readonly method: "GET" | "POST";
  /**
   * Path template. `{numero_radicacion}` / `{workItemId}` are substituted when
   * probing. ITER46: the upstream parameter name is `numero_radicacion`; the
   * legacy `{radicado}` placeholder is still substituted for safety but must
   * not be used in new entries.
   */
  readonly path: string;
  readonly purpose: string;
  /** Status codes that prove the ROUTE exists even without a valid sample. */
  readonly resolvesOn?: readonly number[];
  readonly probeBody?: Record<string, unknown>;
  /**
   * ITER46 — what a SUCCESSFUL body looks like. A 200 carrying an error
   * envelope is not success. Returning `null` means "cannot tell from here".
   */
  readonly assertSuccess?: (body: unknown, status: number) => boolean | null;
}

/** 401 proves the route exists and is guarded; 404 is the only true "missing". */
const ROUTE_EXISTS = [200, 201, 202, 204, 400, 401, 403, 409, 422] as const;

/**
 * ITER46 — the Cloud Run services do not grant `allUsers`, so an unauthenticated
 * probe SHOULD receive 401/403. Treating that as a failure would report every
 * healthy endpoint as broken.
 */
export const UNAUTHENTICATED_EXPECTED = [401, 403] as const;

export function isGuardedResponse(status: number): boolean {
  return (UNAUTHENTICATED_EXPECTED as readonly number[]).includes(status);
}

/** Generic envelope check: `ok:false` / an `error` key means the 200 lied. */
function envelopeOk(body: unknown): boolean | null {
  if (body === null || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.ok === false || b.success === false) return false;
  if (typeof b.error === "string" && b.error.length > 0) return false;
  if (b.ok === true || b.success === true) return true;
  return null;
}

/**
 * ITER47 — an error envelope that names an INTERNAL failure of the provider
 * (a SQL error, a stack trace, a missing column) rather than a complaint about
 * our request. `/novedades/hoy` answers 500 with
 * `{"ok":false,"error":"column w.status does not exist"}` — the staged fix
 * references a column their own schema lacks.
 */
export function isUpstreamDefect(body: unknown): boolean {
  const err = (body as Record<string, unknown> | null)?.error;
  if (typeof err !== "string") return false;
  return /column .* does not exist|relation .* does not exist|undefined column|syntax error at or near|internal server error|traceback|NullPointer|ECONNREFUSED/i
    .test(err);
}

/** ITER46 — a probe outcome that distinguishes "answered well" from "answered". */
export type ProbeOutcome =
  | "RESUELVE"
  | "RESUELVE_GUARDADO"
  | "MUESTRA_DESCONOCIDA"
  | "RESPONDE_CON_ERROR"
  | "NO_EXISTE"
  | "INDETERMINADO"
  | "INALCANZABLE"
  /**
   * ITER47 — the route exists, we reached the right host, and the UPSTREAM
   * itself is defective. This must never be reported as "missing endpoint" or
   * as our misconfiguration: the fix belongs to the provider, and reporting it
   * as absence is what caused us to re-guess hosts twice before.
   */
  | "UPSTREAM_ROTO";

export function classifyProbe(
  ep: UpstreamEndpoint,
  status: number,
  body: unknown,
): ProbeOutcome {
  if (status === 404) {
    // A 404 for an id the upstream does not know proves the ROUTE exists; only
    // a 404 on a route that takes no sample means the feature is missing.
    return (ep.resolvesOn ?? ROUTE_EXISTS).includes(404)
      ? "MUESTRA_DESCONOCIDA"
      : "NO_EXISTE";
  }
  if (isGuardedResponse(status)) return "RESUELVE_GUARDADO";
  // ITER47 — a 5xx, or a 200 carrying an internal error, is the provider's own
  // defect on a route that demonstrably exists.
  if (status >= 500) return "UPSTREAM_ROTO";
  if (isUpstreamDefect(body)) return "UPSTREAM_ROTO";
  if (!endpointResolves(ep, status)) return "INALCANZABLE";

  const asserted = ep.assertSuccess ? ep.assertSuccess(body, status) : envelopeOk(body);
  if (asserted === false) return "RESPONDE_CON_ERROR";
  if (asserted === null) return "INDETERMINADO";
  return "RESUELVE";
}

/** Health endpoints answer `{"status":"ok"|"healthy"}` or `{"ok":true}`. */
function healthOk(b: unknown): boolean | null {
  const s = (b as Record<string, unknown> | null)?.status;
  return typeof s === "string" ? /ok|healthy|up/i.test(s) : envelopeOk(b);
}

export const UPSTREAM_ENDPOINTS: readonly UpstreamEndpoint[] = [
  {
    key: "cpnu.health",
    host: "cpnu_read",
    method: "GET",
    path: "/health",
    purpose: "Liveness del CPNU Read API",
    assertSuccess: healthOk,
  },
  {
    key: "cpnu.clase_proceso",
    host: "cpnu_read",
    method: "GET",
    path: "/work-items/{workItemId}/clase-proceso",
    purpose: "Clase de proceso declarada por el proveedor (ITER44/45 — vive en cpnu-read-api, NO en andromeda-read-api)",
    resolvesOn: [...ROUTE_EXISTS, 404],
    assertSuccess: (b) => {
      const r = b as Record<string, unknown> | null;
      if (!r) return null;
      // The contract block may legitimately report an absence motive.
      if ("clase_proceso" in r || "claseProveedor" in r || "motivo" in r) return true;
      return envelopeOk(b);
    },
  },
  {
    key: "cpnu.jobs_health",
    host: "cpnu_jobs",
    method: "GET",
    path: "/health",
    purpose: "Liveness del ejecutor de jobs CPNU",
    assertSuccess: healthOk,
  },
  {
    key: "cpnu.detalle_estado",
    host: "cpnu_jobs",
    method: "GET",
    path: "/reserva/estado?numero_radicacion={numero_radicacion}",
    purpose:
      "Marca PROCESO_PRIVADO por proceso (ITER46 — el parámetro es `numero_radicacion`, no `radicado`; vive en cpnu-https-jobs, NO en andromeda-read-api)",
    resolvesOn: ROUTE_EXISTS,
    assertSuccess: (b) => {
      const r = b as Record<string, unknown> | null;
      if (!r) return null;
      if ("privado" in r || "expuesto" in r || "estado" in r) return true;
      return envelopeOk(b);
    },
  },
  {
    key: "cpnu.detalle_revalidar",
    host: "cpnu_jobs",
    method: "POST",
    path: "/reserva/revalidar",
    purpose: "Revalidación diaria de la marca PROCESO_PRIVADO (es mutable: puede cambiar de un día para otro)",
    resolvesOn: ROUTE_EXISTS,
    probeBody: { numeros_radicacion: [] },
  },
  {
    /**
     * ITER47 — staged by GCP and DEFECTIVE at the provider. Probed live:
     *   GET /novedades/hoy -> 500 {"ok":false,"error":"column w.status does not exist"}
     * The route exists and the host is right, so this is UPSTREAM_ROTO. We keep
     * it registered precisely so it is reported as the provider's broken
     * deployment instead of quietly disappearing as an "unavailable feature".
     */
    key: "cpnu.novedades_hoy",
    host: "cpnu_read",
    method: "GET",
    path: "/novedades/hoy",
    purpose:
      "Novedades del día (ITER47 — ROTA AGUAS ARRIBA: responde 500 por una columna inexistente en el esquema del proveedor)",
    resolvesOn: [...ROUTE_EXISTS, 500],
    assertSuccess: (b) => (isUpstreamDefect(b) ? false : envelopeOk(b)),
  },
  {
    key: "samai.health",
    host: "samai_read",
    method: "GET",
    path: "/health",
    purpose: "Liveness del SAMAI Read API (expedientes CPACA)",
    assertSuccess: healthOk,
  },
  {
    key: "samai_estados.health",
    host: "samai_estados",
    method: "GET",
    path: "/health",
    purpose: "Liveness de SAMAI Estados",
    assertSuccess: healthOk,
  },
  {
    key: "publicaciones.health",
    host: "publicaciones",
    method: "GET",
    path: "/health",
    purpose: "Liveness de Publicaciones Procesales",
    assertSuccess: healthOk,
  },
  {
    key: "andromeda.salud_radicados",
    host: "andromeda_read",
    method: "GET",
    path: "/salud/radicados?source=PP_COVERAGE",
    purpose: "Censo de cobertura PP (ITER35 — vive en andromeda-read-api, NO en la API de PP)",
    resolvesOn: ROUTE_EXISTS,
  },
  {
    key: "andromeda.radicados",
    host: "andromeda_read",
    method: "GET",
    path: "/radicados",
    purpose: "Inventario upstream de radicados con su bandera `activo` (reconciliación de ciclo de vida)",
    resolvesOn: ROUTE_EXISTS,
  },
  {
    key: "andromeda.lifecycle",
    host: "andromeda_read",
    method: "POST",
    path: "/lifecycle",
    purpose:
      "Único escritor de `radicados.activo` upstream. ITER46 — el payload obligatorio es {work_item_id, radicado, new_state, occurred_at}, verificado contra el 400 del propio endpoint.",
    resolvesOn: ROUTE_EXISTS,
    probeBody: {},
    // A validation 400 is PROOF the route exists and is enforcing its contract.
    assertSuccess: (b, status) =>
      status === 400 ? true : envelopeOk(b),
  },
];

export function endpointResolves(ep: UpstreamEndpoint, status: number): boolean {
  const allowed = ep.resolvesOn ?? ROUTE_EXISTS;
  return allowed.includes(status);
}

export function buildEndpointUrl(
  ep: UpstreamEndpoint,
  vars: { radicado?: string; workItemId?: string } = {},
): string {
  const path = ep.path
    .replace("{numero_radicacion}", vars.radicado ?? "")
    .replace("{radicado}", vars.radicado ?? "")
    .replace("{workItemId}", vars.workItemId ?? "");
  return `${upstreamBaseUrl(ep.host)}${path}`;
}