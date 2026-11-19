/**
 * Administrative record for PETICION matters.
 * Terms are computed server-side (peticion_register_presentation) from the
 * documented presentation date: no authority receipt, acknowledgement or
 * official number is required to start the operative calculation. The
 * presentation date is never presented as proof of receipt.
 */
export const PETICION_SUBTYPES = [
  { code: "GENERAL", label: "Interés general o particular" },
  { code: "DOCUMENTOS_INFORMACION", label: "Documentos e información" },
  { code: "CONSULTA", label: "Consulta" },
  { code: "ENTRE_AUTORIDADES_INFO_DOCUMENTOS", label: "Entre autoridades" },
] as const;

export const PETICION_COMPONENTS = [
  { code: "DOCUMENTOS_INFORMACION", label: "Documentos e información", days: 10 },
  { code: "GENERAL_INTERVENCION", label: "Petición general / intervención", days: 15 },
  { code: "CONSULTA", label: "Consulta jurídica (solo consultas reales)", days: 30 },
  { code: "ESPECIAL", label: "Régimen especial (revisión manual)", days: null },
] as const;
export type PeticionComponent = (typeof PETICION_COMPONENTS)[number]["code"];

export const PRESENTATION_SOURCES = [
  { code: "USUARIO_DECLARADO", label: "Declarada por el usuario" },
  { code: "OUTLOOK", label: "Correo vinculado de Outlook" },
  { code: "PLATAFORMA", label: "Constancia de plataforma" },
] as const;

export const MANUAL_EVENT_CODES = [
  { code: "ACUSE_RECIBO_CONFIRMADO", label: "Acuse de recibo confirmado" },
  { code: "RADICADO_OFICIAL_ASIGNADO", label: "Radicado oficial asignado" },
  { code: "TRASLADO_COMPETENCIA", label: "Traslado por competencia" },
  { code: "REQUERIMIENTO_RECIBIDO", label: "Requerimiento recibido" },
  { code: "NOTA", label: "Nota / evidencia" },
] as const;

export const EVENT_LABELS: Record<string, string> = {
  ...Object.fromEntries(MANUAL_EVENT_CODES.map((e) => [e.code, e.label])),
  EMAIL_ENVIO_OBSERVADO: "Envío observado en Outlook",
  EMAIL_NOVEDAD_PROPUESTA: "Correo recibido por revisar",
  RESPONSE_TERM_EXPIRED: "Término de respuesta vencido",
  PRESENTACION_REGISTRADA: "Presentación registrada",
  FECHA_BASE_CORREGIDA: "Fecha base corregida",
  TERMINO_OPERATIVO_GENERADO: "Plazo generado",
  PRORROGA_COMUNICADA: "Prórroga comunicada",
  RESPUESTA_PARCIAL: "Respuesta parcial",
  RESPUESTA_DE_FONDO: "Respuesta de fondo (revisada)",
  TUTELA_EVALUACION_SUGERIDA: "Evaluar tutela o revisión",
  ACEPTACION_FICTA_POR_REVISAR: "Posible aceptación ficta (revisar)",
  SILENCIO_NEGATIVO_POR_REVISAR: "Posible silencio negativo (revisar)",
  REGISTRO_ACTUALIZADO: "Datos actualizados",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface PresentationForm {
  presented_on: string;
  source: string;
  support: string;
  components: string[];
  reason: string;
  email_link_id: string | null;
}

export interface CurrentAnchor {
  sent_at: string | null;
  components: string[];
  anchor_version: number;
  anchor_source: string | null;
}

export function getPresentationAnchorMode(current: CurrentAnchor | null): "new" | "legacy" | "documented" {
  if (current?.anchor_source === "PRESENTACION_DOCUMENTADA") return "documented";
  return current?.anchor_source != null ? "legacy" : "new";
}

/** Client-side mirror of the server checks; the RPC remains authoritative. */
export function validatePresentation(f: PresentationForm, today: string, current: CurrentAnchor | null): string[] {
  const errors: string[] = [];
  if (!f.presented_on) errors.push("Indique la fecha de presentación (no se infiere de la fecha de creación del asunto).");
  else if (!DATE_RE.test(f.presented_on)) errors.push("Fecha de presentación inválida.");
  else if (f.presented_on > today) errors.push("La fecha de presentación no puede ser futura.");
  if (!PRESENTATION_SOURCES.some((s) => s.code === f.source)) errors.push("Seleccione el origen de la fecha.");
  if (f.source === "OUTLOOK" && !f.email_link_id) errors.push("Para usar Outlook como origen, vincule primero el correo enviado.");
  if (!f.support.trim()) errors.push("Describa el soporte de la presentación (correo enviado, constancia de plataforma…).");
  if (f.support.length > 1000) errors.push("Soporte demasiado largo.");
  if (f.components.length === 0) errors.push("Seleccione al menos un componente de la petición.");
  if (f.components.some((c) => !PETICION_COMPONENTS.some((p) => p.code === c))) errors.push("Componente inválido.");
  const mode = getPresentationAnchorMode(current);
  const requiresReason = mode === "legacy" || (mode === "documented" && current != null &&
    (current.sent_at !== f.presented_on || current.components.some((c) => !f.components.includes(c))));
  if (requiresReason && !f.reason.trim()) {
    errors.push("Indique el motivo de la corrección (rebote, fecha real distinta, traslado…).");
  }
  return errors;
}

export function buildPresentationRpcArgs(workItemId: string, f: PresentationForm, current: CurrentAnchor | null, createTasks = true) {
  return {
    p_work_item_id: workItemId,
    p_presented_on: f.presented_on,
    p_source: f.source,
    p_support: f.support.trim(),
    p_components: [...new Set(f.components)].sort(),
    p_reason: f.reason.trim() || null,
    p_expected_version: getPresentationAnchorMode(current) !== "new" ? current?.anchor_version ?? null : null,
    p_create_tasks: createTasks,
    p_email_link_id: f.email_link_id,
  };
}

/** Authority metadata only; never touches anchor or term fields. */
export interface AuthorityForm {
  authority_name: string;
  authority_email_domain: string;
  authority_radicado: string;
}

export function validateAuthority(f: AuthorityForm): string[] {
  const errors: string[] = [];
  if (f.authority_radicado.length > 60) errors.push("Radicado oficial demasiado largo.");
  if (f.authority_email_domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(f.authority_email_domain)) errors.push("Dominio de correo inválido.");
  if (f.authority_name.length > 300) errors.push("Nombre de autoridad demasiado largo.");
  return errors;
}

export function buildAuthorityPayload(f: AuthorityForm, ids: { work_item_id: string; owner_id: string; organization_id: string | null }) {
  return {
    ...ids,
    authority_name: f.authority_name.trim() || null,
    authority_email_domain: f.authority_email_domain.trim().toLowerCase() || null,
    authority_radicado: f.authority_radicado.trim() || null,
  };
}

const RPC_ERRORS: Record<string, string> = {
  MOTIVO_REQUERIDO: "La corrección exige un motivo.",
  VERSION_DESACTUALIZADA: "Otra persona o pestaña cambió la fecha base. Recargue e intente de nuevo.",
  FECHA_PRESENTACION_FUTURA: "La fecha de presentación no puede ser futura.",
  FECHA_PRESENTACION_REQUERIDA: "Indique la fecha de presentación.",
  SOPORTE_REQUERIDO: "Describa el soporte de la presentación.",
  COMPONENTES_INVALIDOS: "Seleccione componentes válidos.",
  OUTLOOK_REQUIERE_CORREO_VINCULADO: "Vincule primero el correo enviado.",
  CORREO_NO_VINCULADO_AL_ASUNTO: "El correo indicado no está vinculado a este asunto.",
  NO_AUTORIZADO: "Solo el dueño del asunto puede registrar o corregir plazos.",
  MCP_MANAGE_GRANT_REQUIRED: "Sesión no válida para modificar el asunto.",
  ASUNTO_NO_ACTIVO: "El asunto no está activo.",
  TERMINO_NO_VIGENTE: "Ese plazo ya no está vigente.",
  REVISION_JURIDICA_REQUERIDA: "Confirme que revisó la respuesta antes de cerrarla.",
};

export function friendlyRpcError(message: string): string {
  const key = Object.keys(RPC_ERRORS).find((k) => message.includes(k));
  return key ? RPC_ERRORS[key] : message;
}

export const EXTENSION_VALIDITY_LABELS: Record<string, string> = {
  VALID: "Prórroga válida aplicada",
  LATE: "Comunicada después del vencimiento: sin efecto",
  EXCEEDS_CAP: "Supera el doble del término: sin efecto",
  INCOMPLETE: "Sin motivación o fecha válida: sin efecto",
  MANUAL_REVIEW: "No revisada: sin efecto",
};
