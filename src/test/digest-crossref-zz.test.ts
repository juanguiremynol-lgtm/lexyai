/**
 * Iteration ZZ — the same providencia arriving through two channels, and the
 * window the digest reports on.
 *
 * ZZ1 cross-reference without merging.
 * ZZ2 calendar-day window + "suscritos y nunca consultados".
 * ZZ3 the source table must be reconcilable against the novedades count.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { digestHasContent } from "../../supabase/functions/scheduled-daily-digest/content.ts";

const read = (p: string) => readFileSync(p, "utf8");

const index = read("supabase/functions/scheduled-daily-digest/index.ts");
const html = read("supabase/functions/scheduled-daily-digest/html.ts");
const types = read("supabase/functions/scheduled-daily-digest/types.ts");

describe("ZZ1 — cross-reference, never a merge", () => {
  it("reads the link from the canonical view, not from ad-hoc date arithmetic", () => {
    expect(index).toMatch(/from\("v_providencia_cross_ref"\)/);
  });

  it("keeps actuaciones and estados as separate rows within each case", () => {
    expect(html).toMatch(/group\.actuaciones\.map\(/);
    expect(html).toMatch(/group\.estados\.map\(/);
    expect(index).not.toMatch(/const merged\s*=/);
  });

  it("annotates both sides with the counterpart and its confidence", () => {
    expect(types).toMatch(/interface ProvidenciaCrossRef/);
    expect(html).toMatch(/crossReference\(act\.crossRef, "estado"\)/);
    expect(html).toMatch(/crossReference\(state\.crossRef, "actuación"\)/);
    expect(html).toMatch(/Providencia vinculada a/);
  });

  it("shows both dates and never substitutes one for the other", () => {
    expect(html).toMatch(/kind === "estado" \? ref\.fecha_fijacion : ref\.act_date/);
    expect(html).toMatch(/civil\(state\.fecha_fijacion\)/);
    expect(html).toMatch(/civil\(act\.act_date\)/);
  });

  it("borrows the estado's PDF only when the act carries none, and says so", () => {
    expect(index).toMatch(/act\.documents\.length === 0/);
    expect(html).toMatch(/documents_borrowed \? "la publicación en estado"/);
  });

  it("does not rewrite the act's own document availability", () => {
    expect(index).toMatch(/`document_availability` is deliberately NOT rewritten/);
  });
});

describe("ZZ2 — the window is a calendar day in Bogotá", () => {
  it("opens on the Bogotá calendar fallback and closes at composition", () => {
    expect(index).toMatch(/bogotaDayStart = \(d: string\) => `\$\{d\}T05:00:00\.000Z`/);
    expect(index).toMatch(/const windowTo =/);
    expect(index).toMatch(/\.lte\("detected_at", windowTo\)/);
  });

  it("still continues from the previous digest so a missed day widens the window", () => {
    expect(index).toMatch(/prevRun\?\.window_to \?\?\s*\n?\s*calendarFrom/);
  });

  it("states the window in words the reader can check", () => {
    expect(html).toMatch(/moment\(p\.windowFrom\).*moment\(p\.windowTo\).*Hora de Bogotá/);
  });

  it("classifies unread-looking matters by known evidence", () => {
    expect(types).toMatch(/interface NeverReadRow/);
    expect(index).toMatch(/const neverRead: NeverReadRow\[\] = \[\]/);
    expect(index).toMatch(/manual_court_findings/);
    expect(index).toMatch(/PROVIDER_EMPTY_RESULT/);
    expect(html).toMatch(/classification === "MANUAL_PRIVATE"/);
    expect(html).toMatch(/classification === "READ_FAILURE"/);
    expect(html).toMatch(/acceso restringido verificado manualmente/);
  });

  it("treats a never-read matter as content on a day with no novedades", () => {
    expect(index).toMatch(/rowCount:[^,]+\bneverRead\.length/);
    expect(digestHasContent({ rowCount: 1, manualReviewCount: 0, coverageIncomplete: false })).toBe(true);
    expect(digestHasContent({ rowCount: 0, manualReviewCount: 0, coverageIncomplete: false })).toBe(false);
  });
});

describe("ZZ3 — the two numbers must be reconcilable", () => {
  it("discloses that coverage and novedades use different windows", () => {
    expect(html).toMatch(/Control de fuentes/);
    expect(html).toMatch(/coverageWindowFrom/);
  });

  it("passes both windows into the renderer", () => {
    expect(index).toMatch(/coverageWindowFrom: sourceWindowFrom/);
    expect(types).toMatch(/coverageWindowTo: string/);
  });
});

/**
 * AB1 — a MEDIA link must not speak with the voice of an ALTA link.
 */
describe("AB1 — rendered confidence", () => {
  it("renders MEDIA with an explicit caveat, never as a confirmed match", () => {
    expect(html).toMatch(/ref\.confidence !== "ALTA"/);
    expect(html).toMatch(/Vínculo con .* por confirmar/);
  });

  it("borrows the estado's PDF only on ALTA links", () => {
    expect(index).toMatch(/\.filter\(\(x\) => x\.confidence === "ALTA"\)/);
    expect(index).toMatch(/if \(x\.confidence === "ALTA" && act\.documents\.length === 0\)/);
  });

  it("identifies a borrowed document only when it has actually been linked", () => {
    expect(html).toMatch(/documents_borrowed \? "la publicación en estado" : null/);
  });
});

describe("AB3 — the never-read list is per matter, not per channel", () => {
  it("says so instead of dropping the distinction", () => {
    expect(html).toMatch(/expedientes con estados y sin lectura confirmada de CPNU/);
  });
});
