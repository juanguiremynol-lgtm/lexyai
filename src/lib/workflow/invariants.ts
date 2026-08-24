/**
 * Permanent non-regression invariants (Fase 2 onwards).
 *
 * These three rules are acceptance criteria for every future Andromeda
 * workflow, not guidance. `src/__tests__/workflow-invariants.test.ts` asserts
 * them; a failure is a build failure.
 *
 *   I1. No AI-inferred event becomes a definitive procedural fact on its own
 *       when the evidence does not reach the threshold for that workflow.
 *   I2. No legal term is computed without an explicit class, an explicit
 *       anchor, and calendar coverage for the whole span it walks.
 *   I3. No catalog-governed workflow accepts free-text stage values.
 */

// ---------------------------------------------------------------------- I1

export type EvidenceSource = "AI_INFERENCE" | "PROVIDER" | "EMAIL" | "USER" | "SYSTEM_RULE";

export interface InferredEventInput {
  source: EvidenceSource;
  /** 0..1 model confidence, when the source is an inference. */
  confidence?: number | null;
  /** A human explicitly confirmed this event. */
  humanConfirmed?: boolean;
  /** An authoritative, non-inferred record corroborates it (provider act, notification record). */
  corroboratedByAuthoritativeRecord?: boolean;
}

/** Per-workflow confidence threshold above which an inference may be *proposed*. */
export const INFERENCE_SUGGESTION_THRESHOLD: Record<string, number> = {
  GOV_PROCEDURE: 0.8,
  PETICION: 0.8,
};

export interface InferenceVerdict {
  /** May the event be recorded as a definitive procedural fact? */
  isDefinitiveFact: boolean;
  /** May it be surfaced as a suggestion for the lawyer? */
  createsSuggestion: boolean;
  requiresHumanConfirmation: boolean;
  reason: string;
}

export function classifyInferredEvent(
  workflowType: string,
  input: InferredEventInput,
): InferenceVerdict {
  if (input.humanConfirmed) {
    return {
      isDefinitiveFact: true,
      createsSuggestion: false,
      requiresHumanConfirmation: false,
      reason: "Confirmado por una persona.",
    };
  }
  if (input.source !== "AI_INFERENCE") {
    return {
      isDefinitiveFact: true,
      createsSuggestion: false,
      requiresHumanConfirmation: false,
      reason: "Origen no inferido: registro autoritativo.",
    };
  }
  const threshold = INFERENCE_SUGGESTION_THRESHOLD[workflowType] ?? 0.8;
  const confidence = input.confidence ?? 0;
  // I1: an inference NEVER becomes a definitive fact by itself, regardless of
  // confidence. Corroboration or human confirmation is the only way through.
  if (input.corroboratedByAuthoritativeRecord) {
    return {
      isDefinitiveFact: true,
      createsSuggestion: false,
      requiresHumanConfirmation: false,
      reason: "Inferencia corroborada por un registro autoritativo.",
    };
  }
  return {
    isDefinitiveFact: false,
    createsSuggestion: confidence >= threshold,
    requiresHumanConfirmation: true,
    reason:
      confidence >= threshold
        ? "Inferencia sobre el umbral: se propone, no se aplica."
        : "Inferencia bajo el umbral: no alcanza ni para proponer.",
  };
}

// ---------------------------------------------------------------------- I2

export type TermClassValue = "JUDICIAL" | "ADMINISTRATIVO";
export type AnchorKindValue =
  | "ISSUANCE"
  | "NOTIFICATION"
  | "TERM_EXPIRY"
  | "FACT_DATE"
  | "FILING_DATE";

export interface TermComputationInput {
  termClass: TermClassValue | null | undefined;
  anchorKind: AnchorKindValue | null | undefined;
  anchorDate: string | null | undefined;
  durationValue: number | null | undefined;
  dayType: "BUSINESS" | "CALENDAR" | "MONTHS" | "YEARS" | null | undefined;
  /** Years for which the holiday calendar is fully seeded. */
  coveredYears: number[];
  /** Last calendar year the walk can reach. */
  spanEndYear: number;
}

export interface TermComputationVerdict {
  computable: boolean;
  blockingReasons: string[];
}

export function assertComputableTerm(input: TermComputationInput): TermComputationVerdict {
  const blocking: string[] = [];
  if (!input.termClass) blocking.push("MISSING_TERM_CLASS");
  if (!input.anchorKind) blocking.push("MISSING_ANCHOR_KIND");
  if (!input.anchorDate) blocking.push("MISSING_ANCHOR_DATE");
  if (input.durationValue === null || input.durationValue === undefined)
    blocking.push("MISSING_DURATION");
  else if (input.durationValue <= 0) blocking.push("ZERO_OR_NEGATIVE_DURATION");
  if (!input.dayType) blocking.push("MISSING_DAY_TYPE");

  if (input.dayType === "BUSINESS" && input.anchorDate) {
    const startYear = Number(input.anchorDate.slice(0, 4));
    for (let y = startYear; y <= input.spanEndYear; y++) {
      if (!input.coveredYears.includes(y)) {
        blocking.push(`MISSING_CALENDAR_COVERAGE_${y}`);
      }
    }
  }
  return { computable: blocking.length === 0, blockingReasons: blocking };
}

// ---------------------------------------------------------------------- I3

/** Workflows already governed by the stage catalog. Additive only. */
export const CATALOG_GOVERNED_WORKFLOWS = ["PETICION", "GOV_PROCEDURE"] as const;

export function isCatalogGoverned(workflowType: string): boolean {
  return (CATALOG_GOVERNED_WORKFLOWS as readonly string[]).includes(workflowType);
}

export function assertStageAllowed(
  workflowType: string,
  stageCode: string | null | undefined,
  catalogCodes: readonly string[],
): { allowed: boolean; reason?: string } {
  if (!isCatalogGoverned(workflowType)) return { allowed: true };
  if (!stageCode) return { allowed: false, reason: "EMPTY_STAGE" };
  if (!catalogCodes.includes(stageCode))
    return { allowed: false, reason: `FREE_TEXT_STAGE:${stageCode}` };
  return { allowed: true };
}
