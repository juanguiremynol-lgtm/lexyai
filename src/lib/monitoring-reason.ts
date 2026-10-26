/**
 * monitoring-reason — single source of truth for WHY a work item is not
 * being monitored, and for what the "no actuaciones" empty state actually
 * means.
 *
 * Iteration 61: a provider-eligible work item created without a radicado was
 * silently left with monitoring_enabled = false and
 * monitoring_disabled_reason = NULL, and its detail page claimed the courts
 * had not moved. Absence of evidence is not evidence of absence: the copy
 * must state the real reason.
 */

import { ONLINE_SYNC_ELIGIBLE_WORKFLOWS } from "./externalSyncDisplay";

/** Workflows for which a provider chain exists (mirror of the DB helper
 *  is_provider_monitored_workflow / provider_chain_for_workflow). */
export const PROVIDER_ELIGIBLE_WORKFLOWS = ONLINE_SYNC_ELIGIBLE_WORKFLOWS;

export const MONITORING_OFF_REASON = {
  /** Provider-eligible workflow, but no radicado recorded yet. */
  PENDIENTE_DE_RADICACION: "PENDIENTE_DE_RADICACION",
  /** Workflow has no provider chain at all (PETICION, GOV_PROCEDURE, …). */
  WORKFLOW_SIN_PROVEEDOR: "WORKFLOW_SIN_PROVEEDOR",
  /** Item is archived / soft-deleted / non-ACTIVE lifecycle. */
  EXPEDIENTE_NO_ACTIVO: "EXPEDIENTE_NO_ACTIVO",
} as const;

export type MonitoringOffReason =
  (typeof MONITORING_OFF_REASON)[keyof typeof MONITORING_OFF_REASON];

export const MONITORING_OFF_REASON_LABEL: Record<string, string> = {
  PENDIENTE_DE_RADICACION: "Falta un identificador compatible para la consulta automática",
  WORKFLOW_SIN_PROVEEDOR: "Sin proveedor judicial para este tipo de proceso",
  EXPEDIENTE_NO_ACTIVO: "Expediente no activo",
};

export function isProviderEligibleWorkflow(
  workflowType: string | null | undefined,
): boolean {
  if (!workflowType) return false;
  return (PROVIDER_ELIGIBLE_WORKFLOWS as readonly string[]).includes(workflowType);
}

/** Normalized digits of a radicado, or "" when absent. */
function radDigits(radicado: string | null | undefined): string {
  return (radicado || "").replace(/\D/g, "");
}

export function hasUsableRadicado(radicado: string | null | undefined): boolean {
  return radDigits(radicado).length === 23;
}

/**
 * Reason a work item's monitoring must be off, or null when monitoring
 * should be ON. Mirrors apply_monitoring_invariant() in the database.
 */
export function resolveMonitoringOffReason(input: {
  workflowType: string | null | undefined;
  radicado: string | null | undefined;
  lifecycleState?: string | null;
  deletedAt?: string | null;
}): MonitoringOffReason | null {
  if (!isProviderEligibleWorkflow(input.workflowType)) {
    return MONITORING_OFF_REASON.WORKFLOW_SIN_PROVEEDOR;
  }
  if (input.deletedAt) return MONITORING_OFF_REASON.EXPEDIENTE_NO_ACTIVO;
  if (input.lifecycleState && input.lifecycleState !== "ACTIVE") {
    return MONITORING_OFF_REASON.EXPEDIENTE_NO_ACTIVO;
  }
  if (!hasUsableRadicado(input.radicado)) {
    return MONITORING_OFF_REASON.PENDIENTE_DE_RADICACION;
  }
  return null;
}

// ─── Empty-state semantics ────────────────────────────────────────────────

export type ActsEmptyStateKind =
  | "SIN_RADICADO"
  | "SIN_PROVEEDOR"
  | "MONITOREO_DESACTIVADO"
  | "NUNCA_CONSULTADO"
  | "CANAL_ACTUACIONES_SIN_RESPUESTA"
  | "CONSULTADO_SIN_RESULTADOS";

export type JudicialQueryState = "IDENTIFICADOR_INCOMPATIBLE" | "PENDIENTE" | "EN_EJECUCION" | "CON_RESULTADOS" | "SIN_NOVEDADES" | "FALLIDA" | "RESTRINGIDA";

/** Actual source attempt wins over stored documents and old success timestamps. */
export function judicialQueryState(input: { compatible: boolean; status?: string | null; count?: number | null }): JudicialQueryState {
  if (!input.compatible) return "IDENTIFICADOR_INCOMPATIBLE";
  const status = (input.status ?? "").toUpperCase();
  if (["RESTRICTED", "PRIVATE"].includes(status)) return "RESTRINGIDA";
  if (["ERROR", "FAILED", "REJECTED", "TIMEOUT"].includes(status)) return "FALLIDA";
  if (["RUNNING", "IN_PROGRESS"].includes(status)) return "EN_EJECUCION";
  if (["SUCCESS", "SUCCESS_EMPTY", "EMPTY", "NOT_FOUND"].includes(status)) return (input.count ?? 0) > 0 ? "CON_RESULTADOS" : "SIN_NOVEDADES";
  return "PENDIENTE";
}

export const JUDICIAL_QUERY_LABELS: Record<JudicialQueryState, string> = {
  IDENTIFICADOR_INCOMPATIBLE: "Expediente sin identificador compatible para consulta automática",
  PENDIENTE: "Consulta inicial pendiente", EN_EJECUCION: "Consulta en ejecución",
  CON_RESULTADOS: "Consulta exitosa con resultados", SIN_NOVEDADES: "Consulta exitosa sin novedades",
  FALLIDA: "Consulta fallida", RESTRINGIDA: "Fuente restringida o privada",
};

export interface ActsEmptyState {
  kind: ActsEmptyStateKind;
  title: string;
  description: string;
  /** Show the prominent "Agregar radicado" action. */
  showAddRadicado: boolean;
}

function formatBogota(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString("es-CO", {
      timeZone: "America/Bogota",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ts;
  }
}

export function resolveActsEmptyState(input: {
  workflowType: string | null | undefined;
  radicado: string | null | undefined;
  monitoringEnabled: boolean | null | undefined;
  monitoringDisabledReason?: string | null;
  /** Last successful run of the ACTS channel specifically. */
  lastSyncedAt?: string | null;
  /**
   * LI2 — a matter is not "never synced" because one of its two channels
   * found nothing. Any successful run of ANY channel, and any estados
   * evidence, disproves NUNCA_CONSULTADO.
   */
  lastSuccessfulSyncAt?: string | null;
  estadosLastAt?: string | null;
  estadosCount?: number | null;
}): ActsEmptyState {

  const eligible = isProviderEligibleWorkflow(input.workflowType);

  if (eligible && !hasUsableRadicado(input.radicado)) {
    return {
      kind: "SIN_RADICADO",
      title: "Falta un identificador compatible para consultar este expediente",
      description:
        "La consulta automática requiere un radicado judicial de 23 dígitos. Esto no significa que el expediente no exista o no esté radicado. Las referencias SPOA o SFC se conservan sin agregar ceros ni convertirlas en radicados judiciales.",
      showAddRadicado: true,
    };
  }

  if (!eligible) {
    return {
      kind: "SIN_PROVEEDOR",
      title: "No hay consulta automática para este tipo de asunto",
      description:
        "Este tipo de proceso no cuenta con un proveedor judicial que publique actuaciones. Las actuaciones deben registrarse manualmente.",
      showAddRadicado: false,
    };
  }

  if (!input.monitoringEnabled) {
    const reason = input.monitoringDisabledReason?.trim();
    const label = reason ? MONITORING_OFF_REASON_LABEL[reason] ?? reason : null;
    return {
      kind: "MONITOREO_DESACTIVADO",
      title: "El monitoreo de este expediente está desactivado",
      description: label
        ? `No estamos consultando a los sistemas judiciales. Motivo registrado: ${label}.`
        : "No estamos consultando a los sistemas judiciales, por lo que la ausencia de actuaciones no significa que no haya movimientos.",
      showAddRadicado: false,
    };
  }

  if (!input.lastSyncedAt) {
    const estadosEvidence =
      (input.estadosCount ?? 0) > 0 || !!input.estadosLastAt;
    const otherChannelRan = !!input.lastSuccessfulSyncAt;

    if (estadosEvidence || otherChannelRan) {
      const estadosWhen = input.estadosLastAt
        ? ` El último estado publicado que recibimos es del ${formatBogota(input.estadosLastAt)}.`
        : "";
      const ranWhen = input.lastSuccessfulSyncAt
        ? ` Última consulta con respuesta: ${formatBogota(input.lastSuccessfulSyncAt)}.`
        : "";
      return {
        kind: "CANAL_ACTUACIONES_SIN_RESPUESTA",
        title: "El canal de actuaciones no ha reportado; el de estados sí",
        description:
          `Este expediente sí está siendo consultado.${ranWhen} El canal de estados responde con información,` +
          ` mientras que el canal de actuaciones no ha devuelto registros para este radicado.` +
          `${estadosWhen} La ausencia es de ese canal, no del expediente.`,
        showAddRadicado: false,
      };
    }

    return {
      kind: "NUNCA_CONSULTADO",
      title: "Todavía no hemos consultado a los sistemas judiciales",
      description:
        "El expediente está inscrito para monitoreo, pero aún no se ejecuta la primera sincronización en ninguno de sus canales. Las actuaciones aparecerán después de la primera consulta.",
      showAddRadicado: false,
    };
  }


  return {
    kind: "CONSULTADO_SIN_RESULTADOS",
    title: "No se han encontrado actuaciones para este asunto",
    description:
      "Consultamos a los sistemas judiciales y no reportaron actuaciones para este radicado. Las nuevas actuaciones aparecerán automáticamente cuando los despachos las registren.",
    showAddRadicado: false,
  };
}
