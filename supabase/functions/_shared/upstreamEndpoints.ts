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
}

export const UPSTREAM_HOSTS: Record<UpstreamHostKey, HostSpec> = {
  cpnu_read: {
    key: "cpnu_read",
    label: "CPNU Read API",
    envVar: "CPNU_READ_BASE_URL",
    defaultBaseUrl: "https://cpnu-read-api-11974381924.us-central1.run.app",
    keyEnvVars: ["CPNU_X_API_KEY", "EXTERNAL_X_API_KEY"],
    keyHeader: "X-API-Key",
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
  },
  samai_estados: {
    key: "samai_estados",
    label: "SAMAI Estados",
    envVar: "SAMAI_ESTADOS_BASE_URL",
    defaultBaseUrl: "https://samai-estados-api-11974381924.us-central1.run.app",
    keyEnvVars: ["SAMAI_ESTADOS_API_KEY", "EXTERNAL_X_API_KEY"],
    keyHeader: "X-API-Key",
  },
  publicaciones: {
    key: "publicaciones",
    label: "Publicaciones Procesales",
    envVar: "PUBLICACIONES_BASE_URL",
    defaultBaseUrl: "https://publicaciones-procesales-api-11974381924.us-central1.run.app",
    keyEnvVars: ["PUBLICACIONES_X_API_KEY", "EXTERNAL_X_API_KEY"],
    keyHeader: "X-API-Key",
  },
  tutelas: {
    key: "tutelas",
    label: "Tutelas API",
    envVar: "TUTELAS_BASE_URL",
    defaultBaseUrl: "https://tutelas-api-11974381924.us-central1.run.app",
    keyEnvVars: ["TUTELAS_X_API_KEY", "EXTERNAL_X_API_KEY"],
    keyHeader: "X-API-Key",
  },
  andromeda_read: {
    key: "andromeda_read",
    label: "Andromeda Read API",
    envVar: "ANDROMEDA_BASE_URL",
    defaultBaseUrl: "https://andromeda-read-api-11974381924.us-central1.run.app",
    keyEnvVars: ["ANDROMEDA_API_KEY"],
    keyHeader: "X-API-Key",
  },
};

export function upstreamBaseUrl(host: UpstreamHostKey): string {
  const spec = UPSTREAM_HOSTS[host];
  const fromEnv = (Deno.env.get(spec.envVar) ?? "").trim().replace(/\/+$/, "");
  return fromEnv || spec.defaultBaseUrl;
}

export function upstreamHeaders(host: UpstreamHostKey): Record<string, string> {
  const spec = UPSTREAM_HOSTS[host];
  const headers: Record<string, string> = { Accept: "application/json" };
  for (const envVar of spec.keyEnvVars) {
    const v = (Deno.env.get(envVar) ?? "").trim();
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

/** ITER46 — a probe outcome that distinguishes "answered well" from "answered". */
export type ProbeOutcome =
  | "RESUELVE"
  | "RESUELVE_GUARDADO"
  | "RESPONDE_CON_ERROR"
  | "NO_EXISTE"
  | "INDETERMINADO"
  | "INALCANZABLE";

export function classifyProbe(
  ep: UpstreamEndpoint,
  status: number,
  body: unknown,
): ProbeOutcome {
  if (status === 404 && !(ep.resolvesOn ?? ROUTE_EXISTS).includes(404)) return "NO_EXISTE";
  if (isGuardedResponse(status)) return "RESUELVE_GUARDADO";
  if (!endpointResolves(ep, status)) return "INALCANZABLE";

  const asserted = ep.assertSuccess ? ep.assertSuccess(body, status) : envelopeOk(body);
  if (asserted === false) return "RESPONDE_CON_ERROR";
  if (asserted === null) return "INDETERMINADO";
  return "RESUELVE";
}

export const UPSTREAM_ENDPOINTS: readonly UpstreamEndpoint[] = [
  {
    key: "cpnu.health",
    host: "cpnu_read",
    method: "GET",
    path: "/health",
    purpose: "Liveness del CPNU Read API",
    assertSuccess: (b) => {
      const s = (b as Record<string, unknown> | null)?.status;
      return typeof s === "string" ? /ok|healthy|up/i.test(s) : envelopeOk(b);
    },
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
    assertSuccess: (b) => {
      const s = (b as Record<string, unknown> | null)?.status;
      return typeof s === "string" ? /ok|healthy|up/i.test(s) : envelopeOk(b);
    },
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
    key: "samai.health",
    host: "samai_read",
    method: "GET",
    path: "/health",
    purpose: "Liveness del SAMAI Read API (expedientes CPACA)",
  },
  {
    key: "samai_estados.health",
    host: "samai_estados",
    method: "GET",
    path: "/health",
    purpose: "Liveness de SAMAI Estados",
  },
  {
    key: "publicaciones.health",
    host: "publicaciones",
    method: "GET",
    path: "/health",
    purpose: "Liveness de Publicaciones Procesales",
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
    key: "andromeda.source_health",
    host: "andromeda_read",
    method: "GET",
    path: "/salud/source-health",
    purpose: "Salud por fuente y rama (CPNU/PP/SAMAI/SAMAI_ESTADOS)",
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
    purpose: "Único escritor de `radicados.activo` upstream",
    resolvesOn: ROUTE_EXISTS,
    probeBody: {},
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