/**
 * claseProcesoWriter.ts — ITERATION 29 (continuation).
 *
 * Pure decision logic for consuming GCP's `claseProveedor` contract.
 * No I/O: callers supply the contract + current row + mapping catalogue and
 * receive the exact column patch to persist.
 *
 * THREE GUARDS (non-negotiable):
 *
 *   GUARD A — absence of the block is NOT absence of the class.
 *     (i)   block present, disponible=true  → PRESENT      (write verbatim)
 *     (ii)  block present, disponible=false → DECLINED     (write motivo only)
 *     (iii) block absent                    → INCONCLUSIVE (touch NOTHING)
 *
 *   GUARD B — a provider class may never auto-set workflow_type when the
 *     mapped workflow is outside the inference-eligible set, when it
 *     disagrees with the current workflow_type, or when the current source
 *     is MANUAL. Those become suggestions, never writes.
 *
 *   GUARD C — an unmapped class is stored verbatim and logged. Never guessed.
 */

import {
  type ClaseProcesoContract,
  MOTIVO_BLOQUE_AUSENTE,
  claseProviderObservedAt,
} from "./claseProcesoContract.ts";

/** Guard A cases. */
export type ClaseReadCase = "PRESENT" | "DECLINED" | "INCONCLUSIVE";

/**
 * GUARD B — workflows the tenant may NOT have auto-assigned from a provider
 * class. LABORAL alters the provider chain and the phase catalogue, so it is
 * suggestion-only (iteration 18 practice-area doctrine).
 */
/**
 * ITER44 — the legacy `PENAL` spelling was removed here: aliasing belongs to
 * `normalizeWorkflowType()` alone, and a second copy of it is exactly the
 * duplicated-identity defect family.
 */
export const INFERENCE_INELIGIBLE_WORKFLOWS = new Set(["LABORAL", "PENAL_906"]);

export interface ClaseMapEntry {
  pattern: string;
  workflow_type: string;
  label: string;
}

export interface ClaseCurrentRow {
  clase_proceso?: string | null;
  subclase_proceso?: string | null;
  workflow_type?: string | null;
  workflow_type_source?: string | null;
}

export type WorkflowDecision =
  | { kind: "APPLY"; workflow: string; label: string; reason: string }
  | { kind: "SUGGEST"; workflow: string; label: string; reason: string }
  | { kind: "NONE"; reason: string };

export interface ClaseWriteDecision {
  readCase: ClaseReadCase;
  /** Column patch for public.work_items. Empty object on INCONCLUSIVE. */
  patch: Record<string, unknown>;
  /** True when the juridical class identity changed (emit CAMBIO_CLASE_PROCESO). */
  claseChanged: boolean;
  workflow: WorkflowDecision;
  /** Verbatim class that matched no catalogue pattern (GUARD C). */
  unmappedClase: string | null;
  explanation: string;
}

function deaccent(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Longest-pattern-wins substring match over the catalogue. */
export function matchClaseToWorkflow(
  clase: string | null | undefined,
  map: ClaseMapEntry[],
): ClaseMapEntry | null {
  if (!clase || !clase.trim()) return null;
  const hay = deaccent(clase);
  const hits = map
    .filter((m) => hay.includes(deaccent(m.pattern)))
    .sort((a, b) => b.pattern.length - a.pattern.length);
  return hits[0] ?? null;
}

/** GUARD A classifier. */
export function classifyRead(contract: ClaseProcesoContract | null | undefined): ClaseReadCase {
  if (!contract) return "INCONCLUSIVE";
  // The block was never located in the response — a degraded/partial read.
  if (!contract.raw || contract.motivo_ausencia === MOTIVO_BLOQUE_AUSENTE) return "INCONCLUSIVE";
  return contract.disponible ? "PRESENT" : "DECLINED";
}

export function decideClaseProcesoWrite(args: {
  contract: ClaseProcesoContract | null | undefined;
  current: ClaseCurrentRow;
  map: ClaseMapEntry[];
  observedAt?: string;
}): ClaseWriteDecision {
  const { contract, current, map } = args;
  const readCase = classifyRead(contract);
  // ITER44 — freshness authority: the provider's own observation timestamp.
  const now = claseProviderObservedAt(contract) ?? args.observedAt ?? new Date().toISOString();

  // ── GUARD A (iii): inconclusive read. Touch NOTHING. ──
  if (readCase === "INCONCLUSIVE") {
    return {
      readCase,
      patch: {},
      claseChanged: false,
      workflow: { kind: "NONE", reason: "Lectura no concluyente: el proveedor no entregó el bloque." },
      unmappedClase: null,
      explanation:
        "Respuesta degradada o parcial: el bloque claseProveedor no vino. No se escribe, no se anula, no se avanza observed_at.",
    };
  }

  const c = contract as ClaseProcesoContract;

  // ── GUARD A (ii): the provider was asked and declined. Record only the motive. ──
  if (readCase === "DECLINED") {
    return {
      readCase,
      patch: {
        clase_proveedor: c.raw,
        clase_proceso_disponible: false,
        clase_proceso_motivo_ausencia: c.motivo_ausencia,
        clase_proceso_procedencia: c.procedencia,
        clase_proceso_observed_at: now,
      },
      claseChanged: false,
      workflow: { kind: "NONE", reason: "El proveedor declaró la clase no disponible." },
      unmappedClase: null,
      explanation: `El proveedor respondió sin clase (${c.motivo_ausencia}). Se registra el motivo, no se toca la clase almacenada.`,
    };
  }

  // ── GUARD A (i): present. Write verbatim. ──
  const norm = (v?: string | null) => (v ?? "").trim().toLowerCase();
  const claseChanged =
    norm(current.clase_proceso) !== norm(c.clase_proceso) ||
    norm(current.subclase_proceso) !== norm(c.subclase_proceso);

  const patch: Record<string, unknown> = {
    clase_proveedor: c.raw,
    clase_proceso_disponible: true,
    clase_proceso_motivo_ausencia: null,
    clase_proceso_procedencia: c.procedencia,
    clase_proceso_observed_at: now,
    clase_proceso: c.clase_proceso,
    subclase_proceso: c.subclase_proceso,
  };
  // Only stamp provider-supplied values; never blank a column we did not receive.
  if (c.tipo_proceso) patch.tipo_proceso = c.tipo_proceso;
  if (c.naturaleza_proceso) patch.naturaleza_proceso = c.naturaleza_proceso;
  if (c.ponente) patch.ponente = c.ponente;
  if (c.recurso) patch.tipo_recurso = c.recurso;

  // ── Workflow routing ──
  const hit = matchClaseToWorkflow(c.clase_proceso, map);
  const currentWf = (current.workflow_type ?? "").toUpperCase();
  const currentSource = (current.workflow_type_source ?? "").toUpperCase();
  let workflow: WorkflowDecision;
  let unmapped: string | null = null;

  if (!hit) {
    // ── GUARD C ──
    unmapped = c.clase_proceso;
    workflow = {
      kind: "NONE",
      reason: `Clase "${c.clase_proceso}" sin patrón en el catálogo: se registra, no se adivina.`,
    };
  } else if (currentSource === "MANUAL") {
    // MANUAL is never overwritten by anything.
    workflow = {
      kind: "NONE",
      reason: `Materia fijada manualmente (${currentWf}); la clase del proveedor queda como corroboración.`,
    };
  } else if (INFERENCE_INELIGIBLE_WORKFLOWS.has(hit.workflow_type)) {
    // ── GUARD B ──
    workflow = {
      kind: "SUGGEST",
      workflow: hit.workflow_type,
      label: hit.label,
      reason: `La clase sugiere ${hit.workflow_type}, materia fuera del conjunto inferible: requiere confirmación.`,
    };
  } else if (currentWf && currentWf !== "INDETERMINADO" && currentWf !== hit.workflow_type) {
    // ── GUARD B (disagreement with a non-MANUAL current type) ──
    workflow = {
      kind: "SUGGEST",
      workflow: hit.workflow_type,
      label: hit.label,
      reason: `La clase sugiere ${hit.workflow_type} pero el asunto es ${currentWf}: requiere confirmación.`,
    };
  } else {
    workflow = {
      kind: "APPLY",
      workflow: hit.workflow_type,
      label: hit.label,
      reason: `Clase de proceso del proveedor: ${hit.label}.`,
    };
    patch.workflow_type = hit.workflow_type;
    patch.workflow_type_source = "PROVIDER_CLASS";
  }

  return {
    readCase,
    patch,
    claseChanged,
    workflow,
    unmappedClase: unmapped,
    explanation: `Clase del proveedor "${c.clase_proceso ?? "—"}" registrada verbatim. ${workflow.reason}`,
  };
}
