import { describe, it, expect } from "vitest";
import {
  PETICION_STAGES,
  PETICION_SUBTYPES,
  FORBIDDEN_AS_STAGE,
  classifyExtension,
  resolveNegativeSilenceDate,
  resolveInterAuthoritySubtype,
  termClassToRegime,
} from "@/lib/peticion/catalog";
import {
  classifyPeticionEmailEvidence,
  BLOCKED_PRIMARY_MATCHERS,
} from "@/lib/peticion/email-evidence-policy";

describe("PETICION stage dimension", () => {
  it("never contains statuses, legal effects or extensions as stages", () => {
    const codes = PETICION_STAGES.map((s) => s.code as string);
    for (const forbidden of FORBIDDEN_AS_STAGE) {
      expect(codes).not.toContain(forbidden);
    }
  });

  it("exposes 11 stages with strictly increasing order and legal basis", () => {
    expect(PETICION_STAGES).toHaveLength(11);
    const orders = PETICION_STAGES.map((s) => s.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    for (const s of PETICION_STAGES) expect(s.legalBasis.length).toBeGreaterThan(0);
  });

  it("marks only substantive closure stages as terminal", () => {
    const terminal = PETICION_STAGES.filter((s) => s.isTerminal).map((s) => s.code);
    expect(terminal.sort()).toEqual(
      ["DESISTIMIENTO_DECRETADO", "DESISTIMIENTO_EXPRESO", "RECHAZADA", "RESPUESTA_DE_FONDO"].sort(),
    );
  });
});

describe("PETICION statutory terms", () => {
  it("uses the legal durations of Ley 1755 and forbids org overrides", () => {
    expect(PETICION_SUBTYPES.GENERAL.durationValue).toBe(15);
    expect(PETICION_SUBTYPES.DOCUMENTOS_INFORMACION.durationValue).toBe(10);
    expect(PETICION_SUBTYPES.CONSULTA.durationValue).toBe(30);
    expect(PETICION_SUBTYPES.ENTRE_AUTORIDADES_INFO_DOCUMENTOS.durationValue).toBe(10);
    for (const s of Object.values(PETICION_SUBTYPES)) {
      expect(s.allowsOrgDurationOverride).toBe(false);
      expect(s.termClass).toBe("ADMINISTRATIVO");
    }
  });

  it("requires an explicit user term and manual silence review for NORMA_ESPECIAL", () => {
    expect(PETICION_SUBTYPES.NORMA_ESPECIAL.requiresUserTerm).toBe(true);
    expect(PETICION_SUBTYPES.NORMA_ESPECIAL.durationValue).toBeNull();
    expect(PETICION_SUBTYPES.NORMA_ESPECIAL.defaultSilenceEffect).toBe("MANUAL_REVIEW");
  });

  it("maps administrative terms away from the judicial regime", () => {
    expect(termClassToRegime("ADMINISTRATIVO")).toBe("ADMIN");
    expect(termClassToRegime("JUDICIAL")).toBe("JUDICIAL");
  });

  it("does not treat 'entre autoridades' as a blanket 10-day term", () => {
    expect(resolveInterAuthoritySubtype(true, "GENERAL")).toBe("ENTRE_AUTORIDADES_INFO_DOCUMENTOS");
    expect(resolveInterAuthoritySubtype(false, "GENERAL")).toBe("GENERAL");
    expect(resolveInterAuthoritySubtype(false, null)).toBeNull();
  });
});

describe("Art. 14 parágrafo — extension validity", () => {
  const base = { originalTermDays: 15, originalDueDate: "2026-09-10" };

  it("accepts a timely extension within double the original term", () => {
    expect(
      classifyExtension({ ...base, extendedTermDays: 30, notifiedOn: "2026-09-08" }),
    ).toBe("VALID");
  });

  it("flags extensions announced after expiry", () => {
    expect(
      classifyExtension({ ...base, extendedTermDays: 25, notifiedOn: "2026-09-14" }),
    ).toBe("LATE");
  });

  it("flags extensions beyond double the original term", () => {
    expect(
      classifyExtension({ ...base, extendedTermDays: 31, notifiedOn: "2026-09-01" }),
    ).toBe("EXCEEDS_CAP");
  });

  it("never guesses when the announcement is incomplete", () => {
    expect(classifyExtension({ ...base, extendedTermDays: null, notifiedOn: null })).toBe("INCOMPLETE");
  });
});

describe("CPACA art. 83 — negative silence", () => {
  it("uses 3 months from presentation as the ordinary rule", () => {
    const r = resolveNegativeSilenceDate({
      presentationDate: "2026-01-15",
      dueDate: "2026-02-05",
      specialTermMonths: null,
      silenceEffect: "NEGATIVE_GENERAL",
    });
    expect(r.date).toBe("2026-04-15");
  });

  it("uses one month after the due date only for statutory terms over 3 months", () => {
    const r = resolveNegativeSilenceDate({
      presentationDate: "2026-01-15",
      dueDate: "2026-06-15",
      specialTermMonths: 5,
      silenceEffect: "NEGATIVE_SPECIAL",
    });
    expect(r.date).toBe("2026-07-15");
  });

  it("asserts nothing when silence is positive or unconfigured", () => {
    expect(
      resolveNegativeSilenceDate({
        presentationDate: "2026-01-15",
        dueDate: null,
        specialTermMonths: null,
        silenceEffect: "POSITIVE_SPECIAL",
      }).date,
    ).toBeNull();
    const manual = resolveNegativeSilenceDate({
      presentationDate: "2026-01-15",
      dueDate: null,
      specialTermMonths: null,
      silenceEffect: "MANUAL_REVIEW",
    });
    expect(manual.date).toBeNull();
    expect(manual.requiresManualReview).toBe(true);
  });
});

describe("PETICION email evidence policy", () => {
  it("never applies stages, deadlines or closures", () => {
    const decisions = [
      classifyPeticionEmailEvidence({ matchers: ["CONFIRMED_THREAD"] }),
      classifyPeticionEmailEvidence({ matchers: ["AUTHORITY_RADICADO"], contextCompatible: true }),
      classifyPeticionEmailEvidence({ matchers: ["AUTHORITY_DOMAIN"] }),
    ];
    for (const d of decisions) {
      expect(d.appliesStage).toBe(false);
      expect(d.createsDeadline).toBe(false);
      expect(d.closesDeadline).toBe(false);
      expect(d.autoAssociate).toBe(false);
      expect(d.createsSuggestion).toBe(true);
      expect(d.requiresHumanReview).toBe(true);
    }
  });

  it("blocks cliente/parte-only matches", () => {
    expect(BLOCKED_PRIMARY_MATCHERS).toEqual(["CLIENTE", "PARTE"]);
    const d = classifyPeticionEmailEvidence({ matchers: ["CLIENTE", "PARTE"] });
    expect(d.strength).toBe("BLOCKED");
    expect(d.createsSuggestion).toBe(false);
  });

  it("records and discards acknowledgements and auto-replies", () => {
    const d = classifyPeticionEmailEvidence({ matchers: ["AUTHORITY_RADICADO"], isNoise: true });
    expect(d.strength).toBe("BLOCKED");
    expect(d.createsSuggestion).toBe(false);
  });

  it("treats the authority domain as corroboration, never as identifier", () => {
    expect(classifyPeticionEmailEvidence({ matchers: ["AUTHORITY_DOMAIN"] }).strength).toBe("CANDIDATE");
    expect(
      classifyPeticionEmailEvidence({ matchers: ["AUTHORITY_RADICADO", "AUTHORITY_DOMAIN"] }).strength,
    ).toBe("STRONG");
  });

  it("downgrades ambiguous evidence to a reviewable candidate", () => {
    const d = classifyPeticionEmailEvidence({ matchers: ["CONFIRMED_THREAD"], ambiguous: true });
    expect(d.strength).toBe("CANDIDATE");
    expect(d.requiresHumanReview).toBe(true);
  });
});
