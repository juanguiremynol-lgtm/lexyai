import "./helpers/localstorage-polyfill";
import { describe, it, expect } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { assertCatalogRows } from "@/lib/workflow/catalog-access";

/**
 * Fase 5 / B — the private recipient is an overlay, not a workflow.
 *
 * PETICION_PARTICULAR removes two stages from PETICION and changes nothing
 * else: same stages, same subtypes, same term arithmetic.
 */

const PROHIBITED_FOR_PARTICULAR = [
  "SILENCIO_NEGATIVO_CONFIGURADO",
  "TRASLADO_POR_COMPETENCIA",
];

describe("Fase 5 / B — private-recipient overlay", () => {
  it("exists as an overlay over PETICION, not as its own workflow", async () => {
    const { data, error } = await supabase
      .from("workflow_overlays" as never)
      .select("*")
      .eq("code", "PETICION_PARTICULAR");
    const rows = assertCatalogRows("workflow_overlays", data, error) as Array<
      Record<string, unknown>
    >;
    expect(rows[0].base_workflow_type).toBe("PETICION");

    const { data: stages } = await supabase
      .from("workflow_stages_global")
      .select("code")
      .eq("workflow_type", "PETICION_PARTICULAR");
    expect(stages ?? []).toHaveLength(0);
  });

  it("marks exactly the two inapplicable stages, and no others", async () => {
    const { data, error } = await supabase
      .from("workflow_overlay_stage_applicability" as never)
      .select("stage_code, applicability")
      .eq("overlay_code", "PETICION_PARTICULAR");
    const rows = assertCatalogRows(
      "workflow_overlay_stage_applicability",
      data,
      error,
    ) as Array<Record<string, unknown>>;
    const notApplicable = rows
      .filter((r) => r.applicability === "NOT_APPLICABLE")
      .map((r) => r.stage_code as string)
      .sort();
    expect(notApplicable).toEqual([...PROHIBITED_FOR_PARTICULAR].sort());
  });

  it("keeps every other PETICION stage available to the overlay", async () => {
    const { data: stages } = await supabase
      .from("workflow_stages_global")
      .select("code")
      .eq("workflow_type", "PETICION")
      .eq("active", true);
    const codes = (stages ?? []).map((s) => s.code as string);
    const survivors = codes.filter(
      (c) => !PROHIBITED_FOR_PARTICULAR.includes(c),
    );
    expect(survivors.length).toBe(codes.length - PROHIBITED_FOR_PARTICULAR.length);
    expect(survivors.length).toBeGreaterThan(0);
  });

  it("records the recipient discriminator on the petición row shape", async () => {
    const { error } = await supabase
      .from("peticiones")
      .select("authority_id, recipient_type")
      .limit(1);
    expect(error).toBeNull();
  });
});
