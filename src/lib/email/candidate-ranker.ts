/**
 * Candidate ranking, ambiguity detection and the three outcomes (Fase 3, B.4).
 *
 * Thresholds are never constants here: they arrive as configuration rows from
 * `email_matching_thresholds` (per workflow, with organisation overrides).
 */

import {
  SignalCode,
  VETO_SIGNALS,
  classOf,
  confidenceCeiling,
  hasDeterministic,
  hasStrong,
  scoreCandidate,
} from "./signal-taxonomy";

export type MatchOutcome = "AUTO_LINK" | "SUGGEST" | "NO_CANDIDATE";

/**
 * Fase 5 / A.2 — where a proposal lands.
 *
 * Measured on the historical corpus: of 616 name-class candidates only 14 were
 * ever confirmed (2.3%). Keeping them out of the queue that raises attention is
 * therefore the correct treatment — but they are not discarded either, since
 * those 14 confirmations must stay recoverable. Hence two surfaces:
 *
 *   cola_activa       — deterministic or strong evidence; raises an attention
 *                       condition and shows on the card.
 *   repositorio_pasivo — weak-only evidence; searchable from the work item,
 *                       raises nothing, notifies nothing.
 */
export type MatchQueue = "cola_activa" | "repositorio_pasivo";

/** Weak-only evidence never reaches the active queue, whatever its score. */
export function queueFor(signals: SignalCode[]): MatchQueue {
  return hasDeterministic(signals) || hasStrong(signals)
    ? "cola_activa"
    : "repositorio_pasivo";
}

/** Only the active queue may raise an attention condition (B.3 dimension). */
export function raisesAttention(result: Pick<RankingResult, "outcome" | "queue">): boolean {
  return result.outcome !== "NO_CANDIDATE" && result.queue === "cola_activa";
}

export interface MatchingThresholds {
  workflowType: string;
  autoLinkFloor: number;
  suggestFloor: number;
  /**
   * Fase 4 / A.3: name-class evidence is capped by a *ceiling*, never erased.
   * A candidate carrying only weak signals still reaches the lawyer as a
   * suggestion — it simply can never auto-link.
   */
  weakSuggestFloor: number;
  ambiguityMargin: number;
  weakOnlyCeiling: number;
  strongOnlyCeiling: number;
  requiresDeterministicForAutoLink: boolean;
}

export const FALLBACK_THRESHOLDS: MatchingThresholds = {
  workflowType: "DEFAULT",
  autoLinkFloor: 0.9,
  suggestFloor: 0.35,
  weakSuggestFloor: 0.05,
  ambiguityMargin: 0.1,
  weakOnlyCeiling: 0.45,
  strongOnlyCeiling: 0.85,
  requiresDeterministicForAutoLink: true,
};

export interface CandidateInput {
  workItemId: string;
  signals: SignalCode[];
  /** Provenance of a thread inheritance, when continuity was used. */
  inheritance?: {
    sourceLinkId: string;
    hops: number;
    participants: string[];
  };
}

export interface RankedCandidate {
  workItemId: string;
  score: number;
  ceiling: number;
  vetoed: boolean;
  conflict: boolean;
  signals: Array<{ code: SignalCode; klass: string }>;
  inheritance?: CandidateInput["inheritance"];
}

export interface RankingResult {
  outcome: MatchOutcome;
  top: RankedCandidate | null;
  candidates: RankedCandidate[];
  ambiguous: boolean;
  conflict: boolean;
  /** A.2: which surface the proposal belongs to. */
  queue: MatchQueue;
  /** Human-readable reason the top candidate did not auto-link. */
  reason: string;
}

export function rankCandidates(
  inputs: CandidateInput[],
  thresholds: MatchingThresholds,
  topN = 5,
): RankingResult {
  const ceilings = {
    weakOnlyCeiling: thresholds.weakOnlyCeiling,
    strongOnlyCeiling: thresholds.strongOnlyCeiling,
  };

  const ranked: RankedCandidate[] = inputs
    .map((c) => {
      const vetoed = c.signals.some((s) => VETO_SIGNALS.includes(s));
      return {
        workItemId: c.workItemId,
        score: scoreCandidate(c.signals, ceilings),
        ceiling: confidenceCeiling(c.signals, ceilings),
        vetoed,
        conflict: c.signals.includes("IDENTIFIER_OF_OTHER_WORK_ITEM"),
        signals: c.signals.map((code) => ({ code, klass: classOf(code) })),
        inheritance: c.inheritance,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  const top = ranked[0] ?? null;
  const second = ranked[1] ?? null;

  const weakFloor = thresholds.weakSuggestFloor ?? FALLBACK_THRESHOLDS.weakSuggestFloor;

  if (!top || top.score < weakFloor) {
    return {
      outcome: "NO_CANDIDATE",
      queue: top ? queueFor(top.signals.map((s) => s.code)) : "repositorio_pasivo",
      top,
      candidates: ranked,
      ambiguous: false,
      conflict: top?.conflict ?? false,
      reason: "Ningún candidato alcanza el piso mínimo de evidencia.",
    };
  }

  if (top.score < thresholds.suggestFloor) {
    // A.3: weak-only evidence is still shown, always as a proposal.
    return {
      outcome: "SUGGEST",
      queue: top ? queueFor(top.signals.map((s) => s.code)) : "repositorio_pasivo",
      top,
      candidates: ranked,
      ambiguous: false,
      conflict: top.conflict,
      reason:
        "Evidencia únicamente de nombre: se propone para revisión, nunca se vincula automáticamente.",
    };
  }

  const ambiguous =
    !!second && !second.vetoed && Math.abs(top.score - second.score) < thresholds.ambiguityMargin;

  const topSignals = top.signals.map((s) => s.code);
  const deterministic = hasDeterministic(topSignals);

  if (ambiguous) {
    return {
      outcome: "SUGGEST",
      queue: top ? queueFor(top.signals.map((s) => s.code)) : "repositorio_pasivo",
      top,
      candidates: ranked,
      ambiguous: true,
      conflict: top.conflict,
      reason: "Dos candidatos con puntajes equivalentes: se requiere confirmación.",
    };
  }

  if (top.conflict) {
    return {
      outcome: "SUGGEST",
      queue: top ? queueFor(top.signals.map((s) => s.code)) : "repositorio_pasivo",
      top,
      candidates: ranked,
      ambiguous: false,
      conflict: true,
      reason: "El mensaje trae el identificador de otro asunto: conflicto marcado.",
    };
  }

  if (thresholds.requiresDeterministicForAutoLink && !deterministic) {
    return {
      outcome: "SUGGEST",
      queue: top ? queueFor(top.signals.map((s) => s.code)) : "repositorio_pasivo",
      top,
      candidates: ranked,
      ambiguous: false,
      conflict: false,
      reason: "Sin señal determinística: se propone, nunca se vincula automáticamente.",
    };
  }

  if (top.score < thresholds.autoLinkFloor) {
    return {
      outcome: "SUGGEST",
      queue: top ? queueFor(top.signals.map((s) => s.code)) : "repositorio_pasivo",
      top,
      candidates: ranked,
      ambiguous: false,
      conflict: false,
      reason: "El candidato no alcanza el piso de vinculación automática.",
    };
  }

  return {
    outcome: "AUTO_LINK",
    queue: queueFor(top.signals.map((s) => s.code)),
    top,
    candidates: ranked,
    ambiguous: false,
    conflict: false,
    reason: "Señal determinística sin conflicto ni ambigüedad.",
  };
}

/**
 * Thread continuity (B.6): continuity may only be inherited from a CONFIRMED
 * link, and never chained through unconfirmed hops.
 */
export function threadContinuitySignal(input: {
  sourceLinkStatus: string;
  hops: number;
  senderIsThreadParticipant: boolean;
  carriesOtherIdentifier: boolean;
}): { signal: SignalCode | null; downgrade: SignalCode | null; reason: string } {
  if (input.sourceLinkStatus !== "CONFIRMED") {
    return { signal: null, downgrade: null, reason: "El hilo de origen no está confirmado." };
  }
  if (input.hops > 1) {
    return { signal: null, downgrade: null, reason: "La herencia no se encadena por saltos no confirmados." };
  }
  if (input.carriesOtherIdentifier) {
    return {
      signal: null,
      downgrade: "IDENTIFIER_OF_OTHER_WORK_ITEM",
      reason: "El mensaje del hilo trae el identificador de otro asunto.",
    };
  }
  if (!input.senderIsThreadParticipant) {
    return {
      signal: "OBSERVED_AUTHORITY_DOMAIN",
      downgrade: "FORWARD_OUTSIDE_THREAD_PARTICIPANTS",
      reason: "Reenvío desde fuera del hilo: pierde el carácter fuerte.",
    };
  }
  return {
    signal: "CONFIRMED_THREAD_CONTINUITY",
    downgrade: null,
    reason: "Continuidad heredada de un vínculo confirmado.",
  };
}

/** Map a legacy `matched_by` value onto the new taxonomy (used by the backtest). */
export function legacyMatchedByToSignals(matchedBy: string): SignalCode[] {
  switch (matchedBy) {
    case "RADICADO":
      return ["IDENTIFIER_EXACT"];
    case "RADICADO_PARCIAL":
    case "RADICADO_SIN_CERO":
      return ["IDENTIFIER_FUZZY"];
    case "CLIENTE":
      return ["CLIENTE"];
    case "PARTE":
      return ["PARTE"];
    case "DESPACHO":
      return ["AUTHORITY_DISPLAY_NAME"];
    default:
      return [];
  }
}
