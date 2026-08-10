/**
 * Iteration 51 — attribution materialised on stored deadlines.
 */
import { describe, expect, it } from "vitest";
import {
  attributeStoredDeadline,
  attributeTerm,
  isActionableForClient,
} from "@/lib/workflow-terms/party-attribution";

describe("iter51 stored attribution", () => {
  it("uses the materialised bound party on the row, not only calculation_meta", () => {
    expect(
      attributeStoredDeadline({ bound_party_role: "DEMANDADO" }, "DEMANDANTE"),
    ).toBe("CONTRAPARTE");
    expect(
      attributeStoredDeadline({ bound_party_role: "DEMANDANTE" }, "DEMANDANTE"),
    ).toBe("PROPIO");
  });

  it("treats judge-side rows as informative", () => {
    expect(
      attributeStoredDeadline({ bound_party_role: "DEMANDANTE", is_judge_side: true }, "DEMANDANTE"),
    ).toBe("JUEZ");
  });

  it("never assumes an unattributed row belongs to the client", () => {
    const attr = attributeStoredDeadline({ bound_party_role: null }, "DEMANDANTE");
    expect(attr).toBe("DESCONOCIDO");
    expect(isActionableForClient(attr)).toBe(false);
  });

  it("expresses APODERADO_DE_OFICIO as a distinct, representation-based attribution", () => {
    expect(attributeTerm("DEMANDADO", "APODERADO_DE_OFICIO")).toBe("DESCONOCIDO");
    expect(
      attributeTerm("DEMANDADO", "APODERADO_DE_OFICIO", { represents: "DEMANDADO" }),
    ).toBe("PROPIO_EN_REPRESENTACION");
    expect(
      attributeTerm("DEMANDANTE", "APODERADO_DE_OFICIO", { represents: "DEMANDADO" }),
    ).toBe("CONTRAPARTE");
    expect(isActionableForClient("PROPIO_EN_REPRESENTACION")).toBe(true);
  });
});
