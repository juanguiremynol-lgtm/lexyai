/**
 * Demo Ambiguity Detection — presentation-only layer.
 * 
 * Detects "tutela hints" in actuaciones/despacho text when the inferred
 * category is NOT TUTELA, so the UI can show appropriate notices.
 * Does NOT change inference logic or provider wiring.
 */

import type { DemoResult } from "./demo-types";
import type { DemoCategory } from "./demo-pipeline-stages";

const TUTELA_KEYWORDS = [
  "tutela",
  "acción de tutela",
  "accion de tutela",
  "constitucional",
  "amparo",
  "derecho de petición",
  "derecho fundamental",
  "auto admisorio de tutela",
];

export interface AmbiguityResult {
  /** True if hints of a different category exist in the data */
  hasAmbiguity: boolean;
  /** The inferred category */
  inferredCategory: DemoCategory;
  /** Whether tutela-like signals were found */
  hasTutelaHints: boolean;
  /** Specific hints found */
  tutelaHintSources: string[];
  /** User-facing explanation */
  ambiguityNotice: string | null;
  /** Suggestion text for the category selector */
  selectorHint: string | null;
}

/**
 * Detect ambiguity between inferred category and evidence in the data.
 * Presentation-only — does not modify inference results.
 */
export function detectDemoAmbiguity(data: DemoResult): AmbiguityResult {
  const inferred = (data.category_inference?.category || "UNCERTAIN") as DemoCategory;
  const confidence = data.category_inference?.confidence || "UNCERTAIN";

  // Only check for tutela hints when inferred is NOT tutela
  if (inferred === "TUTELA") {
    return {
      hasAmbiguity: false,
      inferredCategory: inferred,
      hasTutelaHints: false,
      tutelaHintSources: [],
      ambiguityNotice: null,
      selectorHint: null,
    };
  }

  const hints: string[] = [];

  // Check despacho text
  const despacho = (data.resumen.despacho || "").toLowerCase();
  for (const kw of TUTELA_KEYWORDS) {
    if (despacho.includes(kw)) {
      hints.push(`Despacho contiene "${kw}"`);
      break;
    }
  }

  // Check actuaciones descriptions
  for (const act of data.actuaciones) {
    const text = `${act.descripcion || ""} ${act.tipo || ""} ${act.anotacion || ""}`.toLowerCase();
    for (const kw of TUTELA_KEYWORDS) {
      if (text.includes(kw)) {
        hints.push(`Actuación contiene "${kw}"`);
        break;
      }
    }
    if (hints.length >= 3) break; // cap for display
  }

  // Check tipo_proceso
  const tipo = (data.resumen.tipo_proceso || "").toLowerCase();
  for (const kw of TUTELA_KEYWORDS) {
    if (tipo.includes(kw)) {
      hints.push(`Tipo de proceso contiene "${kw}"`);
      break;
    }
  }

  const hasTutelaHints = hints.length > 0;

  // Build notices
  let ambiguityNotice: string | null = null;
  let selectorHint: string | null = null;

  if (hasTutelaHints) {
    const inferredLabel = inferred === "PENAL_906" ? "Penal" : inferred === "CGP" ? "CGP" : inferred;
    ambiguityNotice = `Este caso fue auto-detectado como ${inferredLabel}, pero algunas fuentes contienen referencias a tutela. ` +
      `Es posible que sea una tutela radicada en un juzgado ${inferredLabel.toLowerCase()}. ` +
      `Puedes previsualizar el pipeline de Tutela a continuación.`;
    selectorHint = "Selecciona el pipeline que deseas previsualizar";
  } else if (
    (inferred === "PENAL_906" || inferred === "CGP") &&
    (confidence === "MEDIUM" || confidence === "LOW")
  ) {
    const inferredLabel = inferred === "PENAL_906" ? "Penal" : "CGP";
    ambiguityNotice = `Auto-detectado como ${inferredLabel} (basado en despacho y jurisdicción). ` +
      `Si necesitas gestionar este caso con un flujo diferente, puedes previsualizar otro pipeline.`;
    selectorHint = "Previsualizar pipeline como";
  }

  return {
    hasAmbiguity: hasTutelaHints || (ambiguityNotice !== null),
    inferredCategory: inferred,
    hasTutelaHints,
    tutelaHintSources: hints,
    ambiguityNotice,
    selectorHint,
  };
}
