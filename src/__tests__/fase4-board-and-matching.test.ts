/**
 * Fase 4 verification:
 *  A.3 — name-class evidence survives as a suggestion (ceiling, not exclusion).
 *  B/C — attention is not stage; the board only offers catalog transitions.
 */
import { describe, it, expect } from "vitest";
import {
  FALLBACK_THRESHOLDS,
  rankCandidates,
  type MatchingThresholds,
} from "@/lib/email/candidate-ranker";
import {
  evaluateMove,
  BAND_COLOR,
  BAND_LABEL,
  type CatalogTransition,
} from "@/hooks/use-workflow-catalog-board";

const T: MatchingThresholds = FALLBACK_THRESHOLDS;

describe("A.3 — name-class backtest", () => {
  it("a lone CLIENTE/PARTE/AUTHORITY_DISPLAY_NAME signal is suggested, never dropped", () => {
    for (const s of ["CLIENTE", "PARTE", "AUTHORITY_DISPLAY_NAME"] as const) {
      const r = rankCandidates([{ workItemId: "wi", signals: [s] }], T);
      expect(r.outcome).toBe("SUGGEST");
    }
  });

  it("weak-only evidence can never auto-link, however much of it accumulates", () => {
    const r = rankCandidates(
      [
        {
          workItemId: "wi",
          signals: ["CLIENTE", "PARTE", "SUBJECT_SIMILARITY", "DATE_PROXIMITY", "ID_NUMBER"],
        },
      ],
      T,
    );
    expect(r.outcome).toBe("SUGGEST");
    expect(r.top!.score).toBeLessThanOrEqual(T.weakOnlyCeiling);
  });

  it("vetoing negatives still remove the candidate entirely", () => {
    const r = rankCandidates(
      [{ workItemId: "wi", signals: ["CLIENTE", "AUTOMATED_NOISE"] }],
      T,
    );
    expect(r.outcome).toBe("NO_CANDIDATE");
  });

  it("deterministic evidence still auto-links", () => {
    const r = rankCandidates([{ workItemId: "wi", signals: ["IDENTIFIER_EXACT"] }], T);
    expect(r.outcome).toBe("AUTO_LINK");
  });
});

describe("C.3 — drag validation reads the catalog", () => {
  const transitions: CatalogTransition[] = [
    {
      fromStageCode: "RADICADA",
      toStageCode: "RESPUESTA_RECIBIDA",
      allowedBySuggestion: true,
      requiresExplicitUserAction: false,
      isRegressionAllowed: false,
      legalBasis: "Ley 1755 art. 14",
    },
    {
      fromStageCode: "RESPUESTA_RECIBIDA",
      toStageCode: "RADICADA",
      allowedBySuggestion: false,
      requiresExplicitUserAction: true,
      isRegressionAllowed: true,
      legalBasis: null,
    },
  ];

  it("allows a catalogued move", () => {
    expect(evaluateMove(transitions, "RADICADA", "RESPUESTA_RECIBIDA").allowed).toBe(true);
  });

  it("refuses a move the catalog does not contemplate", () => {
    const v = evaluateMove(transitions, "RADICADA", "ARCHIVADA");
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/catálogo/i);
  });

  it("flags regressions instead of silently applying them", () => {
    const v = evaluateMove(transitions, "RESPUESTA_RECIBIDA", "RADICADA");
    expect(v.allowed).toBe(true);
    expect(v.isRegression).toBe(true);
  });

  it("a same-stage drop is a no-op", () => {
    expect(evaluateMove(transitions, "RADICADA", "RADICADA").allowed).toBe(false);
  });
});

describe("B.3 — lifecycle bands are shared across workflows", () => {
  it("every band has a colour and a Spanish label", () => {
    for (const band of Object.keys(BAND_LABEL) as Array<keyof typeof BAND_LABEL>) {
      expect(BAND_COLOR[band]).toBeTruthy();
      expect(BAND_LABEL[band]).toMatch(/[a-záéíóú]/i);
    }
  });
});
