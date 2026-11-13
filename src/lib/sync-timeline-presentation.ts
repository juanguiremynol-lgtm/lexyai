import { canonicalizeProvider, isProviderAttributable } from "./syncVocabulary";

export type TimelinePresentation = "success" | "error" | "empty" | "skipped" | "partial" |
  "pending_upstream" | "rejected" | "deduplicated" | "unverified" | "window_verified";

export function timelinePresentation(row: {
  status: string; provider: string | null; providers?: string[] | null;
  error_code: string | null; metadata?: Record<string, unknown> | null;
  records_inserted?: number | null; records_skipped?: number | null;
}): TimelinePresentation {
  const tokens = canonicalizeProvider(row.providers?.length ? row.providers.join("+") : row.provider).providers;
  if (row.status === "success" || row.status === "empty") {
    if (row.error_code !== null || !isProviderAttributable(tokens)) return "unverified";
    if (row.metadata?.source_complete === false) return "unverified";
    if (tokens.length === 1 && tokens[0] === "publicaciones") {
      if (row.metadata?.source_complete !== true) return "unverified";
      // Older rows carried a scope certificate but counted retained inventory as results.
      if (row.status === "success" && !row.metadata.pp_window && row.records_inserted === 0 && (row.records_skipped ?? 0) > 0) return "window_verified";
    }
    if (row.status === "empty" && row.metadata?.source_complete !== true) return "unverified";
    return row.status;
  }
  if (["error", "skipped", "partial", "pending_upstream", "rejected", "deduplicated"].includes(row.status)) {
    return row.status as TimelinePresentation;
  }
  return "unverified";
}

export function publicWindowDetail(metadata?: Record<string, unknown> | null): string | null {
  const window = metadata?.pp_window;
  if (!window || typeof window !== "object" || !("from" in window) || !("to" in window) ||
      typeof window.from !== "string" || typeof window.to !== "string") return null;
  const plan = "daily_plan_complete" in window ? window.daily_plan_complete : null;
  const documents = "documents_complete" in window ? window.documents_complete : null;
  return [
    `Ventana pública verificada del ${window.from} al ${window.to}.`,
    plan === true ? "Plan diario completo." : plan === false ? "Plan diario parcial." : "Plan diario sin verificar.",
    documents === true ? "Documentos recuperados." : documents === false ? "Documentos pendientes." : "Recuperación documental sin evaluar.",
  ].join(" ");
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
