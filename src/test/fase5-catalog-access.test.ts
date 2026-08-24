// The Supabase browser client reads localStorage at module load; vitest runs in
// the `node` environment, so polyfill it before that import.
import "./helpers/localstorage-polyfill";
import { describe, it, expect } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import {
  assertCatalogRows,
  CatalogUnreadableError,
} from "@/lib/workflow/catalog-access";

/**
 * Fase 5 / A.1 — CI breaks when the catalog is unreachable.
 *
 * Two separate things are checked, and they are not the same thing:
 *
 *  1. `assertCatalogRows` never turns a fault into "there are no stages".
 *  2. The catalog tables are reachable through the application client with the
 *     GRANTs in place. The suite runs without a session, so RLS legitimately
 *     returns zero rows; what must never appear is a permission error or a
 *     missing relation — that is the failure a dropped GRANT produces, and it
 *     has to break the build rather than empty a screen.
 *
 * Row-level content invariants are enforced in the database (the catalog is
 * authenticated-only), not re-derived here from an unauthenticated read.
 */

const CATALOG_TABLES = [
  "workflow_stages_global",
  "workflow_stage_transitions",
  "workflow_overlays",
  "workflow_overlay_stage_applicability",
  "peticion_subtypes",
] as const;

/** PostgREST codes that mean "the client cannot reach this table at all". */
const UNREACHABLE_CODES = ["42501", "42P01", "PGRST205", "PGRST106"];

describe("Fase 5 / A.1 — catalog access fails loudly", () => {
  it("treats a query error as a fault, never as an empty catalog", () => {
    expect(() =>
      assertCatalogRows("workflow_stages_global", null, { message: "boom" }),
    ).toThrow(CatalogUnreadableError);
  });

  it("treats an empty result as a fault", () => {
    expect(() => assertCatalogRows("workflow_stages_global", [], null)).toThrow(
      CatalogUnreadableError,
    );
  });

  it("allows empty only where the caller declares it legitimate", () => {
    expect(
      assertCatalogRows("workflow_overlay_stage_applicability", [], null, {
        allowEmpty: true,
      }),
    ).toEqual([]);
  });

  it.each(CATALOG_TABLES)("%s is reachable by the application client", async (table) => {
    const { error } = await supabase.from(table as never).select("*").limit(1);
    if (error) {
      throw new Error(
        `El catálogo ${table} no es alcanzable: ${error.code ?? "?"} ${error.message}`,
      );
    }
    expect(error).toBeNull();
  });

  it.each(CATALOG_TABLES)("%s is not readable without a session", async (table) => {
    const { data, error } = await supabase.from(table as never).select("*").limit(1);
    expect(UNREACHABLE_CODES).not.toContain(error?.code);
    expect(data ?? []).toHaveLength(0);
  });
});
