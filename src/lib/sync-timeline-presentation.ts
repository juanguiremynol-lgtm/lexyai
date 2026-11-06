import { canonicalizeProvider, isProviderAttributable } from "./syncVocabulary";

export type TimelinePresentation = "success" | "error" | "empty" | "skipped" | "partial" |
  "pending_upstream" | "rejected" | "deduplicated" | "unverified";

export function timelinePresentation(row: {
  status: string; provider: string | null; providers?: string[] | null;
  error_code: string | null; metadata?: Record<string, unknown> | null;
}): TimelinePresentation {
  const tokens = canonicalizeProvider(row.providers?.length ? row.providers.join("+") : row.provider).providers;
  if (row.status === "success" || row.status === "empty") {
    if (row.error_code !== null || !isProviderAttributable(tokens)) return "unverified";
    if (row.status === "empty" && row.metadata?.source_complete !== true) return "unverified";
    return row.status;
  }
  if (["error", "skipped", "partial", "pending_upstream", "rejected", "deduplicated"].includes(row.status)) {
    return row.status as TimelinePresentation;
  }
  return "unverified";
}

export function storedReadDetail(metadata?: Record<string, unknown> | null): string | null {
  const read = metadata?.stored_result_read;
  if (!read || typeof read !== "object" || !("reason" in read)) return null;
  const reason = String((read as {reason:unknown}).reason).split(":").pop()?.trim();
  const labels: Record<string, string> = {
    EXTRACCION_DOCUMENTO_NO_VERIFICADA: "No se pudo verificar por completo un documento de la fuente.",
    ENUMERACION_CON_PUBLICACIONES_PARCIAL: "La fuente devolvió una enumeración parcial de publicaciones.",
    AUTHOR_DESPACHO_NOT_RESOLVED: "No se pudo confirmar el despacho en la fuente.",
    FECHA_PLANILLA_CONTRADICTORIA: "La lectura detectó una posible inconsistencia en la fecha de una planilla.",
    NUMERO_PLANILLA_CONTRADICTORIO: "La lectura detectó una posible inconsistencia en el número de una planilla.",
    ESTADO_SIN_DOCUMENTO: "No se recuperó el documento de una publicación.",
    OCR_PAGINAS_INCOMPLETAS: "No se pudieron verificar todas las páginas del documento.",
  };
  return reason ? labels[reason] ?? null : null;
}
