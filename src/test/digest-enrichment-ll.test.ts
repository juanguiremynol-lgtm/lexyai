/**
 * Iteration LL — enrichment of the novedad rows and schedule invariants.
 *
 * LL1 the digest must carry despacho, partes, clase de proceso and per-provider
 *     tallies, without collapsing actuación and estado into one taxonomy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

const index = read("supabase/functions/scheduled-daily-digest/index.ts");
const html = read("supabase/functions/scheduled-daily-digest/html.ts");
const types = read("supabase/functions/scheduled-daily-digest/types.ts");

describe("LL1(a) — per-matter context on every novedad row", () => {
  it("reads clase_proceso from the canonical monitored view", () => {
    expect(index).toMatch(/from\("v_monitored_work_items"\)/);
    expect(index).toMatch(/clase_proceso/);
  });

  it("carries clase_proceso on the work item contract", () => {
    expect(types).toMatch(/clase_proceso: string \| null/);
  });

  it("renders despacho, partes and clase de proceso in the matter header", () => {
    expect(html).toMatch(/authority_name \|\| "Despacho no registrado"/);
    expect(html).toMatch(/\$\{partes\(wi\)\}/);
    expect(html).toMatch(/Clase de proceso:/);
  });
});

describe("LL1(b) — per-provider tallies computed from Supabase rows", () => {
  it("counts acts and publicaciones separately, excluding archived rows", () => {
    expect(index).toMatch(/providerCounts/);
    expect(index).toMatch(/from\("work_item_acts"\)[\s\S]{0,200}is_archived", false/);
    expect(index).toMatch(/from\("work_item_publicaciones"\)[\s\S]{0,200}is_archived", false/);
  });

  it("labels each bucket with its own provider vocabulary (HH2 intact)", () => {
    expect(html).toMatch(/actuacionSourceLabel\(s\)/);
    expect(html).toMatch(/estadoSourceLabel\(s\)/);
  });

  it("states the tallies are historical totals, not the window", () => {
    expect(html).toMatch(/Totales históricos registrados en Andromeda/);
  });
});

describe("LL2 — window and failure semantics are unchanged", () => {
  it("anchors the window on the last successful run, so a missed day is covered", () => {
    expect(index).toMatch(/\.in\("status", \["SENT", "EMPTY_NO_EMAIL"\]\)/);
    expect(index).toMatch(/prevRun\?\.window_to/);
  });

  it("keeps FAILED distinct from EMPTY_NO_EMAIL", () => {
    expect(index).toMatch(/status: "FAILED"/);
    expect(index).toMatch(/status: "EMPTY_NO_EMAIL"/);
  });
});
