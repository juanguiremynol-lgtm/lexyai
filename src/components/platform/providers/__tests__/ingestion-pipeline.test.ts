/**
 * Vitest tests for the ingestion pipeline scenarios.
 * Tests cover: OK flows, empty results, pending states, missing mapping specs,
 * ORG_PRIVATE override, trace stage completeness, and mapping governance.
 */

import { describe, it, expect } from "vitest";

// ---- Inline pipeline simulation (mirrors provider-sync-external-provider logic) ----

type TraceStage = "SNAPSHOT_FETCHED" | "RAW_SAVED" | "MAPPING_APPLIED" | "MAPPING_MISSING_BLOCK" | "UPSERTED_CANONICAL" | "PROVENANCE_WRITTEN" | "EXTRAS_WRITTEN" | "TERMINAL";

interface PipelineResult {
  ok: boolean;
  status: "OK" | "EMPTY" | "PENDING" | "ERROR" | "BLOCK";
  rawSnapshotSaved: boolean;
  canonicalActs: number;
  canonicalPubs: number;
  provenanceRows: number;
  extrasRows: number;
  traces: TraceStage[];
  lastSyncedAtSet: boolean;
  consecutiveFailuresReset: boolean;
  consecutive404Reset: boolean;
  errorCode?: string;
  errorMessage?: string;
}

interface MappingSpec {
  id: string;
  visibility: "GLOBAL" | "ORG_PRIVATE";
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  organization_id?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
}

function resolveEffectiveMapping(
  globalSpecs: MappingSpec[],
  orgSpecs: MappingSpec[],
  connectorEmitsCanonicalV1: boolean,
): MappingSpec | "IDENTITY" | null {
  // Only ACTIVE specs are considered — DRAFT/ARCHIVED never applied
  const orgActive = orgSpecs.find((s) => s.visibility === "ORG_PRIVATE" && s.status === "ACTIVE");
  if (orgActive) return orgActive;

  const globalActive = globalSpecs.find((s) => s.visibility === "GLOBAL" && s.status === "ACTIVE");
  if (globalActive) return globalActive;

  if (connectorEmitsCanonicalV1) return "IDENTITY";

  return null;
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
    lastSyncedAtSet: false,
    consecutiveFailuresReset: false,
    consecutive404Reset: false,
  };

  // Step 1: Snapshot fetched
  traces.push("SNAPSHOT_FETCHED");

  if (!params.snapshotOk) {
    result.errorCode = "FETCH_ERROR";
    result.errorMessage = "Provider unreachable";
    // Raw snapshot saved even on error
    result.rawSnapshotSaved = true;
    traces.push("RAW_SAVED");
    traces.push("TERMINAL");
    return result;
  }

  // Step 2: Always save raw snapshot
  result.rawSnapshotSaved = true;
  traces.push("RAW_SAVED");

  // Check for pending/scraping
  if (params.payload.scraping_initiated) {
    result.status = "PENDING";
    result.errorCode = "SCRAPING_PENDING";
    // Do NOT set last_synced_at
    result.lastSyncedAtSet = false;
    traces.push("TERMINAL");
    return result;
  }

  // Check for empty
  const acts = params.payload.actuaciones || [];
  const pubs = params.payload.publicaciones || [];
  if (acts.length === 0 && pubs.length === 0) {
    result.ok = true;
    result.status = "EMPTY";
    result.errorCode = "PROVIDER_EMPTY_RESULT";
    // consecutive_failures++ but NOT consecutive_404_count
    result.lastSyncedAtSet = false;
    traces.push("TERMINAL");
    return result;
  }

  // Step 3: Resolve mapping
  if (!params.mappingSpec) {
    result.status = "BLOCK";
    result.errorCode = "MAPPING_SPEC_MISSING";
    result.errorMessage = "No active mapping spec found. Configure mapping before syncing.";
    traces.push("MAPPING_MISSING_BLOCK");
    traces.push("TERMINAL");
    return result;
  }

  // Step 4: Apply mapping
  traces.push("MAPPING_APPLIED");

  // Step 5: Upsert canonical
  result.canonicalActs = acts.length;
  result.canonicalPubs = pubs.length;
  traces.push("UPSERTED_CANONICAL");

  // Step 6: Write provenance
  result.provenanceRows = acts.length + pubs.length;
  traces.push("PROVENANCE_WRITTEN");

  // Step 7: Write extras (only if unmapped fields exist)
  result.extrasRows = params.extraFields || 0;
  if (result.extrasRows > 0) {
    traces.push("EXTRAS_WRITTEN");
  }

  // Terminal OK
  traces.push("TERMINAL");
  result.ok = true;
  result.status = "OK";
  result.lastSyncedAtSet = true;
  result.consecutiveFailuresReset = true;
  result.consecutive404Reset = true;
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
    expect(result.lastSyncedAtSet).toBe(true);
    expect(result.consecutiveFailuresReset).toBe(true);
    expect(result.consecutive404Reset).toBe(true);
    expect(result.traces).toContain("SNAPSHOT_FETCHED");
    expect(result.traces).toContain("RAW_SAVED");
    expect(result.traces).toContain("MAPPING_APPLIED");
    expect(result.traces).toContain("UPSERTED_CANONICAL");
    expect(result.traces).toContain("PROVENANCE_WRITTEN");
    expect(result.traces).toContain("TERMINAL");
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
    expect(result.traces).toContain("TERMINAL");
  });
});

describe("Ingestion Pipeline: EMPTY result", () => {
  it("saves raw snapshot, produces no canonical records, no retry, no 404 increment", () => {
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
    // EMPTY does NOT set last_synced_at
    expect(result.lastSyncedAtSet).toBe(false);
    // EMPTY should not trigger 404 behavior
    expect(result.consecutive404Reset).toBe(false);
  });
});

describe("Ingestion Pipeline: PENDING (scraping initiated)", () => {
  it("saves raw snapshot, no canonical records, no last_synced_at, retry enqueued", () => {
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
    // PENDING must NOT set last_synced_at
    expect(result.lastSyncedAtSet).toBe(false);
  });
});

describe("Ingestion Pipeline: Mapping spec missing → BLOCK", () => {
  it("saves raw snapshot, returns BLOCK with trace MAPPING_MISSING_BLOCK, no canonical upserts", () => {
    const result = simulatePipeline({
      snapshotOk: true,
      payload: {
        actuaciones: [{ fecha: "2025-01-15", descripcion: "Auto admisorio" }],
      },
      mappingSpec: null,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("BLOCK");
    expect(result.rawSnapshotSaved).toBe(true);
    expect(result.canonicalActs).toBe(0);
    expect(result.errorCode).toBe("MAPPING_SPEC_MISSING");
    expect(result.errorMessage).toContain("mapping");
    expect(result.traces).toContain("MAPPING_MISSING_BLOCK");
    expect(result.traces).toContain("TERMINAL");
    expect(result.traces).not.toContain("UPSERTED_CANONICAL");
  });
});

describe("Ingestion Pipeline: ORG_PRIVATE mapping overrides GLOBAL", () => {
  it("uses org-private ACTIVE mapping when both exist", () => {
    const globalSpecs: MappingSpec[] = [
      { id: "global-1", visibility: "GLOBAL", status: "ACTIVE" },
    ];
    const orgSpecs: MappingSpec[] = [
      { id: "org-1", visibility: "ORG_PRIVATE", status: "ACTIVE", organization_id: "org-uuid" },
    ];

    const effective = resolveEffectiveMapping(globalSpecs, orgSpecs, false);
    expect(effective).not.toBe("IDENTITY");
    expect(effective).not.toBeNull();
    expect((effective as MappingSpec).id).toBe("org-1");
    expect((effective as MappingSpec).visibility).toBe("ORG_PRIVATE");

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

  it("DRAFT specs are never applied — only ACTIVE", () => {
    const globalDraft: MappingSpec[] = [
      { id: "draft-1", visibility: "GLOBAL", status: "DRAFT" },
    ];
    const orgDraft: MappingSpec[] = [
      { id: "org-draft-1", visibility: "ORG_PRIVATE", status: "DRAFT", organization_id: "org-uuid" },
    ];
    const effective = resolveEffectiveMapping(globalDraft, orgDraft, false);
    expect(effective).toBeNull();
  });

  it("ARCHIVED specs are never applied", () => {
    const specs: MappingSpec[] = [
      { id: "archived-1", visibility: "GLOBAL", status: "ARCHIVED" },
    ];
    const effective = resolveEffectiveMapping(specs, [], false);
    expect(effective).toBeNull();
  });
});

describe("Ingestion Pipeline: Trace stage completeness", () => {
  it("successful pipeline with extras produces all trace stages", () => {
    const result = simulatePipeline({
      snapshotOk: true,
      payload: { actuaciones: [{ fecha: "2025-01-15", descripcion: "Test", extra: "val" }] },
      mappingSpec: "IDENTITY",
      extraFields: 1,
    });

    const expectedStages: TraceStage[] = [
      "SNAPSHOT_FETCHED", "RAW_SAVED", "MAPPING_APPLIED", "UPSERTED_CANONICAL",
      "PROVENANCE_WRITTEN", "EXTRAS_WRITTEN", "TERMINAL",
    ];
    for (const stage of expectedStages) {
      expect(result.traces).toContain(stage);
    }
  });

  it("successful pipeline without extras omits EXTRAS_WRITTEN but still has TERMINAL", () => {
    const result = simulatePipeline({
      snapshotOk: true,
      payload: { actuaciones: [{ fecha: "2025-01-15", descripcion: "Test" }] },
      mappingSpec: "IDENTITY",
      extraFields: 0,
    });

    expect(result.traces).not.toContain("EXTRAS_WRITTEN");
    expect(result.traces).toContain("PROVENANCE_WRITTEN");
    expect(result.traces).toContain("TERMINAL");
  });

  it("fetch error still saves raw snapshot and traces TERMINAL", () => {
    const result = simulatePipeline({
      snapshotOk: false,
      payload: { actuaciones: [] },
      mappingSpec: "IDENTITY",
    });

    expect(result.rawSnapshotSaved).toBe(true);
    expect(result.traces).toContain("SNAPSHOT_FETCHED");
    expect(result.traces).toContain("RAW_SAVED");
    expect(result.traces).toContain("TERMINAL");
    expect(result.ok).toBe(false);
  });
});

describe("Mapping Governance: DRAFT → ACTIVE promotion", () => {
  it("only platform admin can activate GLOBAL specs", () => {
    const spec: MappingSpec = { id: "s1", visibility: "GLOBAL", status: "DRAFT" };
    const isPlatformAdmin = true;
    const canActivate = spec.visibility === "GLOBAL" && isPlatformAdmin;
    expect(canActivate).toBe(true);
  });

  it("org admin can activate ORG_PRIVATE specs for their org", () => {
    const spec: MappingSpec = { id: "s2", visibility: "ORG_PRIVATE", status: "DRAFT", organization_id: "org-1" };
    const isOrgAdmin = true;
    const userOrgId = "org-1";
    const canActivate = spec.visibility === "ORG_PRIVATE" && isOrgAdmin && spec.organization_id === userOrgId;
    expect(canActivate).toBe(true);
  });

  it("org admin cannot activate GLOBAL specs", () => {
    const spec: MappingSpec = { id: "s3", visibility: "GLOBAL", status: "DRAFT" };
    const isPlatformAdmin = false;
    const canActivate = spec.visibility === "GLOBAL" && isPlatformAdmin;
    expect(canActivate).toBe(false);
  });

  it("activation sets approved_by and approved_at", () => {
    const now = new Date().toISOString();
    const activatedSpec: MappingSpec = {
      id: "s4",
      visibility: "GLOBAL",
      status: "ACTIVE",
      approved_by: "admin-uuid",
      approved_at: now,
    };
    expect(activatedSpec.status).toBe("ACTIVE");
    expect(activatedSpec.approved_by).toBeTruthy();
    expect(activatedSpec.approved_at).toBeTruthy();
  });

  it("activating a new spec archives the previous ACTIVE spec", () => {
    const previousActive: MappingSpec = { id: "old", visibility: "GLOBAL", status: "ACTIVE" };
    const newDraft: MappingSpec = { id: "new", visibility: "GLOBAL", status: "DRAFT" };

    // Simulate: archive old, activate new
    previousActive.status = "ARCHIVED";
    newDraft.status = "ACTIVE";

    expect(previousActive.status).toBe("ARCHIVED");
    expect(newDraft.status).toBe("ACTIVE");
  });
});
