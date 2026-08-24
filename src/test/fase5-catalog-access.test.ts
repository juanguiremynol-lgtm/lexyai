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
 * These reads go through the same client the application uses, so a missing
 * GRANT or a missing RLS policy fails the build instead of degrading a screen
 * into "this workflow has no stages".
 */

const GOVERNED_WORKFLOWS = ["PETICION", "GOV_PROCEDURE"] as const;

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

  it.each(GOVERNED_WORKFLOWS)(
    "reads stages for %s through the application client",
    async (workflowType) => {
      const { data, error } = await supabase
        .from("workflow_stages_global")
        .select("code, display_order, lifecycle_band")
        .eq("workflow_type", workflowType)
        .eq("active", true);
      const rows = assertCatalogRows("workflow_stages_global", data, error);
      expect(rows.length).toBeGreaterThan(0);
    },
  );

  it.each(GOVERNED_WORKFLOWS)(
    "reads transitions for %s through the application client",
    async (workflowType) => {
      const { data, error } = await supabase
        .from("workflow_stage_transitions")
        .select("from_stage_code, to_stage_code")
        .eq("workflow_type", workflowType)
        .eq("active", true);
      const rows = assertCatalogRows("workflow_stage_transitions", data, error);
      expect(rows.length).toBeGreaterThan(0);
    },
  );

  it("every transition endpoint exists in the stage catalog (I3)", async () => {
    for (const workflowType of GOVERNED_WORKFLOWS) {
      const { data: stages } = await supabase
        .from("workflow_stages_global")
        .select("code")
        .eq("workflow_type", workflowType)
        .eq("active", true);
      const { data: transitions } = await supabase
        .from("workflow_stage_transitions")
        .select("from_stage_code, to_stage_code")
        .eq("workflow_type", workflowType)
        .eq("active", true);
      const codes = new Set((stages ?? []).map((s) => s.code as string));
      for (const t of transitions ?? []) {
        expect(codes.has(t.from_stage_code as string)).toBe(true);
        expect(codes.has(t.to_stage_code as string)).toBe(true);
      }
    }
  });
});
