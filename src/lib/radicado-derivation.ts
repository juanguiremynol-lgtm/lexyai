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
  /** Human-readable rationale for the derivation, shown in wizard banners. */
  reason: string;
}

/**
 * Corporation code → workflow_type
 *
 * Reference (Acuerdo PSAA06-3334, Consejo Superior de la Judicatura):
 *   30-32 → Civil / Familia / Comercial → CGP
 *   33-35 → Contencioso Administrativo → CPACA
 *   40-42 → Laboral → LABORAL
 *   06-08 → Penal municipal / circuito → PENAL_906
 *   09    → Ejecución de penas → PENAL_906
 *   36    → Penal para adolescentes → PENAL_906
 *   otros → null (usuario decide manualmente)
 */
/**
 * Corp mapping is used ONLY when the specialty code does not already
 * determine the workflow (LABORAL via esp 04/05 or MIXED via esp 88/89).
 * Corp codes 40-42 no longer imply LABORAL by themselves — that was the
 * source of the LABORAL misclassification for promiscuo / pequeñas causas
 * despachos with esp 89.
 */
const CORP_TO_WORKFLOW: Record<string, { workflow: WorkflowType; label: string; confidence: "high" | "medium" }> = {
  "06": { workflow: "PENAL_906", label: "Penal municipal",       confidence: "high" },
  "07": { workflow: "PENAL_906", label: "Penal circuito",        confidence: "high" },
  "08": { workflow: "PENAL_906", label: "Penal circuito esp.",   confidence: "high" },
  "09": { workflow: "PENAL_906", label: "Ejecución de penas",    confidence: "medium" },
  "30": { workflow: "CGP",       label: "Civil municipal",       confidence: "high" },
  "31": { workflow: "CGP",       label: "Civil circuito",        confidence: "high" },
  "32": { workflow: "CGP",       label: "Civil / Familia",       confidence: "high" },
  "33": { workflow: "CPACA",     label: "Administrativo",        confidence: "high" },
  "34": { workflow: "CPACA",     label: "Tribunal Administrativo",confidence: "high" },
  "35": { workflow: "CPACA",     label: "Consejo de Estado",     confidence: "high" },
  "36": { workflow: "PENAL_906", label: "Penal adolescentes",    confidence: "high" },
};

/**
 * Specialty (esp) codes that unambiguously mark labor jurisdiction
 * per the DANE codification of the Rama Judicial.
 *   04 → Laboral
 *   05 → Laboral (circuito / sala)
 */
const LABORAL_ESP = new Set(["04", "05"]);

/**
 * Specialty (esp) codes that mark mixed-jurisdiction despachos where
 * the workflow CANNOT be inferred from the radicado and the wizard
 * MUST prompt the user.
 *   88 → Pequeñas causas y competencia múltiple
 *   89 → Promiscuo (civil, laboral, familia)
 */
const MIXED_ESP = new Set(["88", "89"]);

/**
 * Detects "Juzgado Civil con Conocimiento en Asuntos Laborales" and
 * similar despachos where a civil-corp code (30-32) actually hears
 * labor matters. Returns true when the despacho name should suggest
 * LABORAL as a user-confirmed override.
 */
export function detectLaboralFromDespacho(despacho: string | null | undefined): boolean {
  if (!despacho) return false;
  const t = despacho.toLowerCase();
  // Positive: "civil ... conocimiento/asuntos laborales" or explicit "laboral" label
  const hasCivilConoceLaboral = /(civil|circuito)[^.]*(conocimiento|asuntos)\s+laborales?/i.test(despacho);
  const hasExplicitLaboral = /\b(juzgado|sala|tribunal)\s+laboral\b/i.test(despacho) || /\bsala\s+laboral\b/i.test(despacho);
  return hasCivilConoceLaboral || hasExplicitLaboral;
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

  // 1) Specialty-first rules override corp-based mapping.

  // Mixed jurisdiction: refuse to auto-classify.
  if (MIXED_ESP.has(esp)) {
    return {
      corp, esp, dane5: dane,
      workflow: null,
      workflowConfidence: "low",
      city, department,
      jurisdictionLabel: esp === "88" ? "Pequeñas causas / competencia múltiple" : "Promiscuo",
      isMixed: true,
      reason: `Especialidad ${esp} indica despacho de competencia mixta — la naturaleza del proceso debe confirmarse manualmente.`,
    };
  }

  // Laboral unambiguously determined by specialty.
  if (LABORAL_ESP.has(esp)) {
    return {
      corp, esp, dane5: dane,
      workflow: "LABORAL",
      workflowConfidence: "high",
      city, department,
      jurisdictionLabel: "Laboral",
      isMixed: false,
      reason: `Especialidad ${esp} corresponde a jurisdicción laboral.`,
    };
  }

  // 2) Corp-based mapping for the remaining cases. Corp 40-42 without
  //    laboral esp fall through to esp-based fallbacks below.
  const wfEntry = CORP_TO_WORKFLOW[corp] ?? null;
  if (wfEntry) {
    return {
      corp, esp, dane5: dane,
      workflow: wfEntry.workflow,
      workflowConfidence: wfEntry.confidence,
      city, department,
      jurisdictionLabel: wfEntry.label,
      isMixed: false,
      reason: `Corporación ${corp} (${wfEntry.label}).`,
    };
  }

  // 3) Corp 40-42 with non-laboral esp: derive by esp when possible.
  //    esp 03 civil, esp 08/09 familia → all handled under CGP taxonomy.
  if (corp === "40" || corp === "41" || corp === "42") {
    if (esp === "03") {
      return {
        corp, esp, dane5: dane,
        workflow: "CGP",
        workflowConfidence: "medium",
        city, department,
        jurisdictionLabel: "Civil (esp 03)",
        isMixed: false,
        reason: `Corporación ${corp} con especialidad civil (03).`,
      };
    }
    if (esp === "08" || esp === "09") {
      return {
        corp, esp, dane5: dane,
        workflow: "CGP",
        workflowConfidence: "medium",
        city, department,
        jurisdictionLabel: "Familia (esp " + esp + ")",
        isMixed: false,
        reason: `Corporación ${corp} con especialidad familia (${esp}).`,
      };
    }
  }

  // 4) Unknown — wizard must ask.
  return {
    corp, esp, dane5: dane,
    workflow: null,
    workflowConfidence: "low",
    city, department,
    jurisdictionLabel: null,
    isMixed: false,
    reason: `Corporación ${corp} / especialidad ${esp} no permite derivar la jurisdicción automáticamente.`,
  };
}