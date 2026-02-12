/**
 * Atenia AI Supervisor — Shared Helpers
 *
 * Diagnostics translation, Bogota scheduling windows, and backoff utilities.
 * Used by atenia-ai-supervisor edge function and potentially by frontend services.
 */

// ─── Types ───────────────────────────────────────────────────────────

export type Severity = "INFO" | "WARN" | "CRITICO";

export type DiagnosticCategory =
  | "OMITIDO"
  | "RECORD_NOT_FOUND"
  | "UPSTREAM_AUTH"
  | "UPSTREAM_ROUTE_MISSING"
  | "PROVIDER_TIMEOUT"
  | "FUNCTION_INVOKE_FAILED"
  | "EXTERNAL_SYNC_FAILED"
  | "MISSING_PLATFORM_INSTANCE"
  | "MAPPING_NOT_ACTIVE"
  | "SNAPSHOT_PARSE_FAILED"
  | "UNKNOWN_ERROR";

export interface Diagnostic {
  category: DiagnosticCategory;
  severity: Severity;
  title: string;
  explanation: string;
  next_action: string;
  provider?: string;
  work_item_id?: string;
  workflow_type?: string;
  raw_code?: string;
  evidence?: Record<string, unknown>;
}

// ─── Bogota Day Bounds ───────────────────────────────────────────────

const OFFSET_MS = 5 * 60 * 60 * 1000; // Colombia is UTC-5 (no DST)

/**
 * Returns start/end for "today in Bogota" expressed as UTC instants.
 */
export function bogotaDayBoundsUtc(nowUtc: Date): {
  startUtc: Date;
  endUtc: Date;
  bogotaDateISO: string;
} {
  const bogotaLocal = new Date(nowUtc.getTime() - OFFSET_MS);

  const y = bogotaLocal.getUTCFullYear();
  const m = bogotaLocal.getUTCMonth();
  const d = bogotaLocal.getUTCDate();

  const startUtc = new Date(Date.UTC(y, m, d, 5, 0, 0)); // 00:00 Bogota == 05:00 UTC
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);

  const bogotaDateISO = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { startUtc, endUtc, bogotaDateISO };
}

/**
 * Returns the current Bogota hour (0-23).
 */
export function bogotaHour(nowUtc: Date): number {
  const bogotaLocal = new Date(nowUtc.getTime() - OFFSET_MS);
  return bogotaLocal.getUTCHours();
}

// ─── Backoff ─────────────────────────────────────────────────────────

/**
 * Exponential backoff: 5m → 10m → 20m → 40m → capped at 60m.
 */
export function computeBackoffMinutes(attempts: number): number {
  const base = 5;
  const minutes = base * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(60, Math.round(minutes));
}

// ─── Diagnostics Translator ─────────────────────────────────────────

/**
 * Translates heterogeneous error codes into stable, Spanish diagnostics.
 * This is the canonical translator shared between the edge function and frontend.
 */
export function translateDiagnostic(input: {
  code?: string | null;
  provider?: string | null;
  work_item_id?: string | null;
  workflow_type?: string | null;
  fallbackTitle?: string;
  evidence?: Record<string, unknown>;
}): Diagnostic {
  const code = (input.code ?? "UNKNOWN_ERROR").toUpperCase();
  const provider = input.provider ?? undefined;

  const isNotFound =
    code.includes("RECORD_NOT_FOUND") ||
    code === "NOT_FOUND" ||
    code.includes("NO_RECORD") ||
    code.includes("EMPTY_SNAPSHOT") ||
    code.includes("PROVIDER_404");

  const isTimeout =
    code.includes("TIMEOUT") ||
    code.includes("ETIMEDOUT") ||
    code.includes("ABORT") ||
    code.includes("FETCH_TIMEOUT");

  const isInvokeFail =
    code.includes("FUNCTION_INVOKE_FAILED") ||
    code.includes("EDGE_FUNCTION_FAILED") ||
    code.includes("FAILED_TO_SEND");

  if (code === "OMITIDO") {
    return {
      category: "OMITIDO",
      severity: "WARN",
      title: "Omitido por el orquestador",
      explanation:
        "El asunto no fue procesado en la ventana esperada. Suele indicar starvation, límite de concurrencia o time budget agotado.",
      next_action: "Reintentar (actuaciones + publicaciones) desde cola de remediación.",
      provider,
      work_item_id: input.work_item_id ?? undefined,
      workflow_type: input.workflow_type ?? undefined,
      raw_code: code,
      evidence: input.evidence,
    };
  }

  if (isNotFound) {
    return {
      category: "RECORD_NOT_FOUND",
      severity: "WARN",
      title: "Radicado no encontrado en proveedor",
      explanation:
        "El proveedor respondió como si el radicado no existiera o no estuviera en caché. Si esto persiste en múltiples intentos, corresponde suspender monitoreo para evitar ruido.",
      next_action:
        "Incrementar contador consecutivo; auto-demonitor tras umbral; permitir reactivar manualmente.",
      provider,
      work_item_id: input.work_item_id ?? undefined,
      workflow_type: input.workflow_type ?? undefined,
      raw_code: code,
      evidence: input.evidence,
    };
  }

  if (code.includes("UPSTREAM_AUTH") || code.includes("401") || code.includes("403")) {
    return {
      category: "UPSTREAM_AUTH",
      severity: "CRITICO",
      title: "Autenticación fallida con proveedor",
      explanation:
        "El servicio externo rechaza la API key o credencial. No es un error del usuario final; requiere intervención técnica.",
      next_action: "Ejecutar integration-health y escalar a Super Admin. No reintentar en bucle.",
      provider,
      work_item_id: input.work_item_id ?? undefined,
      workflow_type: input.workflow_type ?? undefined,
      raw_code: code,
      evidence: input.evidence,
    };
  }

  if (
    code.includes("UPSTREAM_ROUTE_MISSING") ||
    code.includes("ROUTE_MISSING") ||
    code.includes("404_HTML")
  ) {
    return {
      category: "UPSTREAM_ROUTE_MISSING",
      severity: "CRITICO",
      title: "Ruta/API del proveedor no existe",
      explanation:
        "El endpoint consultado no existe en el servicio externo (404 tipo HTML / Cannot GET). Esto es configuración/contrato, no datos.",
      next_action:
        "Ejecutar integration-health/debug y corregir path_prefix / contract del proveedor.",
      provider,
      work_item_id: input.work_item_id ?? undefined,
      workflow_type: input.workflow_type ?? undefined,
      raw_code: code,
      evidence: input.evidence,
    };
  }

  if (isTimeout) {
    return {
      category: "PROVIDER_TIMEOUT",
      severity: "WARN",
      title: "Tiempo de espera excedido",
      explanation:
        "La operación tardó más del presupuesto (proveedor lento, post-procesamiento pesado o cold start).",
      next_action:
        "Reintentar con backoff; en PENAL_906 separar actuaciones y publicaciones en tareas dedicadas.",
      provider,
      work_item_id: input.work_item_id ?? undefined,
      workflow_type: input.workflow_type ?? undefined,
      raw_code: code,
      evidence: input.evidence,
    };
  }

  if (isInvokeFail) {
    return {
      category: "FUNCTION_INVOKE_FAILED",
      severity: "WARN",
      title: "Falla invocando Edge Function (encadenamiento)",
      explanation:
        "El orquestador no logró invocar una Edge Function downstream (frecuente cuando se encadena publicaciones después de una sync pesada).",
      next_action: "Reintentar publicaciones como tarea separada (no encadenada).",
      provider,
      work_item_id: input.work_item_id ?? undefined,
      workflow_type: input.workflow_type ?? undefined,
      raw_code: code,
      evidence: input.evidence,
    };
  }

  if (code.includes("MISSING_PLATFORM_INSTANCE")) {
    return {
      category: "MISSING_PLATFORM_INSTANCE",
      severity: "WARN",
      title: "Sin instancia de plataforma configurada",
      explanation:
        "Una ruta GLOBAL está activa pero no existe una instancia PLATFORM habilitada para el conector. Requiere intervención de Super Admin.",
      next_action: "Crear instancia PLATFORM desde el wizard de proveedores externos.",
      provider,
      work_item_id: input.work_item_id ?? undefined,
      workflow_type: input.workflow_type ?? undefined,
      raw_code: code,
      evidence: input.evidence,
    };
  }

  if (code.includes("MAPPING_NOT_ACTIVE") || code.includes("MAPPING_SPEC_MISSING")) {
    return {
      category: "MAPPING_NOT_ACTIVE",
      severity: "WARN",
      title: "Mapping en borrador o no configurado",
      explanation:
        "Los datos se ingestan sin transformación porque el mapping spec está en DRAFT o no existe.",
      next_action: "Activar el mapping spec desde el wizard de proveedores.",
      provider,
      work_item_id: input.work_item_id ?? undefined,
      workflow_type: input.workflow_type ?? undefined,
      raw_code: code,
      evidence: input.evidence,
    };
  }

  if (code.includes("SNAPSHOT_PARSE_FAILED") || code.includes("UNPARSABLE")) {
    return {
      category: "SNAPSHOT_PARSE_FAILED",
      severity: "CRITICO",
      title: "Snapshot del proveedor no procesable",
      explanation:
        "El snapshot recibido no pudo ser parseado. El proveedor puede haber cambiado su formato de respuesta.",
      next_action:
        "Revisar la respuesta cruda en el panel de depuración y ajustar el parser/mapping.",
      provider,
      work_item_id: input.work_item_id ?? undefined,
      workflow_type: input.workflow_type ?? undefined,
      raw_code: code,
      evidence: input.evidence,
    };
  }

  return {
    category: "UNKNOWN_ERROR",
    severity: "WARN",
    title: input.fallbackTitle ?? "Error no clasificado",
    explanation:
      "No encaja en categorías conocidas. Requiere inspección de trazas y payloads (sin secretos).",
    next_action: "Agregar evidencia y escalar si se repite.",
    provider,
    work_item_id: input.work_item_id ?? undefined,
    workflow_type: input.workflow_type ?? undefined,
    raw_code: code,
    evidence: input.evidence,
  };
}
