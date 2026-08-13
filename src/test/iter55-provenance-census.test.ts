/**
 * Iteration 55 — the provider's run provenance is authoritative, the cooldown
 * gates the trigger and not the read, and an inconclusive census is "not
 * measured", never "never published".
 */
import { describe, it, expect } from "vitest";
import {
  extractRunProvenance,
  providerRunMode,
  resolveIngestRunMode,
  PROVENANCE_MIGRATION_AT,
} from "../../supabase/functions/_shared/runProvenance.ts";
import {
  classifyCpacaTerminal,
} from "../../supabase/functions/_shared/cpacaTerminalSentinel.ts";
import {
  controlDespachoFor,
  annualVolumesTotal,
} from "../../supabase/functions/_shared/censusControl.ts";

const AFTER = "2026-08-13T12:00:00.000Z";

describe("A — run provenance", () => {
  it("takes the provider's run_type over any heuristic", () => {
    const r = resolveIngestRunMode({
      run_type: "initial_load",
      work_item_created_at: "2020-01-01T00:00:00.000Z",
      detected_at: AFTER,
    });
    expect(r).toEqual({ mode: "INITIAL_LOAD", source: "PROVIDER" });
  });

  it("classifies a daily run as DAILY even inside the 30-minute window", () => {
    const created = "2026-08-13T12:00:00.000Z";
    const r = resolveIngestRunMode({
      run_type: "daily",
      work_item_created_at: created,
      detected_at: "2026-08-13T12:05:00.000Z",
    });
    expect(r).toEqual({ mode: "DAILY", source: "PROVIDER" });
  });

  it("treats run_type NULL as UNKNOWN, never as initial load", () => {
    expect(providerRunMode({ run_type: null })).toBeNull();
    expect(providerRunMode({ run_type: "  " })).toBeNull();
    const r = resolveIngestRunMode({
      run_type: null,
      work_item_created_at: null,
      detected_at: AFTER,
    });
    expect(r).toEqual({ mode: null, source: "UNKNOWN" });
  });

  it("uses the window only for rows detected after the provenance migration", () => {
    const before = resolveIngestRunMode({
      work_item_created_at: "2026-07-01T00:00:00.000Z",
      detected_at: "2026-07-01T00:10:00.000Z",
    });
    expect(before).toEqual({ mode: null, source: "UNKNOWN" });

    const after = resolveIngestRunMode({
      work_item_created_at: "2026-08-13T12:00:00.000Z",
      detected_at: "2026-08-13T12:10:00.000Z",
    });
    expect(after).toEqual({ mode: "INITIAL_LOAD", source: "WINDOW_FALLBACK" });
  });

  it("pins the migration instant so the fallback cannot silently widen", () => {
    expect(PROVENANCE_MIGRATION_AT).toBe("2026-08-13T00:00:00.000Z");
  });

  it("reads provenance from the unit or from its raw_data", () => {
    expect(extractRunProvenance({ run_type: "daily" }).run_type).toBe("daily");
    expect(
      extractRunProvenance({ raw_data: { run_type: "full_sweep", previous_scan_at: "2026-08-12T00:00:00Z" } }),
    ).toMatchObject({ run_type: "full_sweep", previous_scan_at: "2026-08-12T00:00:00Z" });
  });
});

describe("C — census discipline", () => {
  it("finds a control despacho in the same circuit", () => {
    expect(controlDespachoFor("050014003036", ["050014003016", "080013103006"])).toBe("050014003016");
  });

  it("returns no control when no sibling of the circuit was measured", () => {
    expect(controlDespachoFor("050014003036", ["080013103006"])).toBeNull();
  });

  it("sums annual volumes, treating absent years as zero", () => {
    expect(annualVolumesTotal({ "2025": 0, "2026": 50 })).toBe(50);
    expect(annualVolumesTotal({})).toBe(0);
    expect(annualVolumesTotal(null)).toBe(0);
  });
});

describe("D — terminal sentinel", () => {
  it("recognises a remisión from the terminal stage plus the vocabulary", () => {
    const v = classifyCpacaTerminal({
      etapa: "Finalizado",
      act_descriptions: ["Envío a superior — Remisión del expediente al Tribunal"],
    });
    expect(v.klass).toBe("REMISION");
  });

  it("does not call an ordinary termination a remisión", () => {
    const v = classifyCpacaTerminal({
      etapa: "Finalizado",
      act_descriptions: ["Sentencia ejecutoriada — archivo definitivo del expediente"],
    });
    expect(v.klass).not.toBe("REMISION");
  });

  it("never fires on a live matter", () => {
    const v = classifyCpacaTerminal({
      etapa: "En trámite",
      act_descriptions: ["Envío a superior"],
    });
    expect(v.klass).toBe("NO_TERMINAL");
  });
});
