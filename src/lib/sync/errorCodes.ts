/**
 * Normalized Error Taxonomy for Atenia Sync System (Frontend)
 *
 * This module mirrors the canonical _shared/normalizeError.ts used in edge functions.
 * Both modules MUST stay in sync. Any new error code added to one must be added to both.
 *
 * Used by:
 * - Supervisor panel (AteniaGhostItems, diagnostics)
 * - WorkItem monitoring badges
 * - Autonomy engine (frontend orchestration)
 *
 * DO NOT add normalization logic elsewhere in the frontend.
 */

// ────────────────────────────── Canonical Codes ──────────────────────────────

export enum NormalizedErrorCode {
  PROVIDER_TIMEOUT = 'PROVIDER_TIMEOUT',
  PROVIDER_NOT_FOUND = 'PROVIDER_NOT_FOUND',
  PROVIDER_404 = 'PROVIDER_404',
  PROVIDER_5XX = 'PROVIDER_5XX',
  PROVIDER_EMPTY_RESULT = 'PROVIDER_EMPTY_RESULT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  SNAPSHOT_PARSE_FAILED = 'SNAPSHOT_PARSE_FAILED',
  EMPTY_RESULTS = 'EMPTY_RESULTS',
  EDGE_INVOCATION_FAILED = 'EDGE_INVOCATION_FAILED',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  MISSING_PLATFORM_INSTANCE = 'MISSING_PLATFORM_INSTANCE',
  MAPPING_NOT_ACTIVE = 'MAPPING_NOT_ACTIVE',
  SCRAPING_TIMEOUT = 'SCRAPING_TIMEOUT',
  SCRAPING_STUCK = 'SCRAPING_STUCK',
  PROVIDER_RATE_LIMITED = 'PROVIDER_RATE_LIMITED',
  UPSTREAM_AUTH = 'UPSTREAM_AUTH',
  UPSTREAM_ROUTE_MISSING = 'UPSTREAM_ROUTE_MISSING',
  UNKNOWN = 'UNKNOWN',
}

// ────────────────────────────── Input / Output Types ──────────────────────────────

export interface NormalizeErrorInput {
  provider?: string | null;
  route?: string | null;
  responseStatus?: number | null;
  bodyText?: string | null;
  thrownError?: string | null;
  rawCode?: string | null;
}

export interface NormalizedResult {
  code: NormalizedErrorCode;
  meta: {
    provider?: string;
    route?: string;
    httpStatus?: number;
    bodyPreview?: string;
    rawCode?: string;
    label_es: string;
    retryable: boolean;
    suspendable: boolean;
  };
}

// ────────────────────────────── Helpers ──────────────────────────────

function isHtmlBody(body: string | null | undefined): boolean {
  if (!body) return false;
  const lower = body.slice(0, 200).toLowerCase();
  return lower.includes('<!doctype') || lower.includes('<html') || lower.includes('cannot get');
}

function isTimeoutError(str: string): boolean {
  const upper = str.toUpperCase();
  return upper.includes('TIMEOUT') ||
    upper.includes('ETIMEDOUT') ||
    upper.includes('ABORT') ||
    upper.includes('FETCH_TIMEOUT') ||
    upper.includes('ECONNABORTED');
}

function isNetworkError(str: string): boolean {
  const upper = str.toUpperCase();
  return upper.includes('ECONNREFUSED') ||
    upper.includes('ENOTFOUND') ||
    upper.includes('NETWORK') ||
    upper.includes('ERR_NETWORK') ||
    upper.includes('FETCH_FAILED') ||
    upper.includes('DNS');
}

// ────────────────────────────── Normalizer ──────────────────────────────

/**
 * Normalizes heterogeneous error inputs into a stable NormalizedErrorCode.
 * Priority: rawCode > thrownError > responseStatus > bodyText
 *
 * This logic MUST match _shared/normalizeError.ts::normalizeTraceError()
 */
export function normalizeError(input: NormalizeErrorInput): NormalizedResult {
  const {
    provider, route, responseStatus, bodyText, thrownError, rawCode,
  } = input;

  const bodyPreview = bodyText ? bodyText.slice(0, 200) : undefined;
  const baseMeta = {
    provider: provider ?? undefined,
    route: route ?? undefined,
    httpStatus: responseStatus ?? undefined,
    bodyPreview,
    rawCode: rawCode ?? undefined,
  };

  const make = (code: NormalizedErrorCode): NormalizedResult => ({
    code,
    meta: { ...baseMeta, label_es: getErrorLabel(code), retryable: isRetryable(code), suspendable: isSuspendable(code) },
  });

  // 1. rawCode first
  if (rawCode) {
    const upper = rawCode.toUpperCase().replace(/[\s-]+/g, '_');
    if (upper.includes('SCRAPING_STUCK')) return make(NormalizedErrorCode.SCRAPING_STUCK);
    if (upper.includes('SCRAPING_TIMEOUT') || upper.includes('SCRAPING_PENDING') || upper.includes('SCRAPING_INITIATED')) return make(NormalizedErrorCode.SCRAPING_TIMEOUT);
    if (upper.includes('PROVIDER_EMPTY_RESULT') || upper.includes('EMPTY_SNAPSHOT') || upper.includes('ZERO_RESULTS') || upper.includes('NO_RECORDS')) return make(NormalizedErrorCode.PROVIDER_EMPTY_RESULT);
    if (upper.includes('MISSING_PLATFORM_INSTANCE')) return make(NormalizedErrorCode.MISSING_PLATFORM_INSTANCE);
    if (upper.includes('MAPPING_NOT_ACTIVE') || upper.includes('MAPPING_SPEC_MISSING')) return make(NormalizedErrorCode.MAPPING_NOT_ACTIVE);
    if (upper.includes('SNAPSHOT_PARSE') || upper.includes('UNPARSABLE')) return make(NormalizedErrorCode.SNAPSHOT_PARSE_FAILED);
    if (upper.includes('RATE_LIMITED') || upper === '429' || upper === 'TOO_MANY_REQUESTS') return make(NormalizedErrorCode.PROVIDER_RATE_LIMITED);
    if (upper.includes('UPSTREAM_AUTH') || upper.includes('401') || upper.includes('403') || upper.includes('AUTH_ERROR') || upper.includes('UNAUTHORIZED')) return make(NormalizedErrorCode.UPSTREAM_AUTH);
    if (upper.includes('UPSTREAM_ROUTE_MISSING') || upper.includes('ROUTE_MISSING') || upper.includes('404_HTML') || upper.includes('PROVIDER_ROUTE_NOT_FOUND')) return make(NormalizedErrorCode.UPSTREAM_ROUTE_MISSING);
    if (upper.includes('RECORD_NOT_FOUND') || upper === 'NOT_FOUND' || upper.includes('NO_RECORD') || upper.includes('PROVIDER_404') || upper.includes('PROVIDER_NOT_FOUND') || upper.includes('CASE_NOT_FOUND') || upper.includes('EXPEDIENTE_NOT_FOUND')) return make(NormalizedErrorCode.PROVIDER_NOT_FOUND);
    if (isTimeoutError(upper)) return make(NormalizedErrorCode.PROVIDER_TIMEOUT);
    if (upper.includes('FUNCTION_INVOKE_FAILED') || upper.includes('EDGE_FUNCTION_FAILED') || upper.includes('FAILED_TO_SEND') || upper.includes('CPNU_SYNC_FAILED')) return make(NormalizedErrorCode.EDGE_INVOCATION_FAILED);
    if (isNetworkError(upper)) return make(NormalizedErrorCode.NETWORK_ERROR);
  }

  // 2. thrownError
  if (thrownError) {
    if (isTimeoutError(thrownError)) return make(NormalizedErrorCode.PROVIDER_TIMEOUT);
    if (isNetworkError(thrownError)) return make(NormalizedErrorCode.NETWORK_ERROR);
    if (thrownError.toUpperCase().includes('AUTH') || thrownError.toUpperCase().includes('TOKEN')) return make(NormalizedErrorCode.AUTH_TOKEN_EXPIRED);
  }

  // 3. HTTP status
  if (responseStatus) {
    if (responseStatus === 401 || responseStatus === 403) return make(NormalizedErrorCode.UPSTREAM_AUTH);
    if (responseStatus === 404) {
      return isHtmlBody(bodyText) ? make(NormalizedErrorCode.UPSTREAM_ROUTE_MISSING) : make(NormalizedErrorCode.PROVIDER_NOT_FOUND);
    }
    if (responseStatus === 429) return make(NormalizedErrorCode.PROVIDER_RATE_LIMITED);
    if (responseStatus >= 500) return make(NormalizedErrorCode.PROVIDER_5XX);
  }

  // 4. bodyText
  if (bodyText) {
    const lower = bodyText.toLowerCase();
    if (lower.includes('no se encontr') || lower.includes('no records') || lower.includes('"total":0') || lower.includes('"count":0')) return make(NormalizedErrorCode.EMPTY_RESULTS);
  }

  return make(NormalizedErrorCode.UNKNOWN);
}

// ────────────────────────────── Labels (Spanish) ──────────────────────────────

const LABELS_ES: Record<NormalizedErrorCode, string> = {
  [NormalizedErrorCode.PROVIDER_TIMEOUT]: 'Tiempo de espera excedido',
  [NormalizedErrorCode.PROVIDER_NOT_FOUND]: 'Radicado no encontrado',
  [NormalizedErrorCode.PROVIDER_404]: 'No encontrado (404)',
  [NormalizedErrorCode.PROVIDER_5XX]: 'Error del servidor proveedor',
  [NormalizedErrorCode.PROVIDER_EMPTY_RESULT]: 'Sin eventos digitales',
  [NormalizedErrorCode.NETWORK_ERROR]: 'Error de red',
  [NormalizedErrorCode.SNAPSHOT_PARSE_FAILED]: 'Snapshot no procesable',
  [NormalizedErrorCode.EMPTY_RESULTS]: 'Sin resultados',
  [NormalizedErrorCode.EDGE_INVOCATION_FAILED]: 'Falla de invocación interna',
  [NormalizedErrorCode.AUTH_TOKEN_EXPIRED]: 'Token expirado',
  [NormalizedErrorCode.MISSING_PLATFORM_INSTANCE]: 'Sin instancia de plataforma',
  [NormalizedErrorCode.MAPPING_NOT_ACTIVE]: 'Mapping en borrador',
  [NormalizedErrorCode.SCRAPING_TIMEOUT]: 'Scraping en progreso',
  [NormalizedErrorCode.SCRAPING_STUCK]: 'Scraping atascado',
  [NormalizedErrorCode.PROVIDER_RATE_LIMITED]: 'Límite de tasa excedido',
  [NormalizedErrorCode.UPSTREAM_AUTH]: 'Autenticación fallida',
  [NormalizedErrorCode.UPSTREAM_ROUTE_MISSING]: 'Ruta no existe',
  [NormalizedErrorCode.UNKNOWN]: 'Error desconocido',
};

export function getErrorLabel(code: NormalizedErrorCode | string): string {
  return LABELS_ES[code as NormalizedErrorCode] ?? code;
}

// ────────────────────────────── Recommended Actions ──────────────────────────────

const ACTIONS_ES: Record<NormalizedErrorCode, string> = {
  [NormalizedErrorCode.PROVIDER_TIMEOUT]: 'Reintentar con backoff. Para casos pesados, separar actuaciones y publicaciones.',
  [NormalizedErrorCode.PROVIDER_NOT_FOUND]: 'Verificar radicado. Si persiste, suspender monitoreo.',
  [NormalizedErrorCode.PROVIDER_404]: 'Verificar radicado en el portal del proveedor.',
  [NormalizedErrorCode.PROVIDER_5XX]: 'Reintentar. Si persiste, verificar estado del proveedor.',
  [NormalizedErrorCode.PROVIDER_EMPTY_RESULT]: 'Sin acción. El juzgado no ha digitalizado eventos aún.',
  [NormalizedErrorCode.NETWORK_ERROR]: 'Verificar conectividad. Reintentar automáticamente.',
  [NormalizedErrorCode.SNAPSHOT_PARSE_FAILED]: 'Revisar formato de respuesta del proveedor. Puede requerir ajuste de parser.',
  [NormalizedErrorCode.EMPTY_RESULTS]: 'Sin acción inmediata. Cooldown de 24h aplicado.',
  [NormalizedErrorCode.EDGE_INVOCATION_FAILED]: 'Reintentar publicaciones como tarea separada.',
  [NormalizedErrorCode.AUTH_TOKEN_EXPIRED]: 'Refrescar sesión automáticamente.',
  [NormalizedErrorCode.MISSING_PLATFORM_INSTANCE]: 'Super Admin debe crear instancia PLATFORM desde el wizard.',
  [NormalizedErrorCode.MAPPING_NOT_ACTIVE]: 'Activar mapping spec desde el wizard de proveedores.',
  [NormalizedErrorCode.SCRAPING_TIMEOUT]: 'Esperar resultado. Reintento programado automáticamente.',
  [NormalizedErrorCode.SCRAPING_STUCK]: 'Investigar con el proveedor. Considerar suspender monitoreo.',
  [NormalizedErrorCode.PROVIDER_RATE_LIMITED]: 'Esperar cooldown. No reintentar inmediatamente.',
  [NormalizedErrorCode.UPSTREAM_AUTH]: 'Verificar credenciales del proveedor. Escalar a Super Admin.',
  [NormalizedErrorCode.UPSTREAM_ROUTE_MISSING]: 'Verificar configuración de ruta/endpoint del proveedor.',
  [NormalizedErrorCode.UNKNOWN]: 'Investigar trazas manualmente. Escalar si se repite.',
};

export function getRecommendedAction(code: NormalizedErrorCode | string): string {
  return ACTIONS_ES[code as NormalizedErrorCode] ?? 'Investigar manualmente.';
}

// ────────────────────────────── Classification Helpers ──────────────────────────────

export function isRetryable(code: NormalizedErrorCode | string): boolean {
  return [
    NormalizedErrorCode.PROVIDER_TIMEOUT,
    NormalizedErrorCode.PROVIDER_NOT_FOUND,
    NormalizedErrorCode.PROVIDER_5XX,
    NormalizedErrorCode.NETWORK_ERROR,
    NormalizedErrorCode.EDGE_INVOCATION_FAILED,
    NormalizedErrorCode.AUTH_TOKEN_EXPIRED,
    NormalizedErrorCode.SCRAPING_TIMEOUT,
    NormalizedErrorCode.PROVIDER_RATE_LIMITED,
    NormalizedErrorCode.UNKNOWN,
  ].includes(code as NormalizedErrorCode);
}

export function isSuspendable(code: NormalizedErrorCode | string): boolean {
  return [
    NormalizedErrorCode.PROVIDER_NOT_FOUND,
    NormalizedErrorCode.PROVIDER_404,
    NormalizedErrorCode.EMPTY_RESULTS,
    NormalizedErrorCode.PROVIDER_EMPTY_RESULT,
    NormalizedErrorCode.SCRAPING_STUCK,
  ].includes(code as NormalizedErrorCode);
}
