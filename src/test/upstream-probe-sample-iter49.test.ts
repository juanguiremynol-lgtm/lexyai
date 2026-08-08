/**
 * iter49 — the endpoint probe must exercise `/clase-proceso` with an id the
 * PROVIDER knows. Our own work_item UUIDs are not in the provider's registry,
 * so every probe answered `work_item no encontrado` and the route looked
 * broken when it was only mis-sampled. Persistence failures must also never
 * escape the loop: a thrown DB error used to abort the whole probe.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const SRC = readFileSync("supabase/functions/upstream-endpoint-probe/index.ts", "utf8");

describe("iter49 · probe sampling and persistence", () => {
  it("samples the work item from the provider's own listing", () => {
    expect(SRC).toMatch(/\/work-items\?limit=100/);
    expect(SRC).toMatch(/sampleSource/);
    expect(SRC).toMatch(/PROVEEDOR_COINCIDE_CARTERA/);
  });

  it("reports the sample origin and whether it carries a clase", () => {
    expect(SRC).toMatch(/sample_origen/);
    expect(SRC).toMatch(/sample_clase_disponible/);
  });

  it("persistence errors are collected on every path, thrown or returned", () => {
    const loop = SRC.slice(SRC.indexOf("for (const ep of UPSTREAM_ENDPOINTS)"));
    expect(loop).toMatch(/try \{[\s\S]*upstream_endpoint_probes[\s\S]*\} catch/);
    expect(loop).toMatch(/persistErrors\.push/);
  });

  it("the phantom tutelas adapter is still gone", () => {
    expect(existsSync("supabase/functions/_shared/providerAdapters/tutelasAdapter.ts")).toBe(false);
  });
});
