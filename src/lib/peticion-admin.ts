/**
 * Manual administrative record for PETICION matters (peticion_work_item_state).
 * The send date never becomes a legal anchor by itself: anchor_source is set
 * to MANUAL only when the user records a proven authority receipt date.
 */
export const PETICION_SUBTYPES = [
  { code: "GENERAL", label: "Interés general o particular" },
  { code: "DOCUMENTOS_INFORMACION", label: "Documentos e información" },
  { code: "CONSULTA", label: "Consulta" },
  { code: "ENTRE_AUTORIDADES_INFO_DOCUMENTOS", label: "Entre autoridades" },
] as const;

export const MANUAL_EVENT_CODES = [
  { code: "ACUSE_RECIBO_CONFIRMADO", label: "Acuse de recibo confirmado" },
  { code: "RADICADO_OFICIAL_ASIGNADO", label: "Radicado oficial asignado" },
  { code: "TRASLADO_COMPETENCIA", label: "Traslado por competencia" },
  { code: "REQUERIMIENTO_RECIBIDO", label: "Requerimiento recibido" },
  { code: "PRORROGA_COMUNICADA", label: "Prórroga comunicada" },
  { code: "RESPUESTA_PARCIAL", label: "Respuesta parcial" },
  { code: "RESPUESTA_DE_FONDO", label: "Respuesta de fondo (revisada)" },
  { code: "NOTA", label: "Nota / evidencia" },
] as const;

export const EVENT_LABELS: Record<string, string> = {
  ...Object.fromEntries(MANUAL_EVENT_CODES.map((e) => [e.code, e.label])),
  EMAIL_ENVIO_OBSERVADO: "Envío observado en Outlook",
  EMAIL_NOVEDAD_PROPUESTA: "Correo recibido por revisar",
  RESPONSE_TERM_EXPIRED: "Término de respuesta vencido",
};

export interface PeticionStateForm {
  subtype_code: string;
  authority_name: string;
  authority_email_domain: string;
  sent_at: string;
  authority_received_at: string;
  authority_radicado: string;
  anchor_provenance_note: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validatePeticionState(f: PeticionStateForm, today: string): string[] {
  const errors: string[] = [];
  if (!PETICION_SUBTYPES.some((s) => s.code === f.subtype_code)) errors.push("Seleccione el tipo de petición.");
  for (const [k, label] of [["sent_at", "envío"], ["authority_received_at", "recepción"]] as const) {
    const v = f[k];
    if (v && !DATE_RE.test(v)) errors.push(`Fecha de ${label} inválida.`);
    if (v && v > today) errors.push(`La fecha de ${label} no puede ser futura.`);
  }
  if (f.sent_at && f.authority_received_at && f.authority_received_at < f.sent_at) {
    errors.push("La recepción no puede ser anterior al envío.");
  }
  if (f.authority_received_at && !f.anchor_provenance_note.trim()) {
    errors.push("Indique la prueba de la recepción (acuse, radicado, constancia).");
  }
  if (f.authority_radicado.length > 60) errors.push("Radicado oficial demasiado largo.");
  if (f.authority_email_domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(f.authority_email_domain)) {
    errors.push("Dominio de correo inválido.");
  }
  if (f.authority_name.length > 300) errors.push("Nombre de autoridad demasiado largo.");
  return errors;
}

export function buildPeticionStatePayload(
  f: PeticionStateForm,
  ids: { work_item_id: string; owner_id: string; organization_id: string | null },
) {
  const received = f.authority_received_at || null;
  return {
    ...ids,
    subtype_code: f.subtype_code,
    authority_name: f.authority_name.trim() || null,
    authority_email_domain: f.authority_email_domain.trim().toLowerCase() || null,
    sent_at: f.sent_at || null,
    authority_received_at: received,
    authority_radicado: f.authority_radicado.trim() || null,
    anchor_source: received ? "MANUAL" : null,
    anchor_provenance_note: received ? f.anchor_provenance_note.trim() : null,
  };
}
