/**
 * Human-readable Spanish labels for procedural deadlines.
 *
 * The engine stores machine `deadline_type` codes and, historically, debug
 * labels shaped like "TRASLADO → TRASLADO_DEMANDA". The UI must never surface
 * those raw strings: it renders the catalog label and keeps the raw type for
 * tooltips / detail views.
 */

export const DEADLINE_TYPE_LABELS: Record<string, string> = {
  TRASLADO_DEMANDA: "Traslado de la demanda",
  TRASLADO_EXCEPCIONES: "Traslado de excepciones",
  EXCEPCIONES_EJECUTIVO: "Traslado de excepciones",
  CONTESTACION_DEMANDA: "Contestación de la demanda",
  RESPUESTA_NOTIFICACION: "Respuesta a notificación",
  RESPUESTA_REQUERIMIENTO: "Respuesta a requerimiento",
  SUBSANACION: "Subsanación",
  IMPUGNACION_TUTELA: "Impugnación de tutela",
  CUMPLIMIENTO_TUTELA: "Cumplimiento del fallo de tutela",
  RECURSO_APELACION_AUTO: "Recurso de apelación (auto)",
  RECURSO_APELACION_SENTENCIA: "Recurso de apelación (sentencia)",
  RECURSO_REPOSICION: "Recurso de reposición",
  RECURSO_SUPLICA: "Recurso de súplica",
  RECURSO_QUEJA: "Recurso de queja",
  AUDIENCIA: "Audiencia",
  PREPARACION_AUDIENCIA: "Preparación de audiencia",
  ALEGATOS: "Alegatos de conclusión",
  CADUCIDAD: "Caducidad del medio de control",
  CONCILIACION_PREJUDICIAL: "Conciliación prejudicial",
  DESPACHO_AUTORITATIVO: "Término fijado por el despacho",
  RESPUESTA_PETICION: "Respuesta a la petición",
  PRORROGA_PETICION: "Prórroga de la petición",
};

/** Strip the legacy "ORIGEN → TIPO" debug shape and normalize casing. */
function cleanRawLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const left = raw.split("→")[0].trim();
  if (!left) return null;
  if (/^[A-Z0-9_]+$/.test(left)) return null; // still a machine code
  return left;
}

/** Preferred human label: catalog → cleaned stored label → prettified code. */
export function formatDeadlineLabel(
  deadlineType: string | null | undefined,
  rawLabel?: string | null,
): string {
  const fromCatalog = deadlineType ? DEADLINE_TYPE_LABELS[deadlineType] : undefined;
  if (fromCatalog) return fromCatalog;
  const cleaned = cleanRawLabel(rawLabel);
  if (cleaned) return cleaned;
  const code = deadlineType ?? rawLabel ?? "Término procesal";
  return code
    .split("→")[0]
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

/** True when the deadline date was computed from a derived desfijación. */
export function isDerivedDate(meta: { desfijacion_source?: string | null } | null | undefined): boolean {
  return meta?.desfijacion_source === "DERIVED_NEXT_BUSINESS_DAY";
}

export const DERIVED_DATE_LABEL = "fecha derivada";

/**
 * Procedural instant of a deadline row — mirrors `work_item_timeline_v`.
 * Never uses updated_at: an old term edited today must still sort by its
 * procedural (trigger) date.
 */
export function deadlineOccurredAt(d: {
  trigger_date?: string | null;
  deadline_date?: string | null;
  created_at?: string | null;
}): string | null {
  return d.trigger_date ?? d.deadline_date ?? d.created_at ?? null;
}
