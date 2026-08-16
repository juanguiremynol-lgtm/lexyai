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

import { ONLINE_SYNC_ELIGIBLE_WORKFLOWS } from "@/lib/externalSyncDisplay";

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
  PENDIENTE_DE_RADICACION: "Pendiente de radicación",
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
  return radDigits(radicado).length >= 21;
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
  | "CONSULTADO_SIN_RESULTADOS";

export interface ActsEmptyState {
  kind: ActsEmptyStateKind;
  title: string;
  description: string;
  /** Show the prominent "Agregar radicado" action. */
  showAddRadicado: boolean;
}

export function resolveActsEmptyState(input: {
  workflowType: string | null | undefined;
  radicado: string | null | undefined;
  monitoringEnabled: boolean | null | undefined;
  monitoringDisabledReason?: string | null;
  lastSyncedAt?: string | null;
}): ActsEmptyState {
  const eligible = isProviderEligibleWorkflow(input.workflowType);

  if (eligible && !hasUsableRadicado(input.radicado)) {
    return {
      kind: "SIN_RADICADO",
      title: "Este expediente aún no tiene radicado",
      description:
        "No hemos consultado a ningún sistema judicial: sin radicado no es posible identificar el proceso ante el proveedor. Agregá el radicado para habilitar el monitoreo y la sincronización inicial.",
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
    return {
      kind: "NUNCA_CONSULTADO",
      title: "Todavía no hemos consultado a los sistemas judiciales",
      description:
        "El expediente está inscrito para monitoreo, pero aún no se ejecuta la primera sincronización. Las actuaciones aparecerán después de la primera consulta.",
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
