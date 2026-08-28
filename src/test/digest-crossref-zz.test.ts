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

const read = (p: string) => readFileSync(p, "utf8");

const index = read("supabase/functions/scheduled-daily-digest/index.ts");
const html = read("supabase/functions/scheduled-daily-digest/html.ts");
const types = read("supabase/functions/scheduled-daily-digest/types.ts");

describe("ZZ1 — cross-reference, never a merge", () => {
  it("reads the link from the canonical view, not from ad-hoc date arithmetic", () => {
    expect(index).toMatch(/from\("v_providencia_cross_ref"\)/);
  });

  it("keeps actuaciones and estados in separate tables (HH2 intact)", () => {
    expect(html).toMatch(/function actuacionesTable\(/);
    expect(html).toMatch(/function estadosTable\(/);
    expect(index).not.toMatch(/const merged\s*=/);
  });

  it("annotates both sides with the counterpart and its confidence", () => {
    expect(types).toMatch(/interface ProvidenciaCrossRef/);
    expect(html).toMatch(/crossRefNote\(r\.crossRef, "ACT"\)/);
    expect(html).toMatch(/crossRefNote\(r\.crossRef, "EST"\)/);
    expect(html).toMatch(/Misma providencia, publicada en estado el/);
    expect(html).toMatch(/Misma providencia, registrada como actuación el/);
  });

  it("shows both dates and never substitutes one for the other", () => {
    expect(html).toMatch(/fmtDate\(ref\.fecha_fijacion\)/);
    expect(html).toMatch(/fmtDate\(ref\.act_date\)/);
  });

  it("borrows the estado's PDF only when the act carries none, and says so", () => {
    expect(index).toMatch(/if \(act\.documents\.length === 0\)/);
    expect(html).toMatch(/El PDF que se enlaza aquí es el del estado/);
  });

  it("does not rewrite the act's own document availability", () => {
    expect(index).toMatch(/`document_availability` is deliberately NOT rewritten/);
  });
});

describe("ZZ2 — the window is a calendar day in Bogotá", () => {
  it("closes the window at 00:00 COT of the digest date", () => {
    expect(index).toMatch(/bogotaDayStart = \(d: string\) => `\$\{d\}T05:00:00\.000Z`/);
    expect(index).toMatch(/const windowTo =/);
    expect(index).toMatch(/\.lte\("detected_at", windowTo\)/);
  });

  it("still continues from the previous digest so a missed day widens the window", () => {
    expect(index).toMatch(/prevRun\?\.window_to \?\?\s*\n?\s*calendarFrom/);
  });

  it("states the window in words the reader can check", () => {
    expect(index).toMatch(/windowLabel/);
    expect(html).toMatch(/del día \$\{esc\(p\.windowLabel\)\}/);
  });

  it("carries the 'suscritos y nunca consultados' signal", () => {
    expect(types).toMatch(/interface NeverReadRow/);
    expect(index).toMatch(/const neverRead: NeverReadRow\[\] = \[\]/);
    expect(html).toMatch(/Suscritos y nunca consultados/);
    expect(html).toMatch(/No es ausencia de novedades: es ausencia de lectura/);
  });

  it("treats a never-read matter as content on a day with no novedades", () => {
    expect(index).toMatch(/neverRead\.length > 0 \|\|/);
  });
});

describe("ZZ3 — the two numbers must be reconcilable", () => {
  it("discloses that coverage and novedades use different windows", () => {
    expect(html).toMatch(/Son ventanas distintas/);
    expect(html).toMatch(/coverageWindowFrom/);
  });

  it("passes both windows into the renderer", () => {
    expect(index).toMatch(/coverageWindowFrom: sourceWindowFrom/);
    expect(types).toMatch(/coverageWindowTo: string/);
  });
});
