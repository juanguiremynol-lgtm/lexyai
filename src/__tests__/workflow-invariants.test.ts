/**
 * Permanent non-regression invariants (Fase 2 onwards).
 * A failure here is a build failure, not a warning.
 */
import { describe, it, expect } from "vitest";
import {
  classifyInferredEvent,
  assertComputableTerm,
  assertStageAllowed,
  isCatalogGoverned,
} from "@/lib/workflow/invariants";
import {
  GOV_STAGE_CODES,
  GOV_STAGES,
  GOV_EVENTS,
  GOV_REGIMES,
  CPACA_GENERAL_TERMS,
  resolveGovTerm,
  caducidadAnchor,
  caducidadSatisfied,
} from "@/lib/gov-procedure/catalog";

describe("INVARIANT 1 — no AI-inferred event becomes a definitive procedural fact by itself", () => {
  it("a high-confidence inference is still only a suggestion", () => {
    const v = classifyInferredEvent("GOV_PROCEDURE", { source: "AI_INFERENCE", confidence: 0.99 });
    expect(v.isDefinitiveFact).toBe(false);
    expect(v.createsSuggestion).toBe(true);
    expect(v.requiresHumanConfirmation).toBe(true);
  });

  it("a below-threshold inference does not even reach the lawyer", () => {
    const v = classifyInferredEvent("GOV_PROCEDURE", { source: "AI_INFERENCE", confidence: 0.4 });
    expect(v.isDefinitiveFact).toBe(false);
    expect(v.createsSuggestion).toBe(false);
  });

  it("human confirmation or an authoritative record is the only path to a definitive fact", () => {
    expect(
      classifyInferredEvent("GOV_PROCEDURE", {
        source: "AI_INFERENCE",
        confidence: 0.5,
        humanConfirmed: true,
      }).isDefinitiveFact,
    ).toBe(true);
    expect(
      classifyInferredEvent("GOV_PROCEDURE", {
        source: "AI_INFERENCE",
        confidence: 0.5,
        corroboratedByAuthoritativeRecord: true,
      }).isDefinitiveFact,
    ).toBe(true);
  });

  it("noise events are excluded from inference in the GOV_PROCEDURE vocabulary", () => {
    const noise = GOV_EVENTS.filter((e) => e.kind === "NOISE");
    expect(noise.length).toBeGreaterThanOrEqual(3);
    expect(noise.every((e) => e.excludedFromInference)).toBe(true);
  });
});

describe("INVARIANT 2 — no legal term is computed without class, anchor and calendar coverage", () => {
  const base = {
    termClass: "ADMINISTRATIVO" as const,
    anchorKind: "NOTIFICATION" as const,
    anchorDate: "2026-03-02",
    durationValue: 15,
    dayType: "BUSINESS" as const,
    coveredYears: [2026, 2027, 2028],
    spanEndYear: 2026,
  };

  it("accepts a fully specified, fully covered term", () => {
    expect(assertComputableTerm(base).computable).toBe(true);
  });

  it("refuses a term with no class", () => {
    expect(assertComputableTerm({ ...base, termClass: null }).blockingReasons).toContain(
      "MISSING_TERM_CLASS",
    );
  });

  it("refuses a term with no anchor kind or no anchor date", () => {
    expect(assertComputableTerm({ ...base, anchorKind: null }).blockingReasons).toContain(
      "MISSING_ANCHOR_KIND",
    );
    expect(assertComputableTerm({ ...base, anchorDate: null }).blockingReasons).toContain(
      "MISSING_ANCHOR_DATE",
    );
  });

  it("refuses a zero-day placeholder instead of silently computing 'today'", () => {
    expect(assertComputableTerm({ ...base, durationValue: 0 }).blockingReasons).toContain(
      "ZERO_OR_NEGATIVE_DURATION",
    );
  });

  it("refuses to walk business days into an uncovered year", () => {
    const v = assertComputableTerm({ ...base, anchorDate: "2029-01-05", spanEndYear: 2029 });
    expect(v.computable).toBe(false);
    expect(v.blockingReasons).toContain("MISSING_CALENDAR_COVERAGE_2029");
  });

  it("an unverified regime yields no computable duration", () => {
    const fiscal = resolveGovTerm("SANCIONATORIO_FISCAL", "GOV_DESCARGOS");
    expect(fiscal.computable).toBe(false);
    expect(fiscal.term.durationValue).toBeNull();
    expect(fiscal.term.requiresManualReview).toBe(true);
    expect(GOV_REGIMES.SANCIONATORIO_FISCAL.verified).toBe(false);
  });

  it("every verified CPACA general term declares class, anchor and duration", () => {
    for (const t of Object.values(CPACA_GENERAL_TERMS)) {
      expect(t.termClass).toBe("ADMINISTRATIVO");
      expect(t.anchorKind).toBeTruthy();
      expect(t.durationValue).toBeGreaterThan(0);
    }
  });
});

describe("INVARIANT 3 — a catalog-governed workflow accepts no free-text stage", () => {
  it("GOV_PROCEDURE is catalog-governed", () => {
    expect(isCatalogGoverned("GOV_PROCEDURE")).toBe(true);
  });

  it("rejects a stage that is not in the catalog", () => {
    const v = assertStageAllowed("GOV_PROCEDURE", "REQUERIMIENTOS_TRASLADOS", GOV_STAGE_CODES);
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("FREE_TEXT_STAGE");
  });

  it("rejects an empty stage", () => {
    expect(assertStageAllowed("GOV_PROCEDURE", null, GOV_STAGE_CODES).allowed).toBe(false);
  });

  it("accepts every catalog stage", () => {
    for (const code of GOV_STAGE_CODES) {
      expect(assertStageAllowed("GOV_PROCEDURE", code, GOV_STAGE_CODES).allowed).toBe(true);
    }
  });

  it("leaves non-governed workflows untouched (byte-identical behaviour)", () => {
    expect(assertStageAllowed("CGP", "CUALQUIER_COSA", GOV_STAGE_CODES).allowed).toBe(true);
  });
});

describe("GOV_PROCEDURE legal model", () => {
  it("has 20 stages and exactly four terminal ones", () => {
    expect(GOV_STAGES).toHaveLength(20);
    expect(GOV_STAGES.filter((s) => s.isTerminal).map((s) => s.code).sort()).toEqual([
      "ACTO_EN_FIRME",
      "CADUCIDAD_FACULTAD_SANCIONATORIA",
      "EXONERACION_ARCHIVO",
      "SILENCIO_POSITIVO_RECURSO",
    ]);
  });

  it("caducidad re-anchors on cessation when the conduct is continued", () => {
    expect(
      caducidadAnchor({ factDate: "2023-01-10", conductaContinuada: false, cessationDate: null })
        .anchor,
    ).toBe("2023-01-10");
    expect(
      caducidadAnchor({
        factDate: "2023-01-10",
        conductaContinuada: true,
        cessationDate: "2024-06-30",
      }).anchor,
    ).toBe("2024-06-30");
  });

  it("caducidad is satisfied by NOTIFICATION, never by issuance alone", () => {
    expect(caducidadSatisfied(null, "2026-01-10")).toBe(false);
    expect(caducidadSatisfied("2026-01-09", "2026-01-10")).toBe(true);
    expect(caducidadSatisfied("2026-01-11", "2026-01-10")).toBe(false);
  });

  it("caducidad and the one-year recourse clock run as background timers", () => {
    expect(CPACA_GENERAL_TERMS.GOV_CADUCIDAD_SANCIONATORIA.isBackgroundTimer).toBe(true);
    expect(CPACA_GENERAL_TERMS.GOV_RECURSO_UN_ANO.isBackgroundTimer).toBe(true);
  });
});
