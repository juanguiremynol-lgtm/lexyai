/**
 * normalizeError.ts — Single source of truth for trace-level error normalization.
 *
 * Imported by: sync-by-work-item (logTrace), atenia-ai-supervisor (diagnostics),
 * atenia-ai-autopilot, process-retry-queue, and any future edge function.
 *
 * This is the CANONICAL normalizer for the `normalized_error_code` column in sync_traces.
 * It maps heterogeneous inputs (raw error codes, HTTP status, message text) into a stable
 * enum that drives the autonomy engine, Ghost Items UI, and Supervisor diagnostics.
 *
 * DO NOT create parallel normalization logic elsewhere. Import this module.
 */

// ────────────────────────────── Canonical Codes ──────────────────────────────

export const NORMALIZED_ERROR_CODES = [
  'PROVIDER_TIMEOUT',
  'PROVIDER_NOT_FOUND',
  'PROVIDER_404',
  'PROVIDER_5XX',
  'PROVIDER_EMPTY_RESULT',
  'NETWORK_ERROR',
  'SNAPSHOT_PARSE_FAILED',
  'EMPTY_RESULTS',
  'EDGE_INVOCATION_FAILED',
  'AUTH_TOKEN_EXPIRED',
  'MISSING_PLATFORM_INSTANCE',
  'MAPPING_NOT_ACTIVE',
  'SCRAPING_TIMEOUT',
  'SCRAPING_STUCK',
  'PROVIDER_RATE_LIMITED',
  'UPSTREAM_AUTH',
  'UPSTREAM_ROUTE_MISSING',
  'UNKNOWN',
] as const;

export type NormalizedErrorCode = typeof NORMALIZED_ERROR_CODES[number];

// ────────────────────────────── Normalizer ──────────────────────────────

/**
 * Maps raw error code + HTTP status + message into a canonical NormalizedErrorCode.
 *
 * Priority: rawCode > message heuristics > httpStatus
 */
export function normalizeTraceError(
  rawCode: string | null | undefined,
  httpStatus: number | null | undefined,
  message: string | null | undefined,
): NormalizedErrorCode {
  const code = (rawCode || '').toUpperCase().replace(/[\s-]+/g, '_');
  const msg = (message || '').toUpperCase();

  // 1. Scraping states (highest priority — these are transient, not failures)
  if (code.includes('SCRAPING_STUCK')) return 'SCRAPING_STUCK';
  if (code.includes('SCRAPING_TIMEOUT') || code.includes('SCRAPING_PENDING') || code.includes('SCRAPING_INITIATED')) return 'SCRAPING_TIMEOUT';

  // 2. External provider architecture codes
  if (code.includes('MISSING_PLATFORM_INSTANCE')) return 'MISSING_PLATFORM_INSTANCE';
  if (code.includes('MAPPING_NOT_ACTIVE') || code.includes('MAPPING_SPEC_MISSING')) return 'MAPPING_NOT_ACTIVE';
  if (code.includes('SNAPSHOT_PARSE') || code.includes('UNPARSABLE')) return 'SNAPSHOT_PARSE_FAILED';

  // 3. Empty results (non-error, non-404)
  if (code.includes('EMPTY_RESULT') || code.includes('EMPTY_SNAPSHOT') || code.includes('PROVIDER_EMPTY') || code.includes('ZERO_RESULTS') || code.includes('NO_RECORDS')) return 'PROVIDER_EMPTY_RESULT';

  // 4. Rate limiting
  if (code.includes('RATE_LIMITED') || code === 'PROVIDER_RATE_LIMITED' || code === 'TOO_MANY_REQUESTS' || httpStatus === 429) return 'PROVIDER_RATE_LIMITED';

  // 5. Auth failures
  if (code.includes('UPSTREAM_AUTH') || code.includes('AUTH_FAILED') || code.includes('AUTH_ERROR') || code.includes('UNAUTHORIZED') || code.includes('FORBIDDEN') || httpStatus === 401 || httpStatus === 403) return 'UPSTREAM_AUTH';

  // 6. Route-level 404 (framework/HTML 404, not record-level)
  if (code.includes('UPSTREAM_ROUTE_MISSING') || code.includes('ROUTE_NOT_FOUND') || code.includes('404_HTML') || code.includes('PROVIDER_ROUTE_NOT_FOUND')) return 'UPSTREAM_ROUTE_MISSING';

  // 7. Record-level not found (domain 404)
  if (code.includes('RECORD_NOT_FOUND') || code === 'NOT_FOUND' || code === 'PROVIDER_404' || code === 'PROVIDER_NOT_FOUND' || code.includes('CASE_NOT_FOUND') || code.includes('EXPEDIENTE_NOT_FOUND')) return 'PROVIDER_NOT_FOUND';

  // 8. Timeouts
  if (code.includes('TIMEOUT') || msg.includes('TIMEOUT') || msg.includes('ABORTED') || msg.includes('ETIMEDOUT') || msg.includes('ECONNABORTED')) return 'PROVIDER_TIMEOUT';

  // 9. Edge function / invocation failures
  if (code.includes('EDGE_FUNCTION_FAILED') || code.includes('FUNCTION_INVOKE_FAILED') || code.includes('FAILED_TO_SEND') || code.includes('CPNU_SYNC_FAILED')) return 'EDGE_INVOCATION_FAILED';

  // 10. Network errors
  if (code.includes('NETWORK') || msg.includes('ECONNREFUSED') || msg.includes('FETCH_FAILED') || msg.includes('DNS') || msg.includes('ENOTFOUND') || code.includes('CONNECTION_REFUSED') || code.includes('FETCH_ERROR')) return 'NETWORK_ERROR';

  // 11. HTTP status fallback
  if (httpStatus === 404) return 'PROVIDER_NOT_FOUND';
  if (httpStatus && httpStatus >= 500) return 'PROVIDER_5XX';

  // 12. Message-based empty results
  if (msg.includes('NO SE ENCONTR') || msg.includes('NO RECORDS') || msg.includes('"TOTAL":0') || msg.includes('"COUNT":0')) return 'EMPTY_RESULTS';

  return 'UNKNOWN';
}

// ────────────────────────────── Labels (Spanish) ──────────────────────────────

const LABELS_ES: Record<NormalizedErrorCode, string> = {
  PROVIDER_TIMEOUT: 'Tiempo de espera excedido',
  PROVIDER_NOT_FOUND: 'Radicado no encontrado',
  PROVIDER_404: 'No encontrado (404)',
  PROVIDER_5XX: 'Error del servidor proveedor',
  PROVIDER_EMPTY_RESULT: 'Sin eventos digitales',
  NETWORK_ERROR: 'Error de red',
  SNAPSHOT_PARSE_FAILED: 'Snapshot no procesable',
  EMPTY_RESULTS: 'Sin resultados',
  EDGE_INVOCATION_FAILED: 'Falla de invocación interna',
  AUTH_TOKEN_EXPIRED: 'Token expirado',
  MISSING_PLATFORM_INSTANCE: 'Sin instancia de plataforma',
  MAPPING_NOT_ACTIVE: 'Mapping en borrador',
  SCRAPING_TIMEOUT: 'Scraping en progreso',
  SCRAPING_STUCK: 'Scraping atascado',
  PROVIDER_RATE_LIMITED: 'Límite de tasa excedido',
  UPSTREAM_AUTH: 'Autenticación fallida',
  UPSTREAM_ROUTE_MISSING: 'Ruta del proveedor no existe',
  UNKNOWN: 'Error no clasificado',
};

export function getErrorLabelEs(code: NormalizedErrorCode | string): string {
  return LABELS_ES[code as NormalizedErrorCode] ?? code;
}

// ────────────────────────────── Recommended Actions (Spanish) ──────────────────────────────

const ACTIONS_ES: Record<NormalizedErrorCode, string> = {
  PROVIDER_TIMEOUT: 'Se reintentará automáticamente. Para casos pesados, separar actuaciones y publicaciones.',
  PROVIDER_NOT_FOUND: 'Verificar radicado. Si persiste, considerar suspender monitoreo.',
  PROVIDER_404: 'Verificar radicado en el portal del proveedor.',
  PROVIDER_5XX: 'Reintentar. Si persiste, verificar estado del proveedor.',
  PROVIDER_EMPTY_RESULT: 'Sin acción. El juzgado no ha digitalizado eventos aún.',
  NETWORK_ERROR: 'Verificar conectividad. Reintento automático programado.',
  SNAPSHOT_PARSE_FAILED: 'Revisar formato de respuesta del proveedor. Puede requerir ajuste de parser.',
  EMPTY_RESULTS: 'Sin acción inmediata. Cooldown de 24h aplicado.',
  EDGE_INVOCATION_FAILED: 'Reintentar publicaciones como tarea separada.',
  AUTH_TOKEN_EXPIRED: 'Refrescar sesión automáticamente.',
  MISSING_PLATFORM_INSTANCE: 'Super Admin debe crear instancia PLATFORM desde el wizard de proveedores.',
  MAPPING_NOT_ACTIVE: 'Activar mapping spec desde el wizard de proveedores.',
  SCRAPING_TIMEOUT: 'Esperar resultado del scraping. Reintento programado automáticamente.',
  SCRAPING_STUCK: 'Investigar con el proveedor. Considerar suspender monitoreo.',
  PROVIDER_RATE_LIMITED: 'Esperar cooldown. No reintentar inmediatamente.',
  UPSTREAM_AUTH: 'Verificar credenciales del proveedor. Escalar a Super Admin.',
  UPSTREAM_ROUTE_MISSING: 'Verificar configuración de ruta/endpoint del proveedor.',
  UNKNOWN: 'Investigar trazas manualmente. Escalar si se repite.',
};

export function getRecommendedActionEs(code: NormalizedErrorCode | string): string {
  return ACTIONS_ES[code as NormalizedErrorCode] ?? 'Investigar manualmente.';
}

// ────────────────────────────── Classification Helpers ──────────────────────────────

const RETRYABLE: Set<NormalizedErrorCode> = new Set([
  'PROVIDER_TIMEOUT', 'PROVIDER_NOT_FOUND', 'PROVIDER_5XX', 'NETWORK_ERROR',
  'EDGE_INVOCATION_FAILED', 'AUTH_TOKEN_EXPIRED', 'SCRAPING_TIMEOUT',
  'PROVIDER_RATE_LIMITED', 'UNKNOWN',
]);

const SUSPENDABLE: Set<NormalizedErrorCode> = new Set([
  'PROVIDER_NOT_FOUND', 'PROVIDER_404', 'EMPTY_RESULTS',
  'PROVIDER_EMPTY_RESULT', 'SCRAPING_STUCK',
]);

export function isRetryable(code: NormalizedErrorCode | string): boolean {
  return RETRYABLE.has(code as NormalizedErrorCode);
}

export function isSuspendable(code: NormalizedErrorCode | string): boolean {
  return SUSPENDABLE.has(code as NormalizedErrorCode);
}
