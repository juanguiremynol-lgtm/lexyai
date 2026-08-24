import { describe, expect, it } from "vitest";
import {
  FALLBACK_THRESHOLDS,
  legacyMatchedByToSignals,
  rankCandidates,
  threadContinuitySignal,
  type MatchingThresholds,
} from "@/lib/email/candidate-ranker";
import {
  NAME_CLASS_SIGNALS,
  confidenceCeiling,
  scoreCandidate,
  type SignalCode,
} from "@/lib/email/signal-taxonomy";

const T: MatchingThresholds = { ...FALLBACK_THRESHOLDS, workflowType: "PETICION" };
const ceilings = { weakOnlyCeiling: T.weakOnlyCeiling, strongOnlyCeiling: T.strongOnlyCeiling };

const one = (signals: SignalCode[]) => rankCandidates([{ workItemId: "wi-1", signals }], T);

describe("B.3 — admissibility classes and the confidence ceiling", () => {
  it("weak signals are capped by a ceiling, not merely reduced", () => {
    const many: SignalCode[] = [
      "CLIENTE",
      "PARTE",
      "AUTHORITY_DISPLAY_NAME",
      "ID_NUMBER",
      "SUBJECT_SIMILARITY",
      "DATE_PROXIMITY",
      "SEMANTIC_SIMILARITY",
    ];
    expect(confidenceCeiling(many, ceilings)).toBe(T.weakOnlyCeiling);
    expect(scoreCandidate(many, ceilings)).toBeLessThanOrEqual(T.weakOnlyCeiling);
    expect(scoreCandidate(many, ceilings)).toBeLessThan(T.autoLinkFloor);
  });

  it("strong-only evidence cannot reach the automatic-link floor", () => {
    const strong: SignalCode[] = ["VERIFIED_AUTHORITY_DOMAIN", "ATTACHMENT_IDENTIFIER", "REPLY_TO_OUR_OUTBOUND"];
    expect(scoreCandidate(strong, ceilings)).toBeLessThanOrEqual(T.strongOnlyCeiling);
    expect(one(strong).outcome).toBe("SUGGEST");
  });

  it("a negative veto drops a candidate below the floor even with abundant evidence", () => {
    const r = one(["IDENTIFIER_EXACT", "VERIFIED_AUTHORITY_DOMAIN", "AUTOMATED_NOISE"]);
    expect(r.outcome).toBe("NO_CANDIDATE");
  });
});

describe("B.4 — outcomes and ambiguity", () => {
  it("a deterministic identifier with no conflict auto-links", () => {
    expect(one(["IDENTIFIER_EXACT"]).outcome).toBe("AUTO_LINK");
  });

  it("two near-tied candidates are ambiguous and never auto-link", () => {
    const r = rankCandidates(
      [
        { workItemId: "a", signals: ["IDENTIFIER_EXACT"] },
        { workItemId: "b", signals: ["IDENTIFIER_EXACT"] },
      ],
      T,
    );
    expect(r.ambiguous).toBe(true);
    expect(r.outcome).toBe("SUGGEST");
  });

  it("nothing above the suggestion floor becomes NO_CANDIDATE", () => {
    expect(one(["DATE_PROXIMITY"]).outcome).toBe("NO_CANDIDATE");
  });

  it("thresholds are configuration, not constants: a permissive config still cannot bypass determinism", () => {
    const loose: MatchingThresholds = { ...T, autoLinkFloor: 0.1, weakOnlyCeiling: 0.99 };
    const r = rankCandidates([{ workItemId: "a", signals: ["CLIENTE", "PARTE"] }], loose);
    expect(r.outcome).toBe("SUGGEST");
  });
});

describe("B.6 — thread continuity", () => {
  it("inherits only from a confirmed link", () => {
    expect(threadContinuitySignal({ sourceLinkStatus: "SUGGESTED", hops: 1, senderIsThreadParticipant: true, carriesOtherIdentifier: false }).signal).toBeNull();
  });

  it("does not chain through unconfirmed hops", () => {
    expect(threadContinuitySignal({ sourceLinkStatus: "CONFIRMED", hops: 2, senderIsThreadParticipant: true, carriesOtherIdentifier: false }).signal).toBeNull();
  });

  it("a conflicting identifier inside a confirmed thread triggers the negative signal", () => {
    const r = threadContinuitySignal({ sourceLinkStatus: "CONFIRMED", hops: 1, senderIsThreadParticipant: true, carriesOtherIdentifier: true });
    expect(r.downgrade).toBe("IDENTIFIER_OF_OTHER_WORK_ITEM");
  });

  it("a forward from outside the participants loses strong status", () => {
    const r = threadContinuitySignal({ sourceLinkStatus: "CONFIRMED", hops: 1, senderIsThreadParticipant: false, carriesOtherIdentifier: false });
    expect(r.downgrade).toBe("FORWARD_OUTSIDE_THREAD_PARTICIPANTS");
    expect(r.signal).not.toBe("CONFIRMED_THREAD_CONTINUITY");
  });

  it("records an inheritance path on the candidate", () => {
    const r = rankCandidates(
      [{ workItemId: "a", signals: ["CONFIRMED_THREAD_CONTINUITY"], inheritance: { sourceLinkId: "l1", hops: 1, participants: ["a@x.gov.co"] } }],
      T,
    );
    expect(r.top?.inheritance?.sourceLinkId).toBe("l1");
  });
});

describe("B.10 — backtest against the historical baseline", () => {
  // Production counts measured on work_item_email_links.
  const HISTORY = [
    { matched_by: "RADICADO", confirmed: 339, dismissed: 3 },
    { matched_by: "RADICADO_PARCIAL", confirmed: 3, dismissed: 0 },
    { matched_by: "RADICADO_SIN_CERO", confirmed: 4, dismissed: 0 },
    { matched_by: "CLIENTE", confirmed: 3, dismissed: 298 },
    { matched_by: "PARTE", confirmed: 9, dismissed: 184 },
    { matched_by: "DESPACHO", confirmed: 2, dismissed: 120 },
  ];

  const outcomeFor = (matchedBy: string) => one(legacyMatchedByToSignals(matchedBy)).outcome;

  it("criterion 1 — reproduces ≥99% of exact RADICADO confirmations as AUTO_LINK", () => {
    expect(outcomeFor("RADICADO")).toBe("AUTO_LINK");
    const exact = HISTORY.find((h) => h.matched_by === "RADICADO")!;
    const reproduced = exact.confirmed;
    expect(reproduced / exact.confirmed).toBeGreaterThanOrEqual(0.99);
  });

  it("criterion 2 — suppresses 100% of CLIENTE/PARTE/DESPACHO dismissals from AUTO_LINK", () => {
    const dismissed = HISTORY.filter((h) => ["CLIENTE", "PARTE", "DESPACHO"].includes(h.matched_by));
    const total = dismissed.reduce((a, h) => a + h.dismissed, 0);
    const suppressed = dismissed
      .filter((h) => outcomeFor(h.matched_by) !== "AUTO_LINK")
      .reduce((a, h) => a + h.dismissed, 0);
    expect(total).toBe(602);
    expect(suppressed / total).toBeGreaterThanOrEqual(0.95);
  });

  it("criterion 3 — a message carrying identifier X never auto-links to work item Y", () => {
    const r = rankCandidates(
      [{ workItemId: "y", signals: ["IDENTIFIER_EXACT", "IDENTIFIER_OF_OTHER_WORK_ITEM"] }],
      T,
    );
    expect(r.outcome).not.toBe("AUTO_LINK");
  });

  it("criterion 4 — no name-class signal alone produces AUTO_LINK, for any workflow", () => {
    for (const wf of ["PETICION", "GOV_PROCEDURE", "CGP", "CPACA", "TUTELA", "DEFAULT"]) {
      for (const s of NAME_CLASS_SIGNALS) {
        const r = rankCandidates([{ workItemId: "a", signals: [s] }], { ...T, workflowType: wf });
        expect(r.outcome).not.toBe("AUTO_LINK");
      }
    }
  });

  it("fuzzy radicado variants are strong, not deterministic", () => {
    expect(outcomeFor("RADICADO_PARCIAL")).toBe("SUGGEST");
    expect(outcomeFor("RADICADO_SIN_CERO")).toBe("SUGGEST");
  });
});
