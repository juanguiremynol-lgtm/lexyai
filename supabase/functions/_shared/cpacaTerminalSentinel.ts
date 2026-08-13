/**
 * cpacaTerminalSentinel.ts — ITERATION 55, item D.
 *
 * GCP's sweep over the five CPACA matters corrected the discriminator:
 *
 *   etapa = "Finalizado"  appears on 1 of 5 — the remitted matter only. SIGNAL.
 *   ubicacion = "Archivo" appears on 4 of 5, three of them healthy at
 *                          etapa = "Admisión". WORTHLESS ALONE.
 *   corporación does NOT change on remisión (the remitted matter still reads
 *   Juzgado Administrativo de Medellín) — which is what confirms the terminal
 *   transition reading and refutes the ubicación half.
 *
 * Two caveats we must respect rather than smooth over:
 *   · n=5 with a single positive is a thin base.
 *   · "Finalizado" also covers an ordinary ending (sentencia ejecutoriada).
 *
 * So: terminal etapa + remisión vocabulary in the acts = REMISION;
 *     terminal etapa + sentencia/ejecutoria vocabulary = TERMINACION_ORDINARIA;
 *     terminal etapa with neither = TERMINAL_NO_CLASIFICADO, and it must SAY SO.
 */

import { classifyRemisionStream } from "./remisionCompetencia.ts";

export type CpacaTerminalClass =
  | "NO_TERMINAL"
  | "REMISION"
  /**
   * ITER57 — the horizontal remisión. It is a REMISION for every purpose that
   * silences the origin's estados, but its successor is a brand new radicado at
   * another despacho, not the same file one instance up.
   */
  | "REMISION_COMPETENCIA"
  | "TERMINACION_ORDINARIA"
  | "TERMINAL_NO_CLASIFICADO";

const TERMINAL_ETAPAS = ["finalizado", "finalizada", "terminado", "terminada"];

const REMISION_PATTERNS = [
  /remisi[oó]n\s+(de\s+)?expediente/,
  /remite\s+(el\s+)?expediente/,
  /env[ií]o\s+a\s+otros?\s+despachos?/,
  /env[ií]a\s+a\s+otros?\s+despachos?/,
  /env[ií]o\s+a\s+superior/,
  /remite\s+por\s+competencia/,
  /al\s+ta[a]?\b/,
];

const TERMINACION_PATTERNS = [
  /sentencia\s+ejecutoriada/,
  /ejecutoria(?!l)/,
  /auto\s+que\s+declara\s+la\s+terminaci[oó]n/,
  /terminaci[oó]n\s+del\s+proceso/,
  /desistimiento/,
  /archivo\s+definitivo/,
];

function norm(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** ONLY etapa carries the terminal signal. ubicación is deliberately ignored. */
export function isTerminalEtapa(etapa: string | null | undefined): boolean {
  const e = norm(etapa).trim();
  return TERMINAL_ETAPAS.some((t) => e === t || e.includes(t));
}

function matches(text: string, patterns: RegExp[]): boolean {
  const t = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // Patterns are written with accents; compare against both forms.
  return patterns.some((p) => p.test(t) || p.test(text.toLowerCase()));
}

export interface CpacaTerminalInput {
  etapa?: string | null;
  /** Act descriptions, most recent first or in any order. */
  act_descriptions?: Array<string | null | undefined>;
  /** Present for completeness — never used as a discriminator. */
  ubicacion?: string | null;
}

export interface CpacaTerminalVerdict {
  klass: CpacaTerminalClass;
  /** Spanish, user-facing. */
  reason: string;
  /** The act text that decided it, when any. */
  evidence: string | null;
}

export function classifyCpacaTerminal(input: CpacaTerminalInput): CpacaTerminalVerdict {
  if (!isTerminalEtapa(input.etapa)) {
    return {
      klass: "NO_TERMINAL",
      reason: "La etapa reportada por el proveedor no es terminal.",
      evidence: null,
    };
  }

  const acts = (input.act_descriptions ?? []).filter(
    (a): a is string => typeof a === "string" && a.trim() !== "",
  );

  const remision = acts.find((a) => matches(a, REMISION_PATTERNS));
  if (remision) {
    // ITER57 — one classifier decides the direction of a remisión. The sentinel
    // only decides that the matter is terminal.
    const dir = classifyRemisionStream(acts);
    if (dir.klass === "REMITIDO_POR_COMPETENCIA") {
      return {
        klass: "REMISION_COMPETENCIA",
        reason:
          "Etapa terminal con declaración de incompetencia: el expediente se remitió horizontalmente a otro despacho, que asignará un radicado nuevo.",
        evidence: dir.evidence ?? remision,
      };
    }
    return {
      klass: "REMISION",
      reason:
        "Etapa terminal con vocabulario de remisión en las actuaciones: el expediente salió del despacho de origen.",
      evidence: remision,
    };
  }

  const terminacion = acts.find((a) => matches(a, TERMINACION_PATTERNS));
  if (terminacion) {
    return {
      klass: "TERMINACION_ORDINARIA",
      reason:
        "Etapa terminal con vocabulario de terminación ordinaria (sentencia o ejecutoria): el proceso terminó en este despacho.",
      evidence: terminacion,
    };
  }

  return {
    klass: "TERMINAL_NO_CLASIFICADO",
    reason:
      "Etapa terminal sin vocabulario de remisión ni de terminación en las actuaciones: no es posible distinguir una remisión de un final ordinario. Queda sin clasificar.",
    evidence: null,
  };
}

/** Only a remisión verdict may silence missing estados in the origin despacho. */
export function terminalSilencesEstados(v: CpacaTerminalVerdict): boolean {
  return v.klass === "REMISION" || v.klass === "REMISION_COMPETENCIA";
}
