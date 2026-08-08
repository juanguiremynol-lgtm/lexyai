/**
 * iter48 — the phantom fifth provider is gone.
 *
 * GCP established there is NO tutelas service, in any region, and never was:
 * GET /expediente and POST /search return 404 on all eight services with valid
 * API keys, so no 401 could hide a live route. A tutela is the UNION of the four
 * real sources, not a fifth one. A provider that cannot answer is exactly the
 * defect class we keep eliminating: its failure is indistinguishable from having
 * nothing to report.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { providerChainFor, PROVIDER_CHAIN_BY_WORKFLOW } from "@/lib/monitoring-matrix";
import {
  CHAIN,
  PROVIDER_ROW_KINDS,
  PROVIDER_LOCAL_SOURCES,
  chainProviders,
  providerMatrixGaps,
} from "../../supabase/functions/_shared/bridgeProviderMatrix";

const REAL_PROVIDERS = ["cpnu", "samai", "publicaciones", "samai_estados"];

describe("iter48 · no phantom provider", () => {
  it("the adapter and its test are deleted", () => {
    expect(existsSync("supabase/functions/_shared/providerAdapters/tutelasAdapter.ts")).toBe(false);
    expect(existsSync("supabase/functions/_shared/providerAdapters/tutelasAdapter_test.ts")).toBe(false);
  });

  it("no routing table names a tutelas provider", () => {
    for (const chain of Object.values(PROVIDER_CHAIN_BY_WORKFLOW)) {
      expect(chain).not.toContain("tutelas");
    }
    for (const chain of Object.values(CHAIN)) expect(chain).not.toContain("tutelas");
    expect(Object.keys(PROVIDER_ROW_KINDS)).not.toContain("tutelas");
    expect(chainProviders().sort()).toEqual([...REAL_PROVIDERS].sort());
    expect(providerMatrixGaps()).toEqual([]);
  });

  it("TUTELA fans out to the union of the four real sources", () => {
    expect(providerChainFor("TUTELA").sort()).toEqual([...REAL_PROVIDERS].sort());
  });

  it("legacy tutelas source strings are attributed to cpnu, not to a provider", () => {
    expect(PROVIDER_LOCAL_SOURCES.cpnu).toContain("tutelas");
    expect(PROVIDER_LOCAL_SOURCES.cpnu).toContain("cpnu+tutelas");
    expect(PROVIDER_LOCAL_SOURCES).not.toHaveProperty("tutelas");
  });

  it("no edge function still calls a tutelas adapter", () => {
    const barrel = readFileSync("supabase/functions/_shared/providerAdapters/index.ts", "utf8");
    expect(barrel).not.toMatch(/tutelasAdapter/);
    for (const f of [
      "supabase/functions/sync-by-work-item/index.ts",
      "supabase/functions/sync-by-radicado/index.ts",
      "supabase/functions/demo-radicado-lookup/index.ts",
      "supabase/functions/orchestrator-debug-run/index.ts",
      "supabase/functions/admin-test-providers/index.ts",
    ]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/fetchFromTutelas|sharedFetchTutelas/);
    }
  });

  it("no code reads the deleted host overrides", () => {
    const eps = readFileSync("supabase/functions/_shared/upstreamEndpoints.ts", "utf8");
    expect(eps).not.toMatch(/TUTELAS_BASE_URL/);
    expect(eps).not.toMatch(/Deno\.env\.get\("SAMAI_BASE_URL"\)/);
  });
});
