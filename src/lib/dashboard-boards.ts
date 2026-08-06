/**
 * dashboard-boards.ts — the single registry of dashboard boards (iteration 37).
 *
 * RULE (general, never per-workflow): the boards a tenant sees are
 *   organisation practice_areas  ∩  workflows that have a phase catalogue.
 * Adding a workflow to practice_areas is therefore SUFFICIENT to make its
 * board appear; no further code change is required. A workflow without a
 * bespoke pipeline falls back to the generic phase board.
 */
import { getWorkflowPhases } from "@/lib/workflow-phases";
import { WORKFLOW_TYPES, type WorkflowType } from "@/lib/workflow-constants";

export interface DashboardBoard {
  /** URL tab slug (?tab=...). */
  tab: string;
  workflow: WorkflowType;
  label: string;
  description: string;
}

/**
 * Display order + copy. Anything listed here is only shown when the area is
 * practised AND the workflow owns a phase catalogue.
 */
export const DASHBOARD_BOARDS: DashboardBoard[] = [
  {
    tab: "cgp",
    workflow: "CGP",
    label: "Demandas CGP",
    description:
      "Radicaciones y procesos bajo Código General del Proceso (civil, comercial, familia). Arrastra entre etapas para reclasificar.",
  },
  {
    tab: "ejecutivo",
    workflow: "EJECUTIVO",
    label: "Ejecutivos",
    description:
      "Procesos ejecutivos bajo el CGP: mandamiento de pago, excepciones de mérito, seguir adelante la ejecución, liquidación, avalúo y remate.",
  },
  {
    tab: "laboral",
    workflow: "LABORAL",
    label: "Laborales",
    description:
      "Procesos laborales bajo Código Procesal del Trabajo (CPTSS). Audiencia única de conciliación, juzgamiento y fallo.",
  },
  {
    tab: "penal",
    workflow: "PENAL_906",
    label: "Penal",
    description:
      "Procesos penales bajo Ley 906 de 2004 (Sistema Penal Acusatorio). Desde indagación hasta ejecutoria.",
  },
  {
    tab: "cpaca",
    workflow: "CPACA",
    label: "CPACA",
    description:
      "Procesos ordinarios contencioso administrativos (CPACA). Cálculo automático de términos según Art. 199.",
  },
  {
    tab: "administrativos",
    workflow: "GOV_PROCEDURE",
    label: "Procesos Administrativos",
    description:
      "Procesos ante autoridades administrativas (inspecciones, superintendencias, tránsito, disciplinarios). Arrastra entre fases.",
  },
  {
    tab: "peticiones",
    workflow: "PETICION",
    label: "Peticiones",
    description:
      "Derechos de petición con seguimiento de plazos (15 días hábiles). Las peticiones vencidas pueden escalarse a tutela.",
  },
  {
    tab: "tutelas",
    workflow: "TUTELA",
    label: "Tutelas",
    description:
      "Acciones de tutela con seguimiento de fallos. Los fallos favorables permiten archivar el proceso.",
  },
];

/** A workflow can only own a board when it has columns to render. */
export function hasPhaseCatalogue(workflow: WorkflowType): boolean {
  return getWorkflowPhases(workflow).length > 0 && workflow !== "INDETERMINADO";
}

/** practice_areas ∩ workflows with a phase catalogue, in display order. */
export function visibleBoards(
  isPracticed: (wf: WorkflowType) => boolean,
): DashboardBoard[] {
  return DASHBOARD_BOARDS.filter(
    (b) => hasPhaseCatalogue(b.workflow) && isPracticed(b.workflow),
  );
}

/** Always-present tray for matters whose subject matter is unknown. */
export const UNCLASSIFIED_TAB = "por-clasificar";

export function boardLabel(workflow: WorkflowType): string {
  return WORKFLOW_TYPES[workflow]?.label ?? workflow;
}
