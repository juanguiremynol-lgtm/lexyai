/**
 * despacho-competencia.ts — Court competence is NOT subject matter.
 *
 * Iteration 18 doctrine:
 *   The radicado encodes the COMPETENCE of the despacho, never the
 *   subject matter of the case. Only a despacho with PURA competence
 *   allows inferring `workflow_type` from the radicado. MIXTA and
 *   DESCONOCIDA never infer it — not from the radicado, and not from
 *   despacho-name heuristics.
 *
 * Frontend mirror of `public.despacho_competencia_catalog` and
 * `public.clase_proceso_workflow_map`.
 */

import type { WorkflowType } from "@/lib/workflow-constants";
import { parseRadicadoBlocks } from "@/lib/radicado-utils";

export type Competencia = "PURA" | "MIXTA" | "DESCONOCIDA";

/**
 * Provenance of a work item's subject matter, highest authority first.
 *   MANUAL              — user-set. Definitive. Never overwritten by automation.
 *   PROVIDER_CLASS      — derived from the persisted provider `clase_proceso`.
 *   PURE_ESPECIALIDAD   — derived from the radicado, PURA competence only.
 *   INFERRED_VOCABULARY — inferred from actuación text. SUGGESTION ONLY.
 *   INDETERMINADO       — no source could determine it.
 */
export type WorkflowTypeSource =
  | "MANUAL"
  | "PROVIDER_CLASS"
  | "PURE_ESPECIALIDAD"
  | "INFERRED_VOCABULARY"
  | "INDETERMINADO";

export const WORKFLOW_TYPE_SOURCE_RANK: Record<WorkflowTypeSource, number> = {
  MANUAL: 100,
  PROVIDER_CLASS: 80,
  PURE_ESPECIALIDAD: 60,
  INFERRED_VOCABULARY: 20,
  INDETERMINADO: 0,
};

export interface CompetenciaEntry {
  corp: string | null;             // null = any corporation
  esp: string;
  competencia: Competencia;
  subjects: WorkflowType[];
  label: string;
  notes?: string;
}

/** Seeded catalog — mirrors public.despacho_competencia_catalog. */
export const DESPACHO_COMPETENCIA_CATALOG: CompetenciaEntry[] = [
  { corp: null, esp: "03", competencia: "PURA", subjects: ["CGP"], label: "Civil" },
  { corp: null, esp: "04", competencia: "PURA", subjects: ["CGP"], label: "Familia", notes: "Familia se tramita bajo taxonomía CGP" },
  { corp: null, esp: "05", competencia: "PURA", subjects: ["LABORAL"], label: "Laboral" },
  { corp: null, esp: "33", competencia: "PURA", subjects: ["CPACA"], label: "Administrativo" },
  { corp: null, esp: "37", competencia: "PURA", subjects: ["CPACA"], label: "Administrativo" },
  { corp: "41", esp: "89", competencia: "MIXTA", subjects: ["CGP", "LABORAL"], label: "Pequeñas causas y competencia múltiple" },
  { corp: "40", esp: "89", competencia: "MIXTA", subjects: ["CGP", "LABORAL", "PENAL_906"], label: "Promiscuo municipal" },
  { corp: "31", esp: "89", competencia: "MIXTA", subjects: ["CGP", "LABORAL", "PENAL_906"], label: "Promiscuo del circuito" },
  { corp: "31", esp: "12", competencia: "MIXTA", subjects: ["CGP", "LABORAL"], label: "Civil del circuito con conocimiento en asuntos laborales" },
];

/** Legacy specialty codes normalised by the structural decoder. */
const ESP_ALIASES: Record<string, string> = {
  "53": "03", // Barranquilla civil
};

export interface CompetenciaResult {
  corp: string | null;
  esp: string | null;
  competencia: Competencia;
  subjects: WorkflowType[];
  label: string | null;
}

export function resolveCompetencia(radicado: string | null | undefined): CompetenciaResult {
  const parsed = radicado ? parseRadicadoBlocks(radicado) : null;
  if (!parsed?.valid || !parsed.blocks) {
    return { corp: null, esp: null, competencia: "DESCONOCIDA", subjects: [], label: null };
  }
  const corp = parsed.blocks.corp;
  const esp = ESP_ALIASES[parsed.blocks.esp] ?? parsed.blocks.esp;

  const entry =
    DESPACHO_COMPETENCIA_CATALOG.find((e) => e.esp === esp && e.corp === corp) ??
    DESPACHO_COMPETENCIA_CATALOG.find((e) => e.esp === esp && e.corp === null);

  if (!entry) return { corp, esp, competencia: "DESCONOCIDA", subjects: [], label: null };
  return { corp, esp, competencia: entry.competencia, subjects: entry.subjects, label: entry.label };
}

/**
 * clase_proceso → workflow. Mirrors public.clase_proceso_workflow_map.
 * Patterns are matched as unaccented lowercase substrings; longest match wins.
 */
export const CLASE_PROCESO_WORKFLOW_MAP: Array<{ pattern: string; workflow: WorkflowType; label: string }> = [
  { pattern: "ordinario de primera instancia laboral", workflow: "LABORAL", label: "Ordinario de primera instancia laboral" },
  { pattern: "ordinario de unica instancia laboral", workflow: "LABORAL", label: "Ordinario de única instancia laboral" },
  { pattern: "ejecutivo con titulo hipotecario", workflow: "CGP", label: "Ejecutivo con título hipotecario" },
  { pattern: "procesos ordinarios laborales", workflow: "LABORAL", label: "Procesos ordinarios laborales" },
  { pattern: "ejecutivo singular de mayor", workflow: "CGP", label: "Ejecutivo singular de mayor cuantía" },
  { pattern: "deslinde y amojonamiento", workflow: "CGP", label: "Deslinde y amojonamiento" },
  { pattern: "jurisdiccion voluntaria", workflow: "CGP", label: "Jurisdicción voluntaria" },
  { pattern: "accion de cumplimiento", workflow: "CPACA", label: "Acción de cumplimiento" },
  { pattern: "ejecutivo contractual", workflow: "CPACA", label: "Ejecutivo contractual" },
  { pattern: "incidente de desacato", workflow: "TUTELA", label: "Incidente de desacato" },
  { pattern: "accion de repeticion", workflow: "CPACA", label: "Acción de repetición" },
  { pattern: "impugnacion de actas", workflow: "CGP", label: "Impugnación de actas" },
  { pattern: "rendicion de cuentas", workflow: "CGP", label: "Rendición de cuentas" },
  { pattern: "ejecutivo prendario", workflow: "CGP", label: "Ejecutivo prendario" },
  { pattern: "declarativo verbal", workflow: "CGP", label: "Declarativo verbal" },
  { pattern: "ejecutivo de mayor", workflow: "CGP", label: "Ejecutivo de mayor cuantía" },
  { pattern: "entrega de la cosa", workflow: "CGP", label: "Entrega de la cosa por el tradente al adquirente" },
  { pattern: "sucesion intestada", workflow: "CGP", label: "Sucesión intestada" },
  { pattern: "ejecutivo laboral", workflow: "LABORAL", label: "Ejecutivo laboral" },
  { pattern: "nulidad electoral", workflow: "CPACA", label: "Nulidad electoral" },
  { pattern: "procesos verbales", workflow: "CGP", label: "Procesos verbales" },
  { pattern: "accion de grupo", workflow: "CPACA", label: "Acción de grupo" },
  { pattern: "ejecutivo mixto", workflow: "CGP", label: "Ejecutivo mixto" },
  { pattern: "verbal de mayor", workflow: "CGP", label: "Verbal de mayor cuantía" },
  { pattern: "accion popular", workflow: "CPACA", label: "Acción popular" },
  { pattern: "nulidad simple", workflow: "CPACA", label: "Nulidad simple" },
  { pattern: "proceso verbal", workflow: "CGP", label: "Proceso verbal" },
  { pattern: "acoso laboral", workflow: "LABORAL", label: "Acoso laboral" },
  { pattern: "union marital", workflow: "CGP", label: "Unión marital de hecho" },
  { pattern: "expropiacion", workflow: "CGP", label: "Expropiación" },
  { pattern: "insolvencia", workflow: "CGP", label: "Insolvencia de persona natural no comerciante" },
  { pattern: "liquidacion", workflow: "CGP", label: "Liquidación" },
  { pattern: "pertenencia", workflow: "CGP", label: "Pertenencia" },
  { pattern: "alimentos", workflow: "CGP", label: "Alimentos" },
  { pattern: "filiacion", workflow: "CGP", label: "Filiación" },
  { pattern: "custodia", workflow: "CGP", label: "Custodia y cuidado personal" },
  { pattern: "divorcio", workflow: "CGP", label: "Divorcio" },
  { pattern: "tutela", workflow: "TUTELA", label: "Tutela" },
  { pattern: "ejecutivo singular", workflow: "CGP", label: "Ejecutivo singular" },
  { pattern: "ejecutivo de menor", workflow: "CGP", label: "Ejecutivo de menor cuantía" },
  { pattern: "ejecutivos de menor", workflow: "CGP", label: "Ejecutivos de menor y mínima cuantía" },
  { pattern: "minima cuantia", workflow: "CGP", label: "Mínima cuantía" },
  { pattern: "ejecutivo hipotecario", workflow: "CGP", label: "Ejecutivo hipotecario" },
  { pattern: "restitucion de inmueble", workflow: "CGP", label: "Restitución de inmueble arrendado" },
  { pattern: "divisorio", workflow: "CGP", label: "Divisorio" },
  { pattern: "sucesion", workflow: "CGP", label: "Sucesión" },
  { pattern: "verbal de familia", workflow: "CGP", label: "Verbal de familia" },
  { pattern: "verbal sumario", workflow: "CGP", label: "Verbal sumario" },
  { pattern: "verbal", workflow: "CGP", label: "Verbal" },
  { pattern: "monitorio", workflow: "CGP", label: "Monitorio" },
  { pattern: "ordinario laboral", workflow: "LABORAL", label: "Ordinario laboral" },
  { pattern: "unica instancia laboral", workflow: "LABORAL", label: "Única instancia laboral" },
  { pattern: "fuero sindical", workflow: "LABORAL", label: "Fuero sindical" },
  { pattern: "nulidad y restablecimiento", workflow: "CPACA", label: "Nulidad y restablecimiento del derecho" },
  { pattern: "reparacion directa", workflow: "CPACA", label: "Reparación directa" },
  { pattern: "controversias contractuales", workflow: "CPACA", label: "Controversias contractuales" },
  { pattern: "accion de tutela", workflow: "TUTELA", label: "Acción de tutela" },
];

/**
 * GUARD B (iteration 29) — workflows a provider class may NEVER auto-assign.
 * Changing to one of these alters the provider chain and the phase catalogue,
 * so it is always routed to the "Por clasificar" tray for confirmation.
 */
export const INFERENCE_INELIGIBLE_WORKFLOWS: WorkflowType[] = ["LABORAL", "PENAL_906"];

function deaccent(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function workflowFromClaseProceso(clase: string | null | undefined):
  { workflow: WorkflowType; label: string } | null {
  if (!clase?.trim()) return null;
  const hay = deaccent(clase);
  const matches = CLASE_PROCESO_WORKFLOW_MAP
    .filter((m) => hay.includes(m.pattern))
    .sort((a, b) => b.pattern.length - a.pattern.length);
  return matches[0] ? { workflow: matches[0].workflow, label: matches[0].label } : null;
}

export interface ResolveWorkflowInput {
  radicado?: string | null;
  claseProceso?: string | null;
  manualWorkflow?: WorkflowType | null;
  /** SUGGESTION ONLY — never applied automatically. */
  vocabularySuggestion?: WorkflowType | null;
  /** Tenant practice areas. `null`/undefined = all areas allowed. */
  practiceAreas?: WorkflowType[] | null;
}

export interface ResolvedWorkflow {
  workflow: WorkflowType;                 // 'INDETERMINADO' when undecidable
  source: WorkflowTypeSource;
  competencia: Competencia;
  competenciaSubjects: WorkflowType[];
  competenciaLabel: string | null;
  /** Suggestion surfaced in the "Por clasificar" tray when workflow is INDETERMINADO. */
  suggestion: { workflow: WorkflowType; source: WorkflowTypeSource; confidence: number } | null;
  reason: string;
}

function allowed(wf: WorkflowType, areas?: WorkflowType[] | null): boolean {
  if (!areas || areas.length === 0) return true;
  return areas.includes(wf);
}

/**
 * Single entry point for automatic subject-matter resolution.
 * Nothing here ever mutates procedural state — callers decide.
 */
export function resolveWorkflowType(input: ResolveWorkflowInput): ResolvedWorkflow {
  const comp = resolveCompetencia(input.radicado);
  const base = {
    competencia: comp.competencia,
    competenciaSubjects: comp.subjects,
    competenciaLabel: comp.label,
  };

  // 1) MANUAL — definitive, practice areas do not veto it.
  if (input.manualWorkflow) {
    return {
      ...base,
      workflow: input.manualWorkflow,
      source: "MANUAL",
      suggestion: null,
      reason: "Materia fijada manualmente por el usuario.",
    };
  }

  // 2) PROVIDER_CLASS
  const byClase = workflowFromClaseProceso(input.claseProceso);
  if (byClase) {
    // GUARD B — ineligible materias are suggestion-only, even when the
    // organisation has the practice area enabled.
    if (INFERENCE_INELIGIBLE_WORKFLOWS.includes(byClase.workflow)) {
      return {
        ...base,
        workflow: "INDETERMINADO",
        source: "INDETERMINADO",
        suggestion: { workflow: byClase.workflow, source: "PROVIDER_CLASS", confidence: 0.9 },
        reason: `Clase "${byClase.label}" sugiere ${byClase.workflow}; materia fuera del conjunto inferible, requiere confirmación.`,
      };
    }
    if (allowed(byClase.workflow, input.practiceAreas)) {
      return {
        ...base,
        workflow: byClase.workflow,
        source: "PROVIDER_CLASS",
        suggestion: null,
        reason: `Clase de proceso del proveedor: ${byClase.label}.`,
      };
    }
    return {
      ...base,
      workflow: "INDETERMINADO",
      source: "INDETERMINADO",
      suggestion: { workflow: byClase.workflow, source: "PROVIDER_CLASS", confidence: 0.9 },
      reason: `Clase "${byClase.label}" sugiere ${byClase.workflow}, área no habilitada para la organización.`,
    };
  }

  // 3) PURE_ESPECIALIDAD — only PURA competence may infer.
  if (comp.competencia === "PURA" && comp.subjects.length === 1) {
    const wf = comp.subjects[0];
    if (allowed(wf, input.practiceAreas)) {
      return {
        ...base,
        workflow: wf,
        source: "PURE_ESPECIALIDAD",
        suggestion: null,
        reason: `Especialidad ${comp.esp} (${comp.label}) es de competencia pura.`,
      };
    }
    return {
      ...base,
      workflow: "INDETERMINADO",
      source: "INDETERMINADO",
      suggestion: { workflow: wf, source: "PURE_ESPECIALIDAD", confidence: 0.8 },
      reason: `Especialidad ${comp.esp} sugiere ${wf}, área no habilitada para la organización.`,
    };
  }

  // 4) INFERRED_VOCABULARY — suggestion only, never applied.
  if (input.vocabularySuggestion && allowed(input.vocabularySuggestion, input.practiceAreas)) {
    return {
      ...base,
      workflow: "INDETERMINADO",
      source: "INDETERMINADO",
      suggestion: { workflow: input.vocabularySuggestion, source: "INFERRED_VOCABULARY", confidence: 0.5 },
      reason:
        comp.competencia === "MIXTA"
          ? `Despacho de competencia mixta (${comp.label}); el vocabulario sugiere una materia, requiere confirmación.`
          : "Sugerencia basada en vocabulario de actuaciones, requiere confirmación.",
    };
  }

  // 5) INDETERMINADO
  return {
    ...base,
    workflow: "INDETERMINADO",
    source: "INDETERMINADO",
    suggestion: null,
    reason:
      comp.competencia === "MIXTA"
        ? `Despacho de competencia mixta (${comp.label}): la materia no se infiere del radicado.`
        : "No hay fuente suficiente para determinar la materia.",
  };
}

/** Provider chain is despacho-driven so classification never suspends ingestion. */
export function providerChainForWorkItem(workflow: string | null | undefined, radicado?: string | null): string[] {
  const wf = (workflow ?? "").toUpperCase();
  if (wf !== "INDETERMINADO") {
    return {
      CGP: ["cpnu", "publicaciones"],
      LABORAL: ["cpnu", "publicaciones"],
      PENAL_906: ["cpnu", "publicaciones"],
      PENAL: ["cpnu", "publicaciones"],
      CPACA: ["samai", "samai_estados"],
      TUTELA: ["cpnu", "samai", "publicaciones", "samai_estados"],
    }[wf] ?? [];
  }
  const comp = resolveCompetencia(radicado);
  if (comp.esp === "33" || comp.esp === "37") return ["samai", "samai_estados"];
  return ["cpnu", "publicaciones"];
}
