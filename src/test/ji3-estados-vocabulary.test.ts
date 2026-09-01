/**
 * JI3 — the estados pole of a despacho profile is a statement about US.
 *
 * `publishes_estados` no longer carries USA / NO_USA. Its values are
 * RECIBIMOS_ESTADOS / NO_RECIBIMOS_ESTADOS / INDETERMINADO, so the negative
 * pole cannot be read as a claim that a despacho does not publish. The
 * lawyer's own portal verdict (DESPACHO_NO_PUBLICA_ESTADOS in
 * manual_court_findings) stays sayable and is deliberately untouched.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SWEEP = readFileSync("supabase/functions/silence-notice-sweep/index.ts", "utf8");

describe("JI3 — estados vocabulary speaks about our reads", () => {
  it("renders the new vocabulary, not the old USA/NO_USA poles", () => {
    expect(SWEEP).toContain("RECIBIMOS_ESTADOS");
    expect(SWEEP).toContain("NO_RECIBIMOS_ESTADOS");
    expect(SWEEP).toMatch(/no hemos recibido estados de este despacho/);
  });

  it("never attributes the absence to the court in the DERIVED profile line", () => {
    const perfilLine = SWEEP.split("\n").filter((l) => l.includes("Perfil observado por Andrómeda")).join("\n");
    expect(perfilLine).not.toMatch(/no publica/i);
    // The only surviving "no publica estados" text is the lawyer's own manual
    // portal verdict (HALLAZGO_ES), which must remain sayable.
  });


  it("keeps the lawyer's manual portal verdict sayable", () => {
    const findings = readFileSync("supabase/functions/silence-notice-sweep/index.ts", "utf8");
    expect(findings).toMatch(/DESPACHO_NO_PUBLICA_ESTADOS/);
  });
});
