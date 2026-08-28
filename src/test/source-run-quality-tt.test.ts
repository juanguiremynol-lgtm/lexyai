/**
 * TT5/TT6 — COLLECTION QUALITY IS FIRST-CLASS STATE.
 *
 * The defect being locked out: on 2026-07-27 the CPNU collection ran, exited
 * cleanly, attempted 28 radicados and obtained 0 authoritative reads (28
 * PENDING_UPSTREAM). The digest printed "CPNU — 0 novedades". Execution health
 * was reported as collection quality, and the lawyer read our blindness as
 * judicial silence.
 *
 * TT7 replays SYSTEM BEHAVIOUR only: these are historical count fixtures fed to
 * the classifier. No provider is re-queried, no matter is re-ingested, no
 * procedural state is touched.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  classifySourceRunQuality,
  coverageRatio,
  describeSourceQuality,
  mayAssertAuthoritativeNoNovedades,
  SOURCE_QUALITY_STATES,
  type SourceRunCounts,
} from "@/lib/upstream/source-run-quality";

const read = (p: string) => readFileSync(p, "utf8");

const counts = (o: Partial<SourceRunCounts>): SourceRunCounts => ({
  source: "cpnu",
  expected_count: 0,
  attempted_count: 0,
  usable_confirmed_count: 0,
  success_count: 0,
  success_empty_count: 0,
  not_found_count: 0,
  pending_upstream_count: 0,
  error_count: 0,
  ...o,
});

/** TT7 — the six historical shapes, as counts. */
const FIXTURES: Record<string, SourceRunCounts> = {
  /** A — full portfolio answered, some with data. */
  healthy_complete: counts({
    expected_count: 28, attempted_count: 28, usable_confirmed_count: 28,
    success_count: 5, success_empty_count: 23,
  }),
  /** B — full coverage, three radicados unknown to the source. */
  healthy_with_not_found: counts({
    expected_count: 28, attempted_count: 28, usable_confirmed_count: 28,
    success_count: 4, success_empty_count: 21, not_found_count: 3,
  }),
  /** C — most answered, a handful unconfirmed. */
  degraded_partial: counts({
    expected_count: 28, attempted_count: 28, usable_confirmed_count: 24,
    success_count: 6, success_empty_count: 18, pending_upstream_count: 3, error_count: 1,
  }),
  /** D — THE 2026-07-27 INCIDENT. Job "succeeded"; nothing authoritative. */
  incident_2026_07_27: counts({
    expected_count: 28, attempted_count: 28, usable_confirmed_count: 0,
    pending_upstream_count: 28,
  }),
  /** E — the collection itself blew up. */
  run_failed: counts({
    expected_count: 28, attempted_count: 12, usable_confirmed_count: 0,
    error_count: 12, run_failed: true,
  }),
  /** F — the expected run never happened. */
  stale: counts({ expected_count: 28, attempted_count: 0, run_executed: false }),
};

describe("TT5 — the six collection-quality states", () => {
  it("declares exactly the canonical six", () => {
    expect([...SOURCE_QUALITY_STATES]).toEqual([
      "SOURCE_HEALTHY_COMPLETE",
      "SOURCE_HEALTHY_WITH_NOT_FOUND",
      "SOURCE_DEGRADED_PARTIAL",
      "SOURCE_DEGRADED_SYSTEMIC",
      "SOURCE_RUN_FAILED",
      "SOURCE_STALE",
    ]);
  });

  it.each([
    ["healthy_complete", "SOURCE_HEALTHY_COMPLETE"],
    ["healthy_with_not_found", "SOURCE_HEALTHY_WITH_NOT_FOUND"],
    ["degraded_partial", "SOURCE_DEGRADED_PARTIAL"],
    ["incident_2026_07_27", "SOURCE_DEGRADED_SYSTEMIC"],
    ["run_failed", "SOURCE_RUN_FAILED"],
    ["stale", "SOURCE_STALE"],
  ])("replays %s as %s", (fixture, expected) => {
    expect(classifySourceRunQuality(FIXTURES[fixture])).toBe(expected);
  });
});

describe("TT5.1 — PENDING_UPSTREAM is never coverage", () => {
  it("does not count pending reads as usable, whatever the attempt count", () => {
    const c = FIXTURES.incident_2026_07_27;
    expect(c.attempted_count).toBe(28);
    expect(c.usable_confirmed_count).toBe(0);
    expect(coverageRatio(c)).toBe(0);
  });

  it("a fully pending source can never authorise a no-novedades claim", () => {
    expect(mayAssertAuthoritativeNoNovedades(
      classifySourceRunQuality(FIXTURES.incident_2026_07_27),
    )).toBe(false);
  });

  it("one single pending read is enough to degrade an otherwise clean run", () => {
    const c = counts({
      expected_count: 28, attempted_count: 28, usable_confirmed_count: 27,
      success_empty_count: 27, pending_upstream_count: 1,
    });
    expect(classifySourceRunQuality(c)).toBe("SOURCE_DEGRADED_PARTIAL");
  });
});

describe("TT6 — ZERO_NEW_ROWS is not AUTHORITATIVE_NO_NOVEDADES", () => {
  it("authorises the claim only on the two healthy states", () => {
    const allowed = SOURCE_QUALITY_STATES.filter(mayAssertAuthoritativeNoNovedades);
    expect(allowed).toEqual(["SOURCE_HEALTHY_COMPLETE", "SOURCE_HEALTHY_WITH_NOT_FOUND"]);
  });

  it("NOT_FOUND does not disqualify the source (TT8/TT10)", () => {
    expect(mayAssertAuthoritativeNoNovedades(
      classifySourceRunQuality(FIXTURES.healthy_with_not_found),
    )).toBe(true);
  });

  it("says 'sin novedades' only when coverage was complete", () => {
    expect(describeSourceQuality(FIXTURES.healthy_complete, 0)).toMatch(/Sin novedades/);
    expect(describeSourceQuality(FIXTURES.incident_2026_07_27, 0)).not.toMatch(/[Ss]in novedades/);
    expect(describeSourceQuality(FIXTURES.incident_2026_07_27, 0))
      .toMatch(/No se obtuvo información autorizada/);
    expect(describeSourceQuality(FIXTURES.stale, 0)).toMatch(/no confiable/);
    expect(describeSourceQuality(FIXTURES.run_failed, 0)).toMatch(/el silencio no prueba nada/);
  });
});

describe("TT5 — the edge mirror stays in lockstep with the app module", () => {
  const app = read("src/lib/upstream/source-run-quality.ts");
  const edge = read("supabase/functions/_shared/sourceRunQuality.ts");

  it("both carry the identical classifier body", () => {
    const body = (s: string) =>
      s.slice(s.indexOf("export function classifySourceRunQuality"))
        .slice(0, s.slice(s.indexOf("export function classifySourceRunQuality")).indexOf("\n}\n") + 2)
        .replace(/\s+/g, " ");
    expect(body(edge)).toBe(body(app));
  });

  it("both refuse to treat pending_upstream as usable coverage", () => {
    for (const src of [app, edge]) {
      expect(src).toMatch(/usable === 0 && pending \+ errors > 0/);
      expect(src).toMatch(/SOURCE_DEGRADED_SYSTEMIC/);
    }
  });
});

describe("TT6.1 — the digest cannot print an unqualified zero", () => {
  const index = read("supabase/functions/scheduled-daily-digest/index.ts");
  const html = read("supabase/functions/scheduled-daily-digest/html.ts");
  const types = read("supabase/functions/scheduled-daily-digest/types.ts");

  it("computes source quality before composing any recipient payload", () => {
    expect(index).toMatch(/source_collection_quality/);
    expect(index.indexOf("source_collection_quality"))
      .toBeLessThan(index.indexOf("buildDigestHtml({"));
  });

  it("carries the quality into the payload contract", () => {
    expect(types).toMatch(/sourceQuality: SourceQualityRow\[\]/);
    expect(types).toMatch(/coverageIncomplete: boolean/);
    expect(index).toMatch(/coverageIncomplete,/);
  });

  it("treats degraded coverage as content instead of an empty day", () => {
    expect(index).toMatch(/reconciliations\.length \+[\s\S]{0,80}> 0 \|\|\s*\n?\s*coverageIncomplete/);
  });

  it("qualifies the headline and renders the source block above novedades", () => {
    expect(html).toMatch(/cobertura incompleta de fuentes/);
    expect(html).toMatch(/no permite concluir que no haya movimiento/);
    const q = html.indexOf("${sourceQualityBlock(");
    const n = html.indexOf("${novedadesBlock(");
    expect(q).toBeGreaterThan(-1);
    expect(q).toBeLessThan(n);
  });

  it("marks the subject line when coverage is incomplete", () => {
    expect(index).toMatch(/Resumen diario · cobertura incompleta de fuentes/);
  });
});

describe("TT10 — the pre-existing NOT_FOUND distinctions survive", () => {
  it("the run-outcome taxonomy still treats NOT_FOUND as an answered read", () => {
    const tax = read("supabase/functions/_shared/runOutcomeTaxonomy.ts");
    expect(tax).toMatch(/NOT_FOUND: "RUN_SUCCESS_NOT_FOUND"/);
    expect(tax).toMatch(/PROVIDER_NOT_FOUND: "RUN_SUCCESS_NOT_FOUND"/);
  });

  it("source-health still counts NOT_FOUND among successful reads", () => {
    expect(read("src/lib/upstream/source-health.ts"))
      .toMatch(/SUCCESSFUL = new Set\(\["SUCCESS", "SUCCESS_EMPTY", "NOT_FOUND", "OK"\]\)/);
  });
});
