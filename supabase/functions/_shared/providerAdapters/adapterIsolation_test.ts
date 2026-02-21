/**
 * adapterIsolation_test.ts — Ensures shared adapters are pure data transformers
 * with no database side effects.
 *
 * Guards against:
 *   - Adapters importing supabase client
 *   - Adapters referencing persistence tables
 *   - Adapters importing orchestrator or supervisor modules
 */

import { assert } from "https://deno.land/std@0.208.0/assert/mod.ts";

const ADAPTER_DIR = "./supabase/functions/_shared/providerAdapters";

const ADAPTER_FILES = [
  "cpnuAdapter.ts",
  "samaiAdapter.ts",
  "publicacionesAdapter.ts",
  "samaiEstadosAdapter.ts",
  "tutelasAdapter.ts",
  "types.ts",
  "contractValidator.ts",
  "bridge.ts",
  "index.ts",
];

const FORBIDDEN_TABLES = [
  "work_item_acts",
  "work_item_publicaciones",
  "sync_traces",
  "daily_sync_ledger",
  "trigger_error_log",
  "alert_instances",
  "incidents",
  "external_sync_runs",
];

Deno.test("shared adapters do not import supabase createClient", () => {
  for (const file of ADAPTER_FILES) {
    let source: string;
    try {
      source = Deno.readTextFileSync(`${ADAPTER_DIR}/${file}`);
    } catch {
      continue; // File might not exist
    }

    assert(
      !source.includes("createClient"),
      `${file} must NOT import createClient — adapters don't touch the database`,
    );
    assert(
      !source.includes("supabaseAdmin"),
      `${file} must NOT reference supabaseAdmin`,
    );
  }
});

Deno.test("shared adapters do not reference persistence tables", () => {
  for (const file of ADAPTER_FILES) {
    let source: string;
    try {
      source = Deno.readTextFileSync(`${ADAPTER_DIR}/${file}`);
    } catch {
      continue;
    }

    for (const table of FORBIDDEN_TABLES) {
      // Allow references in comments and JSDoc, but not as string literals in code
      // Check for string literals like .from('table_name') patterns
      const fromPattern = new RegExp(`\\.from\\(\\s*['"]${table}['"]`, "g");
      assert(
        !fromPattern.test(source),
        `${file} must NOT have .from('${table}') — persistence is the orchestrator's job`,
      );
    }
  }
});

Deno.test("shared adapters only import from allowed module paths", () => {
  const coreAdapters = [
    "cpnuAdapter.ts",
    "samaiAdapter.ts",
    "publicacionesAdapter.ts",
    "samaiEstadosAdapter.ts",
    "tutelasAdapter.ts",
  ];

  const allowedPrefixes = [
    "./",             // Sibling files (types.ts, contractValidator.ts)
    "../",            // Parent _shared modules (radicadoUtils, providerRegistry, etc.)
    "https://deno.land/", // Deno standard library
    "node:",          // Node built-ins
    "npm:",           // npm packages
  ];

  // Forbidden import targets (orchestrator, supervisor, edge function entry points)
  const forbiddenImports = [
    "sync-by-work-item",
    "sync-by-radicado",
    "atenia-ai-supervisor",
    "scheduled-daily-sync",
    "global-master-sync",
    "demo-radicado-lookup",
  ];

  for (const file of coreAdapters) {
    let source: string;
    try {
      source = Deno.readTextFileSync(`${ADAPTER_DIR}/${file}`);
    } catch {
      continue;
    }

    const importMatches = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)];

    for (const match of importMatches) {
      const importPath = match[1];
      const isAllowed = allowedPrefixes.some((p) => importPath.startsWith(p));
      assert(
        isAllowed,
        `${file} imports "${importPath}" which does not start with an allowed prefix. ` +
          `Adapters must not import orchestrator, supervisor, or database modules.`,
      );

      for (const forbidden of forbiddenImports) {
        assert(
          !importPath.includes(forbidden),
          `${file} imports "${importPath}" which references forbidden module "${forbidden}".`,
        );
      }
    }
  }
});

Deno.test("normalizeSources always returns string array", async () => {
  const { normalizeSources } = await import("../_shared/providerRegistry.ts".replace("../_shared/", "../"));
  // Dynamic import path correction for test context
  const mod = await import("../providerRegistry.ts");
  const normalize = mod.normalizeSources;

  // Scalar
  const r1 = normalize("cpnu");
  assert(Array.isArray(r1), "scalar string should become array");
  assert(r1.length === 1 && r1[0] === "cpnu");

  // Array passthrough
  const r2 = normalize(["cpnu", "samai"]);
  assert(Array.isArray(r2) && r2.length === 2);

  // Null/undefined safety
  const r3 = normalize(null);
  assert(Array.isArray(r3) && r3.length === 0);

  const r4 = normalize(undefined);
  assert(Array.isArray(r4) && r4.length === 0);

  // Non-string values filtered out
  const r5 = normalize([123, "cpnu", null, "samai"]);
  assert(Array.isArray(r5));
  assert(r5.every((s: unknown) => typeof s === "string"));
});
