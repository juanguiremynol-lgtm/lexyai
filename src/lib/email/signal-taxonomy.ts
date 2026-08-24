/**
 * Email → work item signal taxonomy (Fase 3, B.3).
 *
 * Matching quality is an *admissibility* problem, not a scoring problem. The
 * measured production baseline is unambiguous: RADICADO ≈ 99% precision while
 * CLIENTE ≈ 1%, PARTE ≈ 5%, DESPACHO ≈ 2%. Name-class signals therefore never
 * suffice on their own, and their absence of a deterministic/strong signal is
 * enforced as a *ceiling*, not as a subtraction.
 */

export type SignalClass = "DETERMINISTIC" | "STRONG" | "WEAK" | "NEGATIVE";

export type SignalCode =
  // Deterministic
  | "IDENTIFIER_EXACT"
  | "INTERNET_MESSAGE_ID_LINKED"
  | "CONFIRMED_THREAD_CONTINUITY"
  // Strong
  | "IDENTIFIER_FUZZY"
  | "VERIFIED_AUTHORITY_DOMAIN"
  | "ATTACHMENT_IDENTIFIER"
  | "REPLY_TO_OUR_OUTBOUND"
  // Weak
  | "CLIENTE"
  | "PARTE"
  | "AUTHORITY_DISPLAY_NAME"
  | "OBSERVED_AUTHORITY_DOMAIN"
  | "ID_NUMBER"
  | "SUBJECT_SIMILARITY"
  | "DATE_PROXIMITY"
  | "SEMANTIC_SIMILARITY"
  // Negative
  | "IDENTIFIER_OF_OTHER_WORK_ITEM"
  | "AUTHORITY_MISMATCH"
  | "MESSAGE_PREDATES_FILING"
  | "TERMINAL_STAGE_NON_LATE_RESPONSE"
  | "AUTOMATED_NOISE"
  | "FORWARD_OUTSIDE_THREAD_PARTICIPANTS";

export interface SignalDefinition {
  code: SignalCode;
  klass: SignalClass;
  weight: number;
  label: string;
}

export const SIGNALS: Record<SignalCode, SignalDefinition> = {
  IDENTIFIER_EXACT: { code: "IDENTIFIER_EXACT", klass: "DETERMINISTIC", weight: 1.0, label: "Identificador exacto normalizado" },
  INTERNET_MESSAGE_ID_LINKED: { code: "INTERNET_MESSAGE_ID_LINKED", klass: "DETERMINISTIC", weight: 1.0, label: "Mensaje ya vinculado" },
  CONFIRMED_THREAD_CONTINUITY: { code: "CONFIRMED_THREAD_CONTINUITY", klass: "DETERMINISTIC", weight: 0.95, label: "Continuidad de hilo confirmado" },

  IDENTIFIER_FUZZY: { code: "IDENTIFIER_FUZZY", klass: "STRONG", weight: 0.55, label: "Identificador parcial o sin ceros" },
  VERIFIED_AUTHORITY_DOMAIN: { code: "VERIFIED_AUTHORITY_DOMAIN", klass: "STRONG", weight: 0.45, label: "Dominio verificado de la autoridad" },
  ATTACHMENT_IDENTIFIER: { code: "ATTACHMENT_IDENTIFIER", klass: "STRONG", weight: 0.45, label: "Identificador en el nombre del adjunto" },
  REPLY_TO_OUR_OUTBOUND: { code: "REPLY_TO_OUR_OUTBOUND", klass: "STRONG", weight: 0.5, label: "Respuesta a un envío propio del asunto" },

  CLIENTE: { code: "CLIENTE", klass: "WEAK", weight: 0.08, label: "Nombre del cliente" },
  PARTE: { code: "PARTE", klass: "WEAK", weight: 0.1, label: "Nombre de una parte" },
  AUTHORITY_DISPLAY_NAME: { code: "AUTHORITY_DISPLAY_NAME", klass: "WEAK", weight: 0.08, label: "Nombre visible de la autoridad" },
  OBSERVED_AUTHORITY_DOMAIN: { code: "OBSERVED_AUTHORITY_DOMAIN", klass: "WEAK", weight: 0.12, label: "Dominio observado, no verificado" },
  ID_NUMBER: { code: "ID_NUMBER", klass: "WEAK", weight: 0.12, label: "Número de identificación" },
  SUBJECT_SIMILARITY: { code: "SUBJECT_SIMILARITY", klass: "WEAK", weight: 0.08, label: "Similitud de asunto" },
  DATE_PROXIMITY: { code: "DATE_PROXIMITY", klass: "WEAK", weight: 0.05, label: "Proximidad de fechas" },
  SEMANTIC_SIMILARITY: { code: "SEMANTIC_SIMILARITY", klass: "WEAK", weight: 0.08, label: "Similitud semántica" },

  IDENTIFIER_OF_OTHER_WORK_ITEM: { code: "IDENTIFIER_OF_OTHER_WORK_ITEM", klass: "NEGATIVE", weight: -1.0, label: "Trae el identificador de otro asunto" },
  AUTHORITY_MISMATCH: { code: "AUTHORITY_MISMATCH", klass: "NEGATIVE", weight: -0.4, label: "La autoridad no corresponde" },
  MESSAGE_PREDATES_FILING: { code: "MESSAGE_PREDATES_FILING", klass: "NEGATIVE", weight: -0.4, label: "El mensaje es anterior a la radicación" },
  TERMINAL_STAGE_NON_LATE_RESPONSE: { code: "TERMINAL_STAGE_NON_LATE_RESPONSE", klass: "NEGATIVE", weight: -0.3, label: "Etapa terminal y mensaje no es respuesta tardía" },
  AUTOMATED_NOISE: { code: "AUTOMATED_NOISE", klass: "NEGATIVE", weight: -1.0, label: "Acuse, autorrespuesta o confirmación de lectura" },
  FORWARD_OUTSIDE_THREAD_PARTICIPANTS: { code: "FORWARD_OUTSIDE_THREAD_PARTICIPANTS", klass: "NEGATIVE", weight: -0.3, label: "Reenvío desde fuera del hilo" },
};

export const NAME_CLASS_SIGNALS: SignalCode[] = [
  "CLIENTE",
  "PARTE",
  "AUTHORITY_DISPLAY_NAME",
  "ID_NUMBER",
];

/** Vetoing negatives: no candidate survives them regardless of other evidence. */
export const VETO_SIGNALS: SignalCode[] = ["IDENTIFIER_OF_OTHER_WORK_ITEM", "AUTOMATED_NOISE"];

export function classOf(code: SignalCode): SignalClass {
  return SIGNALS[code].klass;
}

export function hasDeterministic(codes: SignalCode[]): boolean {
  return codes.some((c) => classOf(c) === "DETERMINISTIC");
}

export function hasStrong(codes: SignalCode[]): boolean {
  return codes.some((c) => classOf(c) === "STRONG");
}

export interface Ceilings {
  /** Max confidence when only weak signals are present. */
  weakOnlyCeiling: number;
  /** Max confidence when strong (but no deterministic) signals are present. */
  strongOnlyCeiling: number;
}

/**
 * The ceiling is applied to the *maximum achievable* confidence and is never a
 * subtraction: abundance of weak signals can never buy a deterministic result.
 */
export function confidenceCeiling(codes: SignalCode[], ceilings: Ceilings): number {
  if (hasDeterministic(codes)) return 1;
  if (hasStrong(codes)) return ceilings.strongOnlyCeiling;
  return ceilings.weakOnlyCeiling;
}

/** Raw additive score before the ceiling is applied. */
export function rawScore(codes: SignalCode[]): number {
  return codes.reduce((acc, c) => acc + SIGNALS[c].weight, 0);
}

export function scoreCandidate(codes: SignalCode[], ceilings: Ceilings): number {
  if (codes.some((c) => VETO_SIGNALS.includes(c))) return 0;
  const ceiling = confidenceCeiling(codes, ceilings);
  const raw = rawScore(codes);
  return Math.max(0, Math.min(raw, ceiling));
}
