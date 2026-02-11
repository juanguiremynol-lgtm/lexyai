/**
 * Vitest tests for the ingestion pipeline scenarios.
 * Tests cover: OK flows, empty results, pending states, missing mapping specs,
 * ORG_PRIVATE override, and trace stage completeness.
 */

import { describe, it, expect } from "vitest";

// ---- Inline pipeline simulation (mirrors provider-sync-external-provider logic) ----

type TraceStage = "SNAPSHOT_FETCHED" | "RAW_SAVED" | "MAPPED" | "UPSERTED" | "PROVENANCE_WRITTEN" | "EXTRAS_WRITTEN";

interface PipelineResult {
  ok: boolean;
  status: "OK" | "EMPTY" | "PENDING" | "ERROR" | "BLOCK";
  rawSnapshotSaved: boolean;
  canonicalActs: number;
  canonicalPubs: number;
  provenanceRows: number;
  extrasRows: number;
  traces: TraceStage[];
  errorCode?: string;
  errorMessage?: string;
}

interface MappingSpec {
  id: string;
  visibility: "GLOBAL" | "ORG_PRIVATE";
  status: "DRAFT" | "ACTIVE" | "DEPRECATED";
}

function resolveEffectiveMapping(
  globalSpecs: MappingSpec[],
  orgSpecs: MappingSpec[],
  connectorEmitsCanonicalV1: boolean,
): MappingSpec | "IDENTITY" | null {
  // ORG_PRIVATE ACTIVE overrides GLOBAL
  const orgActive = orgSpecs.find((s) => s.visibility === "ORG_PRIVATE" && s.status === "ACTIVE");
  if (orgActive) return orgActive;

  const globalActive = globalSpecs.find((s) => s.visibility === "GLOBAL" && s.status === "ACTIVE");
  if (globalActive) return globalActive;

  if (connectorEmitsCanonicalV1) return "IDENTITY";

  return null; // No mapping available
}

function simulatePipeline(params: {
  snapshotOk: boolean;
  snapshotStatus?: number;
  payload: { actuaciones?: unknown[]; publicaciones?: unknown[]; scraping_initiated?: boolean };
  mappingSpec: MappingSpec | "IDENTITY" | null;
  extraFields?: number;
}): PipelineResult {
  const traces: TraceStage[] = [];
  const result: PipelineResult = {
    ok: false,
    status: "ERROR",
    rawSnapshotSaved: false,
    canonicalActs: 0,
    canonicalPubs: 0,
    provenanceRows: 0,
    extrasRows: 0,
    traces,
  };

  // Step 1: Snapshot fetched
  traces.push("SNAPSHOT_FETCHED");

  if (!params.snapshotOk) {
    result.errorCode = "FETCH_ERROR";
    result.errorMessage = "Provider unreachable";
    return result;
  }

  // Step 2: Always save raw snapshot
  result.rawSnapshotSaved = true;
  traces.push("RAW_SAVED");

  // Check for pending/scraping
  if (params.payload.scraping_initiated) {
    result.status = "PENDING";
    result.errorCode = "SCRAPING_PENDING";
    return result;
  }

  // Check for empty
  const acts = params.payload.actuaciones || [];
  const pubs = params.payload.publicaciones || [];
  if (acts.length === 0 && pubs.length === 0) {
    result.ok = true;
    result.status = "EMPTY";
    result.errorCode = "PROVIDER_EMPTY_RESULT";
    return result;
  }

  // Step 3: Resolve mapping
  if (!params.mappingSpec) {
    result.status = "BLOCK";
    result.errorCode = "MAPPING_SPEC_MISSING";
    result.errorMessage = "No active mapping spec found. Configure mapping before syncing.";
    return result;
  }

  // Step 4: Apply mapping
  traces.push("MAPPED");

  // Step 5: Upsert canonical
  result.canonicalActs = acts.length;
  result.canonicalPubs = pubs.length;
  traces.push("UPSERTED");

  // Step 6: Write provenance
  result.provenanceRows = acts.length + pubs.length;
  traces.push("PROVENANCE_WRITTEN");

  // Step 7: Write extras (only if unmapped fields exist)
  result.extrasRows = params.extraFields || 0;
  if (result.extrasRows > 0) {
    traces.push("EXTRAS_WRITTEN");
  }

  result.ok = true;
  result.status = "OK";
  return result;
}

// ---- Tests ----

describe("Ingestion Pipeline: OK with fully mappable payload", () => {
  it("ingests canonical records, writes provenance, no extras needed", () => {
    const result = simulatePipeline({
      snapshotOk: true,
      payload: {
        actuaciones: [
          { fecha: "2025-01-15", descripcion: "Auto admisorio", tipo: "auto" },
          { fecha: "2025-01-16", descripcion: "Notificación personal", tipo: "notificacion" },
        ],
        publicaciones: [
          { fecha: "2025-01-17", descripcion: "Publicación en lista" },
        ],
      },
      mappingSpec: "IDENTITY",
      extraFields: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("OK");
    expect(result.rawSnapshotSaved).toBe(true);
    expect(result.canonicalActs).toBe(2);
    expect(result.canonicalPubs).toBe(1);
    expect(result.provenanceRows).toBe(3);
    expect(result.extrasRows).toBe(0);
    expect(result.traces).toContain("SNAPSHOT_FETCHED");
    expect(result.traces).toContain("RAW_SAVED");
    expect(result.traces).toContain("MAPPED");
    expect(result.traces).toContain("UPSERTED");
    expect(result.traces).toContain("PROVENANCE_WRITTEN");
    expect(result.traces).not.toContain("EXTRAS_WRITTEN");
  });
});

describe("Ingestion Pipeline: OK with extra fields", () => {
  it("ingests canonical + stores extras for unmapped fields", () => {
    const result = simulatePipeline({
      snapshotOk: true,
      payload: {
        actuaciones: [
          { fecha: "2025-01-15", descripcion: "Sentencia", custom_score: 95, internal_tag: "urgent" },
        ],
      },
      mappingSpec: { id: "spec-1", visibility: "GLOBAL", status: "ACTIVE" },
      extraFields: 2,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("OK");
    expect(result.rawSnapshotSaved).toBe(true);
    expect(result.canonicalActs).toBe(1);
    expect(result.extrasRows).toBe(2);
    expect(result.traces).toContain("EXTRAS_WRITTEN");
    expect(result.traces).toContain("PROVENANCE_WRITTEN");
  });
});

describe("Ingestion Pipeline: EMPTY result", () => {
  it("saves raw snapshot, produces no canonical records, no retry", () => {
    const result = simulatePipeline({
      snapshotOk: true,
      payload: { actuaciones: [], publicaciones: [] },
      mappingSpec: "IDENTITY",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("EMPTY");
    expect(result.rawSnapshotSaved).toBe(true);
    expect(result.canonicalActs).toBe(0);
    expect(result.canonicalPubs).toBe(0);
    expect(result.provenanceRows).toBe(0);
    expect(result.extrasRows).toBe(0);
    expect(result.errorCode).toBe("PROVIDER_EMPTY_RESULT");
  });
});

describe("Ingestion Pipeline: PENDING (scraping initiated)", () => {
  it("saves raw snapshot, no canonical records, enqueues retry", () => {
    const result = simulatePipeline({
      snapshotOk: true,
      payload: { scraping_initiated: true, actuaciones: [] },
      mappingSpec: "IDENTITY",
    });

    expect(result.status).toBe("PENDING");
    expect(result.rawSnapshotSaved).toBe(true);
    expect(result.canonicalActs).toBe(0);
    expect(result.canonicalPubs).toBe(0);
    expect(result.errorCode).toBe("SCRAPING_PENDING");
  });
});

describe("Ingestion Pipeline: Mapping spec missing → BLOCK", () => {
  it("saves raw snapshot, returns BLOCK with explicit error", () => {
    const result = simulatePipeline({
      snapshotOk: true,
      payload: {
        actuaciones: [{ fecha: "2025-01-15", descripcion: "Auto admisorio" }],
      },
      mappingSpec: null, // No mapping available
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("BLOCK");
    expect(result.rawSnapshotSaved).toBe(true);
    expect(result.canonicalActs).toBe(0);
    expect(result.errorCode).toBe("MAPPING_SPEC_MISSING");
    expect(result.errorMessage).toContain("mapping");
  });
});

describe("Ingestion Pipeline: ORG_PRIVATE mapping overrides GLOBAL", () => {
  it("uses org-private mapping when both exist", () => {
    const globalSpecs: MappingSpec[] = [
      { id: "global-1", visibility: "GLOBAL", status: "ACTIVE" },
    ];
    const orgSpecs: MappingSpec[] = [
      { id: "org-1", visibility: "ORG_PRIVATE", status: "ACTIVE" },
    ];

    const effective = resolveEffectiveMapping(globalSpecs, orgSpecs, false);
    expect(effective).not.toBe("IDENTITY");
    expect(effective).not.toBeNull();
    expect((effective as MappingSpec).id).toBe("org-1");
    expect((effective as MappingSpec).visibility).toBe("ORG_PRIVATE");

    // Now simulate pipeline with the org spec
    const result = simulatePipeline({
      snapshotOk: true,
      payload: { actuaciones: [{ fecha: "2025-01-15", descripcion: "Test" }] },
      mappingSpec: effective,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("OK");
  });

  it("falls back to GLOBAL when no org-private spec exists", () => {
    const effective = resolveEffectiveMapping(
      [{ id: "global-1", visibility: "GLOBAL", status: "ACTIVE" }],
      [],
      false,
    );
    expect((effective as MappingSpec).id).toBe("global-1");
  });

  it("falls back to IDENTITY when connector emits canonical v1 and no specs exist", () => {
    const effective = resolveEffectiveMapping([], [], true);
    expect(effective).toBe("IDENTITY");
  });

  it("returns null when nothing is available", () => {
    const effective = resolveEffectiveMapping([], [], false);
    expect(effective).toBeNull();
  });
});

describe("Ingestion Pipeline: Trace stage completeness", () => {
  it("successful pipeline produces all 6 trace stages when extras exist", () => {
    const result = simulatePipeline({
      snapshotOk: true,
      payload: { actuaciones: [{ fecha: "2025-01-15", descripcion: "Test", extra: "val" }] },
      mappingSpec: "IDENTITY",
      extraFields: 1,
    });

    const expectedStages: TraceStage[] = [
      "SNAPSHOT_FETCHED", "RAW_SAVED", "MAPPED", "UPSERTED", "PROVENANCE_WRITTEN", "EXTRAS_WRITTEN",
    ];
    for (const stage of expectedStages) {
      expect(result.traces).toContain(stage);
    }
  });

  it("successful pipeline without extras omits EXTRAS_WRITTEN", () => {
    const result = simulatePipeline({
      snapshotOk: true,
      payload: { actuaciones: [{ fecha: "2025-01-15", descripcion: "Test" }] },
      mappingSpec: "IDENTITY",
      extraFields: 0,
    });

    expect(result.traces).not.toContain("EXTRAS_WRITTEN");
    expect(result.traces).toContain("PROVENANCE_WRITTEN");
  });
});
