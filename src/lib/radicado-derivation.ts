/**
 * radicado-derivation.ts — Deterministic derivation of workflow_type,
 * city and department from a 23-digit Colombian judicial radicado.
 *
 * The wizard uses these helpers so the user only ever confirms or
 * corrects values instead of typing what the radicado itself already
 * knows. Never override user-entered data — always OR-with-fallback.
 */

import type { WorkflowType } from "@/lib/workflow-constants";
import { parseRadicadoBlocks } from "@/lib/radicado-utils";
import { resolveCompetencia, type Competencia } from "@/lib/despacho-competencia";

export interface DerivedRadicado {
  corp: string;                       // corporation code (2 digits, pos 5-6)
  esp: string;                        // specialty code (2 digits, pos 7-8)
  dane5: string;                      // DANE code (5 digits, pos 0-4)
  workflow: WorkflowType | null;      // suggested workflow, null when unclear
  workflowConfidence: "high" | "medium" | "low";
  city: string | null;                // suggested city
  department: string | null;          // suggested department
  jurisdictionLabel: string | null;   // e.g. "Administrativo", "Laboral"
  /**
   * True when the specialty code marks a "mixed jurisdiction" despacho
   * (promiscuo / pequeñas causas / competencia múltiple, esp 88/89).
   * The wizard MUST present a category-selection step and cannot
   * auto-classify; workflow will be null.
   */
  isMixed: boolean;
  /** Court competence: PURA / MIXTA / DESCONOCIDA. Only PURA may infer workflow. */
  competencia: Competencia;
  /** Possible subjects for a MIXTA despacho (empty for PURA/DESCONOCIDA). */
  competenciaSubjects: string[];
  /** Human-readable rationale for the derivation, shown in wizard banners. */
  reason: string;
}

/**
 * Department code (2 digits) → name.
 * Kept intentionally small — the wizard shows this as a suggestion, not a
 * source of truth. Municipal detail is left to the source (CPNU/SAMAI).
 */
const DEPT_NAMES: Record<string, string> = {
  "05": "Antioquia",              "08": "Atlántico",       "11": "Bogotá D.C.",
  "13": "Bolívar",                "15": "Boyacá",          "17": "Caldas",
  "18": "Caquetá",                "19": "Cauca",           "20": "Cesar",
  "23": "Córdoba",                "25": "Cundinamarca",    "27": "Chocó",
  "41": "Huila",                  "44": "La Guajira",      "47": "Magdalena",
  "50": "Meta",                   "52": "Nariño",          "54": "Norte de Santander",
  "63": "Quindío",                "66": "Risaralda",       "68": "Santander",
  "70": "Sucre",                  "73": "Tolima",          "76": "Valle del Cauca",
  "81": "Arauca",                 "85": "Casanare",        "86": "Putumayo",
  "88": "San Andrés y Providencia","91": "Amazonas",       "94": "Guainía",
  "95": "Guaviare",               "97": "Vaupés",          "99": "Vichada",
};

/**
 * DANE municipality code (5 digits) → city name.
 * Focused on the top-population municipalities where 95%+ of judicial
 * activity happens. If not found, we still return the department.
 */
const DANE_CITIES: Record<string, string> = {
  "05001": "Medellín",     "05088": "Bello",         "05266": "Envigado",
  "05360": "Itagüí",       "05380": "La Estrella",   "05631": "Sabaneta",
  "05615": "Rionegro",     "05045": "Apartadó",      "05837": "Turbo",
  "08001": "Barranquilla", "08758": "Soledad",       "08433": "Malambo",
  "11001": "Bogotá D.C.",
  "13001": "Cartagena",    "13430": "Magangué",
  "15001": "Tunja",        "15238": "Duitama",       "15759": "Sogamoso",
  "17001": "Manizales",    "18001": "Florencia",     "19001": "Popayán",
  "20001": "Valledupar",   "23001": "Montería",
  "25175": "Chía",         "25269": "Facatativá",    "25286": "Funza",
  "25290": "Fusagasugá",   "25307": "Girardot",      "25473": "Mosquera",
  "25754": "Soacha",       "25899": "Zipaquirá",
  "27001": "Quibdó",       "41001": "Neiva",         "44001": "Riohacha",
  "47001": "Santa Marta",  "50001": "Villavicencio", "52001": "Pasto",
  "54001": "Cúcuta",       "63001": "Armenia",       "66001": "Pereira",
  "66170": "Dosquebradas", "68001": "Bucaramanga",   "68081": "Barrancabermeja",
  "68276": "Floridablanca","70001": "Sincelejo",     "73001": "Ibagué",
  "76001": "Cali",         "76109": "Buenaventura",  "76520": "Palmira",
  "76834": "Tuluá",        "76892": "Yumbo",         "81001": "Arauca",
  "85001": "Yopal",        "86001": "Mocoa",         "88001": "San Andrés",
  "91001": "Leticia",
};

/**
 * Derive metadata from a 23-digit radicado.
 * Returns nulls for fields we can't infer with confidence.
 */
export function deriveFromRadicado(radicado: string): DerivedRadicado | null {
  const parsed = parseRadicadoBlocks(radicado);
  if (!parsed.valid || !parsed.blocks) return null;

  const { corp, esp, dane, dept } = parsed.blocks;
  const city = DANE_CITIES[dane] ?? null;
  const department = DEPT_NAMES[dept] ?? null;
  const comp = resolveCompetencia(radicado);

  const shared = {
    corp,
    esp,
    dane5: dane,
    city,
    department,
    competencia: comp.competencia,
    competenciaSubjects: comp.subjects as string[],
  };

  // Court competence, not subject matter. Only PURA infers the workflow.
  if (comp.competencia === "PURA" && comp.subjects.length === 1) {
    return {
      ...shared,
      workflow: comp.subjects[0],
      workflowConfidence: "high",
      jurisdictionLabel: comp.label,
      isMixed: false,
      reason: `Especialidad ${comp.esp} (${comp.label}) es de competencia pura.`,
    };
  }

  if (comp.competencia === "MIXTA") {
    return {
      ...shared,
      workflow: null,
      workflowConfidence: "low",
      jurisdictionLabel: comp.label,
      isMixed: true,
      reason: `${comp.label}: despacho de competencia mixta (${comp.subjects.join(", ")}). La materia NO se infiere del radicado.`,
    };
  }

  return {
    ...shared,
    workflow: null,
    workflowConfidence: "low",
    jurisdictionLabel: null,
    isMixed: false,
    reason: `Corporación ${corp} / especialidad ${esp} no permite derivar la materia automáticamente.`,
  };
}
