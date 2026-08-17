import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  JUDICIAL_WORKFLOW_TYPES,
  isJudicialWorkflowType,
} from "@/lib/workflow-constants";

/**
 * ITER65 — the courthouse e-mail surface was hidden for EJECUTIVO because the
 * component re-declared its own judicial workflow list. Guard both the content
 * of the canonical list and the absence of inline re-declarations.
 */
describe("courthouse email visibility", () => {
  it("includes every despacho-bearing workflow", () => {
    for (const wf of ["CGP", "EJECUTIVO", "LABORAL", "CPACA", "TUTELA", "PENAL_906"]) {
      expect(JUDICIAL_WORKFLOW_TYPES).toContain(wf);
      expect(isJudicialWorkflowType(wf)).toBe(true);
    }
  });

  it("excludes non-judicial workflows", () => {
    for (const wf of ["PETICION", "GOV_PROCEDURE", "GENERIC", "INDETERMINADO", null, undefined]) {
      expect(isJudicialWorkflowType(wf as string | null)).toBe(false);
    }
  });

  it("CourthouseEmailDisplay uses the shared helper, not an inline list", () => {
    const src = readFileSync("src/components/work-items/CourthouseEmailDisplay.tsx", "utf8");
    expect(src).toContain("isJudicialWorkflowType");
    expect(src).not.toMatch(/const JUDICIAL_TYPES\s*=/);
  });
});
