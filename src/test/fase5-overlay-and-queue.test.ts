import "./helpers/localstorage-polyfill";
import { describe, it, expect } from "vitest";
import {
  queueFor,
  raisesAttention,
  type MatchQueue,
} from "@/lib/email/candidate-ranker";

/**
 * Fase 5 / A.2 — the queue split, not a threshold tweak.
 *
 * Historical precision of name-class evidence is 2,3 % (14 confirmed out of
 * 616). Raising the floor would discard the 14 real links; the fix is to keep
 * them reachable while removing them from the attention path.
 */

describe("Fase 5 / A.2 — active queue vs. passive repository", () => {
  const cases: Array<{ signals: string[]; queue: MatchQueue }> = [
    { signals: ["IDENTIFIER_EXACT"], queue: "cola_activa" },
    { signals: ["IDENTIFIER_FUZZY", "CLIENTE"], queue: "cola_activa" },
    { signals: ["VERIFIED_AUTHORITY_DOMAIN"], queue: "cola_activa" },
    { signals: ["CLIENTE"], queue: "repositorio_pasivo" },
    { signals: ["PARTE", "CLIENTE", "OBSERVED_AUTHORITY_DOMAIN"], queue: "repositorio_pasivo" },
    { signals: [], queue: "repositorio_pasivo" },
  ];

  it.each(cases)("routes %j to its queue", ({ signals, queue }) => {
    expect(queueFor(signals as never)).toBe(queue);
  });

  it("never raises attention from weak-only evidence", () => {
    expect(raisesAttention({ outcome: "SUGGEST", queue: "repositorio_pasivo" })).toBe(false);
    expect(raisesAttention({ outcome: "SUGGEST", queue: "cola_activa" })).toBe(true);
    expect(raisesAttention({ outcome: "NO_CANDIDATE", queue: "cola_activa" })).toBe(false);
  });
});
