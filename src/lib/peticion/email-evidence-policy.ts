/**
 * PETICION email evidence policy — Phase 1 (deliberately conservative).
 *
 * Email evidence for a petition may ONLY create a `work_item_stage_suggestions`
 * row. It may never apply a stage, create a deadline, or close one.
 *
 * Measured production precision: RADICADO ≈ 99%, DESPACHO ≈ 2%, PARTE ≈ 5%,
 * CLIENTE ≈ 1%. Peticiones have no judicial radicado, so name-only matchers are
 * blocked outright.
 */

export type PeticionMatcher =
  | "AUTHORITY_RADICADO"
  | "CONFIRMED_THREAD"
  | "AUTHORITY_DOMAIN"
  | "CLIENTE"
  | "PARTE"
  | "DESPACHO";

export type EvidenceStrength = "HIGH" | "STRONG" | "CANDIDATE" | "BLOCKED";

export interface EvidenceInput {
  matchers: PeticionMatcher[];
  /** Other petition facts corroborate the message (subject, entity, dates). */
  contextCompatible?: boolean;
  /** Message classified as noise: acuse, read receipt, out-of-office, autoreply. */
  isNoise?: boolean;
  /** More than one petition matches the same evidence. */
  ambiguous?: boolean;
}

export interface EvidenceDecision {
  strength: EvidenceStrength;
  /** A suggestion row is the ONLY artefact ever produced in this phase. */
  createsSuggestion: boolean;
  autoAssociate: false;
  appliesStage: false;
  createsDeadline: false;
  closesDeadline: false;
  requiresHumanReview: boolean;
  reason: string;
}

const NEVER_ACTS = {
  autoAssociate: false,
  appliesStage: false,
  createsDeadline: false,
  closesDeadline: false,
} as const;

/** Name-only matchers can never be the primary link for a petition. */
export const BLOCKED_PRIMARY_MATCHERS: PeticionMatcher[] = ["CLIENTE", "PARTE"];

export function classifyPeticionEmailEvidence(input: EvidenceInput): EvidenceDecision {
  const { matchers, contextCompatible = false, isNoise = false, ambiguous = false } = input;

  if (isNoise) {
    return {
      strength: "BLOCKED",
      createsSuggestion: false,
      ...NEVER_ACTS,
      requiresHumanReview: false,
      reason: "Acuse de recibo, confirmación de lectura, fuera de oficina o respuesta automática: registrado y descartado.",
    };
  }

  const substantive = matchers.filter((m) => !BLOCKED_PRIMARY_MATCHERS.includes(m));
  if (substantive.length === 0) {
    return {
      strength: "BLOCKED",
      createsSuggestion: false,
      ...NEVER_ACTS,
      requiresHumanReview: false,
      reason: "Solo coincidencia por cliente o parte: insuficiente para PETICION.",
    };
  }

  const hasRadicado = substantive.includes("AUTHORITY_RADICADO");
  const hasThread = substantive.includes("CONFIRMED_THREAD");
  const hasDomain = substantive.includes("AUTHORITY_DOMAIN");

  if (ambiguous) {
    return {
      strength: "CANDIDATE",
      createsSuggestion: true,
      ...NEVER_ACTS,
      requiresHumanReview: true,
      reason: "Evidencia ambigua: más de una petición compatible. Requiere revisión humana.",
    };
  }

  if (hasThread || (hasRadicado && contextCompatible)) {
    return {
      strength: "HIGH",
      createsSuggestion: true,
      ...NEVER_ACTS,
      requiresHumanReview: true,
      reason: hasThread
        ? "Hilo previamente confirmado."
        : "Radicado de la entidad con contexto compatible.",
    };
  }

  if (hasRadicado && hasDomain) {
    return {
      strength: "STRONG",
      createsSuggestion: true,
      ...NEVER_ACTS,
      requiresHumanReview: true,
      reason: "Radicado de la entidad + dominio registrado de la autoridad.",
    };
  }

  if (hasRadicado) {
    return {
      strength: "STRONG",
      createsSuggestion: true,
      ...NEVER_ACTS,
      requiresHumanReview: true,
      reason: "Radicado de la entidad sin corroboración adicional.",
    };
  }

  return {
    strength: "CANDIDATE",
    createsSuggestion: true,
    ...NEVER_ACTS,
    requiresHumanReview: true,
    reason: "Dominio de la entidad por sí solo: evidencia positiva, nunca identificador.",
  };
}

/** Noise subtypes recorded in the event vocabulary and visibly discarded. */
export const PETICION_NOISE_EVENT_CODES = [
  "ACUSE_DE_RECIBO",
  "CONFIRMACION_LECTURA",
  "FUERA_DE_OFICINA",
  "RESPUESTA_AUTOMATICA",
] as const;
