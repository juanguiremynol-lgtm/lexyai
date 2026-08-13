/**
 * Iteration 56 — the one-time capacity onboarding.
 */
import { describe, expect, it } from "vitest";
import {
  classifyCapacityRow,
  computeAttributionConsequence,
  consequenceCopy,
  noProposalReason,
  CURADOR_AD_LITEM_RADICADOS,
  type CapacityRowInput,
} from "@/lib/workflow-terms/party-capacity";
import { attributeTerm } from "@/lib/workflow-terms/party-attribution";

const base: CapacityRowInput = {
  id: "x",
  radicado: "05001400303420260089800",
  clientName: "G+A",
  hasClient: true,
  demandantes: "G+A",
  demandados: "VEEP",
  role: "DEMANDANTE",
  confidence: 1,
  basis: "G+A",
  represents: null,
};

describe("iter56 capacity sections", () => {
  it("routes attention by how sure the machine is", () => {
    expect(classifyCapacityRow(base)).toBe("ALTA_CONFIANZA");
    expect(classifyCapacityRow({ ...base, confidence: 0.75 })).toBe("REVISION");
    expect(classifyCapacityRow({ ...base, confidence: 0.5 })).toBe("REVISION");
    expect(classifyCapacityRow({ ...base, role: null, confidence: 0 })).toBe("SIN_PROPUESTA");
  });

  it("gives each unproposed matter its own reason and remedy", () => {
    const none = { ...base, role: null, confidence: 0 };
    expect(noProposalReason({ ...none, hasClient: false })).toBe("SIN_CLIENTE");
    expect(noProposalReason({ ...none, demandantes: "  ", demandados: null })).toBe("SIN_PARTES");
    expect(noProposalReason(none)).toBe("SIN_COINCIDENCIA");
    for (const rad of CURADOR_AD_LITEM_RADICADOS) {
      expect(noProposalReason({ ...none, radicado: rad })).toBe("CURADOR_AD_LITEM");
    }
  });

  it("expresses curador matters as PROPIO_EN_REPRESENTACION, not DEMANDADO", () => {
    expect(attributeTerm("DEMANDADO", "APODERADO_DE_OFICIO", { represents: "DEMANDADO" })).toBe(
      "PROPIO_EN_REPRESENTACION",
    );
    const c = computeAttributionConsequence(
      [{ bound_party_role: "DEMANDADO" }, { bound_party_role: "DEMANDANTE" }],
      "APODERADO_DE_OFICIO",
      "DEMANDADO",
    );
    expect(c.propio).toBe(1);
    expect(c.contraparte).toBe(1);
  });

  it("states the consequence before the confirmation", () => {
    const c = computeAttributionConsequence(
      [
        { bound_party_role: "DEMANDADO" },
        { bound_party_role: "DEMANDADO" },
        { bound_party_role: "DEMANDANTE" },
        { bound_party_role: "JUEZ" },
        { bound_party_role: null },
      ],
      "DEMANDANTE",
      null,
    );
    expect(c).toMatchObject({ propio: 1, contraparte: 2, juez: 1, desconocido: 1, changed: 3 });
    expect(consequenceCopy(c)).toContain("2 término(s) pasarían a la contraparte");
    expect(consequenceCopy(computeAttributionConsequence([], "DEMANDANTE", null))).toContain(
      "Sin términos registrados",
    );
  });
});
