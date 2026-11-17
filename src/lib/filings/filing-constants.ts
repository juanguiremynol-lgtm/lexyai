// Shared vocabulary for registered filings (MCP + app). Mirrors the CHECK constraints of public.work_item_filings.
export const FILING_ACTION_KINDS = ["DEMANDA", "TUTELA", "MEMORIAL", "RECURSO", "IMPUGNACION", "DESCARGOS", "PETICION", "SOLICITUD_ADMINISTRATIVA", "OTRO"] as const;
export const FILING_CHANNELS = ["EMAIL_OFICIAL", "PLATAFORMA", "PRESENCIAL", "OTRO"] as const;
export const FILING_WORKFLOWS = ["CGP", "EJECUTIVO", "CPACA", "TUTELA", "LABORAL", "PENAL_906", "PETICION", "GOV_PROCEDURE"] as const;
export const GOV_PROCEDURE_SUBTYPES = ["TRANSITO_SANCIONATORIO", "AMBIENTAL_SANCIONATORIO", "OTRO_SANCIONATORIO", "TRAMITE_ADMINISTRATIVO", "DISCIPLINARIO", "ESPECIAL"] as const;
export const TRIBUNAL_TYPES = ["JUDICIAL", "AUTORIDAD_JURISDICCIONAL", "ADMINISTRATIVA"] as const;

export type FilingActionKind = (typeof FILING_ACTION_KINDS)[number];

export const FILING_ACTION_LABELS: Record<FilingActionKind, string> = {
  DEMANDA: "Demanda", TUTELA: "Tutela", MEMORIAL: "Memorial", RECURSO: "Recurso", IMPUGNACION: "Impugnación",
  DESCARGOS: "Descargos", PETICION: "Petición", SOLICITUD_ADMINISTRATIVA: "Solicitud administrativa", OTRO: "Otro",
};
export const FILING_CHANNEL_LABELS: Record<(typeof FILING_CHANNELS)[number], string> = {
  EMAIL_OFICIAL: "Correo oficial", PLATAFORMA: "Plataforma", PRESENCIAL: "Presencial", OTRO: "Otro",
};

/** Filing kinds that need a human review of the legal trigger before any term exists. */
export const PENDING_TRIGGER_KINDS: readonly FilingActionKind[] = ["DEMANDA", "TUTELA", "MEMORIAL", "RECURSO", "IMPUGNACION", "DESCARGOS"];

export function expectedDeadlineEffect(kind: FilingActionKind): "PENDING_TRIGGER" | "NONE" {
  return PENDING_TRIGGER_KINDS.includes(kind) ? "PENDING_TRIGGER" : "NONE";
}

/** Client-side pre-check mirroring the server rules; the RPC remains authoritative. */
export function validateFilingInput(i: {
  action_kind: FilingActionKind; workflow_type?: string; procedure_subtype?: string; tribunal_type?: string;
  work_item_id?: string; radicado?: string; filed_on?: string; source_reference?: string;
}): string | null {
  if (!i.filed_on) return "FECHA_PRESENTACION_REQUERIDA";
  if (!i.source_reference || i.source_reference.trim().length < 3) return "SOPORTE_REQUERIDO";
  const digits = (i.radicado ?? "").replace(/\D/g, "");
  if (digits && digits.length !== 23) return "RADICADO_INVALIDO";
  const isNew = !i.work_item_id && !digits;
  if (isNew && (i.action_kind === "PETICION" || i.workflow_type === "PETICION")) return "USE_CREATE_PETICION";
  if (isNew && !i.workflow_type) return "WORKFLOW_REQUERIDO";
  if (i.procedure_subtype && i.workflow_type && i.workflow_type !== "GOV_PROCEDURE") return "SUBTIPO_SOLO_GOV_PROCEDURE";
  if (isNew && i.workflow_type === "GOV_PROCEDURE" && !i.procedure_subtype) return "SUBTIPO_REQUERIDO";
  if (i.tribunal_type === "AUTORIDAD_JURISDICCIONAL" && (i.workflow_type === "GOV_PROCEDURE" || i.workflow_type === "PETICION")) return "CLASIFICACION_INCOHERENTE";
  return null;
}
