/**
 * Sync Trace Utilities
 * 
 * Client-side helpers for generating trace IDs and fetching traces.
 */

import { supabase } from "@/integrations/supabase/client";

// Generate a new trace ID
export function generateTraceId(): string {
  return crypto.randomUUID();
}

// Trace step names (must match Edge Function)
export const TRACE_STEPS = {
  SYNC_START: "SYNC_START",
  AUTHZ_OK: "AUTHZ_OK",
  AUTHZ_FAILED: "AUTHZ_FAILED",
  WORK_ITEM_LOADED: "WORK_ITEM_LOADED",
  WORK_ITEM_NOT_FOUND: "WORK_ITEM_NOT_FOUND",
  PROVIDER_SELECTED: "PROVIDER_SELECTED",
  PROVIDER_REQUEST_START: "PROVIDER_REQUEST_START",
  PROVIDER_RESPONSE_RECEIVED: "PROVIDER_RESPONSE_RECEIVED",
  PROVIDER_404: "PROVIDER_404",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  PARSE_START: "PARSE_START",
  PARSE_RESULT: "PARSE_RESULT",
  PARSE_EMPTY: "PARSE_EMPTY",
  DB_WRITE_START: "DB_WRITE_START",
  DB_WRITE_RESULT: "DB_WRITE_RESULT",
  DB_WRITE_FAILED: "DB_WRITE_FAILED",
  SYNC_SUCCESS: "SYNC_SUCCESS",
  SYNC_FAILED: "SYNC_FAILED",
} as const;

// Error codes (normalized)
export const ERROR_CODES = {
  WORK_ITEM_NOT_FOUND: "WORK_ITEM_NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  ORG_MISMATCH: "ORG_MISMATCH",
  PROVIDER_404: "PROVIDER_404",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
  PARSER_EMPTY: "PARSER_EMPTY",
  PARSER_ERROR: "PARSER_ERROR",
  DB_WRITE_FAILED: "DB_WRITE_FAILED",
  DB_CONSTRAINT: "DB_CONSTRAINT",
  MISSING_IDENTIFIER: "MISSING_IDENTIFIER",
  INVALID_IDENTIFIER: "INVALID_IDENTIFIER",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export interface SyncTrace {
  id: string;
  trace_id: string;
  work_item_id: string | null;
  organization_id: string | null;
  workflow_type: string | null;
  step: string;
  provider: string | null;
  http_status: number | null;
  latency_ms: number | null;
  success: boolean;
  error_code: string | null;
  message: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

// Fetch traces for a work item
export async function fetchTracesForWorkItem(
  workItemId: string,
  limit = 100
): Promise<SyncTrace[]> {
  const { data, error } = await (supabase
    .from("sync_traces") as any)
    .select("*")
    .eq("work_item_id", workItemId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("[sync-trace] Failed to fetch traces:", error.message);
    return [];
  }

  return (data || []) as SyncTrace[];
}

// Fetch traces by trace_id
export async function fetchTraceById(traceId: string): Promise<SyncTrace[]> {
  const { data, error } = await (supabase
    .from("sync_traces") as any)
    .select("*")
    .eq("trace_id", traceId)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("[sync-trace] Failed to fetch trace:", error.message);
    return [];
  }

  return (data || []) as SyncTrace[];
}

// Get the terminal step from a trace
export function getTraceOutcome(traces: SyncTrace[]): {
  success: boolean;
  step: string;
  errorCode: string | null;
  message: string | null;
} {
  if (traces.length === 0) {
    return { success: false, step: "NO_TRACES", errorCode: null, message: null };
  }

  const lastTrace = traces[traces.length - 1];
  return {
    success: lastTrace.step === TRACE_STEPS.SYNC_SUCCESS,
    step: lastTrace.step,
    errorCode: lastTrace.error_code,
    message: lastTrace.message,
  };
}

// Format error message for UI display
export function formatSyncError(errorCode: string | null, message: string | null): string {
  if (!errorCode && !message) return "Error desconocido";

  const errorLabels: Record<string, string> = {
    WORK_ITEM_NOT_FOUND: "Asunto no encontrado en la base de datos",
    UNAUTHORIZED: "No autorizado para esta operación",
    ORG_MISMATCH: "No perteneces a la organización de este asunto",
    PROVIDER_404: "El proveedor no encontró el proceso (radicado no existe en fuente externa)",
    PROVIDER_NOT_FOUND: "Proceso no encontrado en el proveedor externo",
    RECORD_NOT_FOUND: "El proveedor no encontró el proceso (radicado no existe en fuente externa)",
    PROVIDER_ERROR: "Error al consultar el proveedor externo",
    PROVIDER_TIMEOUT: "Tiempo de espera agotado al consultar proveedor",
    PARSER_EMPTY: "El proveedor respondió pero no devolvió datos",
    PARSER_ERROR: "Error al procesar la respuesta del proveedor",
    DB_WRITE_FAILED: "Error al guardar datos en la base de datos",
    DB_CONSTRAINT: "Violación de restricción en base de datos",
    MISSING_IDENTIFIER: "Falta identificador (radicado o código tutela)",
    MISSING_RADICADO: "Falta radicado (23 dígitos requeridos)",
    INVALID_IDENTIFIER: "Identificador inválido (formato incorrecto)",
    INVALID_RADICADO: "Radicado inválido (debe tener 23 dígitos)",
    INTERNAL_ERROR: "Error interno del servidor",
    // Route/upstream error codes
    UPSTREAM_ROUTE_MISSING: "Ruta del proveedor no encontrada (verificar configuración BASE_URL)",
    UPSTREAM_AUTH: "Error de autenticación con proveedor externo",
    UPSTREAM_FORBIDDEN: "Acceso denegado por el proveedor externo",
    UPSTREAM_UNAVAILABLE: "Proveedor externo no disponible (error 5xx)",
    PROVIDER_NOT_CONFIGURED: "Proveedor no configurado (falta URL base)",
    INVALID_JSON_RESPONSE: "El proveedor retornó respuesta inválida (no JSON)",
    TIMEOUT: "Tiempo de espera agotado",
    NETWORK_ERROR: "Error de red al conectar con proveedor",
    // HTTP error codes
    HTTP_404: "Recurso no encontrado (HTTP 404)",
    HTTP_500: "Error del servidor externo (HTTP 500)",
  };

  const label = errorCode ? errorLabels[errorCode] || errorCode : "";
  const detail = message && message !== label ? ` - ${message}` : "";
  
  return label + detail;
}

// Get provider display name
export function getProviderDisplayName(provider: string | null): string {
  if (!provider) return 'Desconocido';
  
  const names: Record<string, string> = {
    cpnu: 'CPNU (Consulta Nacional)',
    samai: 'SAMAI (Administrativo)',
    'tutelas-api': 'TUTELAS',
    tutelas: 'TUTELAS',
    publicaciones: 'Publicaciones Procesales',
  };
  
  return names[provider.toLowerCase()] || provider.toUpperCase();
}

// Get actionable hint for error codes
export function getErrorHint(errorCode: string | null): string | null {
  if (!errorCode) return null;
  
  const hints: Record<string, string> = {
    UPSTREAM_ROUTE_MISSING: "La ruta no existe en el proveedor. Verifica que CPNU_BASE_URL/SAMAI_BASE_URL apunte al servicio correcto y que CPNU_PATH_PREFIX esté vacío para servicios expuestos en raíz.",
    UPSTREAM_BASE_URL_WRONG: "La URL base del proveedor parece incorrecta. Verifica la configuración de CPNU_BASE_URL o SAMAI_BASE_URL.",
    PROVIDER_NOT_CONFIGURED: "Contacta al administrador para configurar las credenciales del proveedor.",
    RECORD_NOT_FOUND: "El radicado no existe en el sistema judicial externo. Verifica que esté correcto.",
    UPSTREAM_AUTH: "Las credenciales del proveedor externo (EXTERNAL_X_API_KEY) pueden ser inválidas o haber expirado.",
    UPSTREAM_FORBIDDEN: "Acceso denegado por el proveedor externo. Verifica permisos de la API key.",
    TIMEOUT: "El proveedor externo tardó demasiado en responder. Intenta de nuevo más tarde.",
    INVALID_JSON_RESPONSE: "El proveedor retornó una respuesta no-JSON. Puede indicar error de configuración.",
    NETWORK_ERROR: "Error de red al conectar con el proveedor. Verifica conectividad.",
  };
  
  return hints[errorCode] || null;
}
