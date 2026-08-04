/**
 * ITERATION 19 regression suite.
 * B6: inferred display phase may never render a matter earlier than its stage.
 */
import { describe, expect, it } from "vitest";
import {
  clampInferredPhase,
  inferPhaseFromText,
  mapStageToCanonicalPhase,
} from "@/lib/workflow-phases";

describe("iter19 B6 — inferred phase never regresses", () => {
  it("clamps an admission inference for a matter recorded at recursos", () => {
    expect(clampInferredPhase("CGP", "RECURSOS", "ADMISION")).toBe("RECURSOS");
  });

  it("clamps an inference behind an unmappable but forward stage", () => {
    // Stage string is not in the map; its vocabulary still implies "SENTENCIA".
    const floor = inferPhaseFromText("CGP", "SENTENCIA ANTICIPADA PROFERIDA");
    expect(floor).toBe("SENTENCIA");
    expect(clampInferredPhase("CGP", "SENTENCIA ANTICIPADA PROFERIDA", "RADICACION")).toBe(
      "SENTENCIA",
    );
  });

  it("keeps a genuinely forward inference", () => {
    expect(clampInferredPhase("CGP", "RADICADO", "CONTESTACION")).toBe("CONTESTACION");
  });

  it("returns null when there is nothing inferred", () => {
    expect(clampInferredPhase("CGP", "RECURSOS", null)).toBeNull();
  });

  it("does not clamp when the recorded stage carries no phase signal", () => {
    expect(mapStageToCanonicalPhase("CGP", "ZZZ_DESCONOCIDO")).toBeNull();
    expect(clampInferredPhase("CGP", "ZZZ_DESCONOCIDO", "ADMISION")).toBe("ADMISION");
  });

  it("respects penal phase ordering", () => {
    expect(clampInferredPhase("PENAL_906", "JUICIO_ORAL", "IMPUTACION")).toBe("JUICIO_ORAL");
    expect(clampInferredPhase("PENAL_906", "IMPUTACION", "JUICIO_ORAL")).toBe("JUICIO_ORAL");
  });
});