/**
 * A compact digest keeps the process link and preserves both evidence classes.
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

  it("links directly to the process with a case label and radicado", () => {
    expect(html).toContain('workItem(p, id, true)');
    expect(html).toContain('item.radicado');
    expect(html).toContain('/app/work-items/');
  });
});

describe("LL1(b) — source evidence without full historical scans", () => {
  it("selects new acts and publicaciones separately, excluding archived rows", () => {
    expect(index).not.toMatch(/providerCounts/);
    expect(index).toMatch(/from\("work_item_acts"\)[\s\S]{0,500}is_archived", false/);
    expect(index).toMatch(/from\("work_item_publicaciones"\)[\s\S]{0,500}is_archived", false/);
  });

  it("labels each bucket with its own provider vocabulary (HH2 intact)", () => {
    expect(html).toMatch(/actuacionSourceLabel\(act\.source\)/);
    expect(html).toMatch(/estadoSourceLabel\(state\.source\)/);
  });

  it("summarizes newly imported history separately from novedades", () => {
    expect(html).toMatch(/Historial incorporado/);
    expect(html).not.toMatch(/Totales históricos registrados en Andromeda/);
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
