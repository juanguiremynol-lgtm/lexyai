/**
 * Normalized Error Taxonomy for Atenia Sync System
 *
 * Single shared error normalization module used by:
 * - Frontend services (autonomy engine, diagnostics)
 * - Supervisor panel display
 * - Mirrors the Deno shared helper (ateniaAiSupervisor.ts) for edge functions
 *
 * This is the frontend-side canonical error normalizer.
 */

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

/** Whether a body looks like an HTML page (framework-level 404) */
function isHtmlBody(body: string | null | undefined): boolean {
  if (!body) return false;
  const lower = body.slice(0, 200).toLowerCase();
  return lower.includes('<!doctype') || lower.includes('<html') || lower.includes('cannot get');
}

/** Whether the error string indicates a timeout */
function isTimeoutError(str: string): boolean {
  const upper = str.toUpperCase();
  return upper.includes('TIMEOUT') ||
    upper.includes('ETIMEDOUT') ||
    upper.includes('ABORT') ||
    upper.includes('FETCH_TIMEOUT') ||
    upper.includes('ECONNABORTED');
}

/** Whether the error string indicates a network failure */
function isNetworkError(str: string): boolean {
  const upper = str.toUpperCase();
  return upper.includes('ECONNREFUSED') ||
    upper.includes('ENOTFOUND') ||
    upper.includes('NETWORK') ||
    upper.includes('ERR_NETWORK') ||
    upper.includes('FETCH_FAILED') ||
    upper.includes('DNS');
}

/**
 * Normalizes heterogeneous error inputs into a stable NormalizedErrorCode.
 *
 * Priority: rawCode > thrownError > responseStatus > bodyText
 */
export function normalizeError(input: NormalizeErrorInput): NormalizedResult {
  const {
    provider,
    route,
    responseStatus,
    bodyText,
    thrownError,
    rawCode,
  } = input;

  const bodyPreview = bodyText ? bodyText.slice(0, 200) : undefined;
  const baseMeta = {
    provider: provider ?? undefined,
    route: route ?? undefined,
    httpStatus: responseStatus ?? undefined,
    bodyPreview,
    rawCode: rawCode ?? undefined,
  };

  // 1. Check rawCode first (already classified by upstream)
  if (rawCode) {
    const upper = rawCode.toUpperCase();

    if (upper.includes('PROVIDER_EMPTY_RESULT') || upper.includes('EMPTY_SNAPSHOT')) {
      return { code: NormalizedErrorCode.PROVIDER_EMPTY_RESULT, meta: { ...baseMeta, label_es: 'Sin eventos digitales', retryable: false, suspendable: false } };
    }
    if (upper.includes('SCRAPING_STUCK')) {
      return { code: NormalizedErrorCode.SCRAPING_STUCK, meta: { ...baseMeta, label_es: 'Scraping atascado', retryable: false, suspendable: true } };
    }
    if (upper.includes('SCRAPING_TIMEOUT') || upper.includes('SCRAPING_PENDING')) {
      return { code: NormalizedErrorCode.SCRAPING_TIMEOUT, meta: { ...baseMeta, label_es: 'Scraping en progreso', retryable: true, suspendable: false } };
    }
    if (upper.includes('RATE_LIMITED') || upper === '429') {
      return { code: NormalizedErrorCode.PROVIDER_RATE_LIMITED, meta: { ...baseMeta, label_es: 'Límite de tasa excedido', retryable: true, suspendable: false } };
    }
    if (upper.includes('MISSING_PLATFORM_INSTANCE')) {
      return { code: NormalizedErrorCode.MISSING_PLATFORM_INSTANCE, meta: { ...baseMeta, label_es: 'Sin instancia de plataforma', retryable: false, suspendable: false } };
    }
    if (upper.includes('MAPPING_NOT_ACTIVE') || upper.includes('MAPPING_SPEC_MISSING')) {
      return { code: NormalizedErrorCode.MAPPING_NOT_ACTIVE, meta: { ...baseMeta, label_es: 'Mapping en borrador', retryable: false, suspendable: false } };
    }
    if (upper.includes('SNAPSHOT_PARSE') || upper.includes('UNPARSABLE')) {
      return { code: NormalizedErrorCode.SNAPSHOT_PARSE_FAILED, meta: { ...baseMeta, label_es: 'Snapshot no procesable', retryable: false, suspendable: false } };
    }
    if (upper.includes('UPSTREAM_AUTH') || upper.includes('401') || upper.includes('403')) {
      return { code: NormalizedErrorCode.UPSTREAM_AUTH, meta: { ...baseMeta, label_es: 'Autenticación fallida', retryable: false, suspendable: false } };
    }
    if (upper.includes('UPSTREAM_ROUTE_MISSING') || upper.includes('ROUTE_MISSING') || upper.includes('404_HTML')) {
      return { code: NormalizedErrorCode.UPSTREAM_ROUTE_MISSING, meta: { ...baseMeta, label_es: 'Ruta del proveedor no existe', retryable: false, suspendable: false } };
    }
    if (upper.includes('RECORD_NOT_FOUND') || upper === 'NOT_FOUND' || upper.includes('NO_RECORD') || upper.includes('PROVIDER_404')) {
      return { code: NormalizedErrorCode.PROVIDER_NOT_FOUND, meta: { ...baseMeta, label_es: 'Radicado no encontrado', retryable: true, suspendable: true } };
    }
    if (isTimeoutError(upper)) {
      return { code: NormalizedErrorCode.PROVIDER_TIMEOUT, meta: { ...baseMeta, label_es: 'Tiempo de espera excedido', retryable: true, suspendable: false } };
    }
    if (upper.includes('FUNCTION_INVOKE_FAILED') || upper.includes('EDGE_FUNCTION_FAILED') || upper.includes('FAILED_TO_SEND')) {
      return { code: NormalizedErrorCode.EDGE_INVOCATION_FAILED, meta: { ...baseMeta, label_es: 'Falla de invocación interna', retryable: true, suspendable: false } };
    }
    if (isNetworkError(upper)) {
      return { code: NormalizedErrorCode.NETWORK_ERROR, meta: { ...baseMeta, label_es: 'Error de red', retryable: true, suspendable: false } };
    }
  }

  // 2. Check thrown error string
  if (thrownError) {
    if (isTimeoutError(thrownError)) {
      return { code: NormalizedErrorCode.PROVIDER_TIMEOUT, meta: { ...baseMeta, label_es: 'Tiempo de espera excedido', retryable: true, suspendable: false } };
    }
    if (isNetworkError(thrownError)) {
      return { code: NormalizedErrorCode.NETWORK_ERROR, meta: { ...baseMeta, label_es: 'Error de red', retryable: true, suspendable: false } };
    }
    if (thrownError.toUpperCase().includes('AUTH') || thrownError.toUpperCase().includes('TOKEN')) {
      return { code: NormalizedErrorCode.AUTH_TOKEN_EXPIRED, meta: { ...baseMeta, label_es: 'Token expirado', retryable: true, suspendable: false } };
    }
  }

  // 3. Check HTTP status
  if (responseStatus) {
    if (responseStatus === 401 || responseStatus === 403) {
      return { code: NormalizedErrorCode.UPSTREAM_AUTH, meta: { ...baseMeta, label_es: 'Autenticación fallida', retryable: false, suspendable: false } };
    }
    if (responseStatus === 404) {
      if (isHtmlBody(bodyText)) {
        return { code: NormalizedErrorCode.UPSTREAM_ROUTE_MISSING, meta: { ...baseMeta, label_es: 'Ruta del proveedor no existe', retryable: false, suspendable: false } };
      }
      return { code: NormalizedErrorCode.PROVIDER_NOT_FOUND, meta: { ...baseMeta, label_es: 'Radicado no encontrado', retryable: true, suspendable: true } };
    }
    if (responseStatus === 429) {
      return { code: NormalizedErrorCode.PROVIDER_RATE_LIMITED, meta: { ...baseMeta, label_es: 'Límite de tasa excedido', retryable: true, suspendable: false } };
    }
    if (responseStatus >= 500) {
      return { code: NormalizedErrorCode.PROVIDER_5XX, meta: { ...baseMeta, label_es: 'Error del servidor proveedor', retryable: true, suspendable: false } };
    }
  }

  // 4. Check body for empty results
  if (bodyText) {
    const lower = bodyText.toLowerCase();
    if (lower.includes('no se encontr') || lower.includes('no records') || lower.includes('"total":0') || lower.includes('"count":0')) {
      return { code: NormalizedErrorCode.EMPTY_RESULTS, meta: { ...baseMeta, label_es: 'Sin resultados', retryable: false, suspendable: true } };
    }
  }

  return { code: NormalizedErrorCode.UNKNOWN, meta: { ...baseMeta, label_es: 'Error desconocido', retryable: true, suspendable: false } };
}

/** Quick check: is this error code retryable? */
export function isRetryable(code: NormalizedErrorCode): boolean {
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
  ].includes(code);
}

/** Quick check: should repeated occurrences trigger auto-suspend? */
export function isSuspendable(code: NormalizedErrorCode): boolean {
  return [
    NormalizedErrorCode.PROVIDER_NOT_FOUND,
    NormalizedErrorCode.PROVIDER_404,
    NormalizedErrorCode.EMPTY_RESULTS,
    NormalizedErrorCode.PROVIDER_EMPTY_RESULT,
    NormalizedErrorCode.SCRAPING_STUCK,
  ].includes(code);
}

/** Spanish label for display */
export function getErrorLabel(code: NormalizedErrorCode): string {
  const labels: Record<NormalizedErrorCode, string> = {
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
  return labels[code] ?? code;
}

/** Recommended action text in Spanish */
export function getRecommendedAction(code: NormalizedErrorCode): string {
  const actions: Record<NormalizedErrorCode, string> = {
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
  return actions[code] ?? 'Investigar manualmente.';
}
