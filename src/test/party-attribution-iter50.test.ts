/**
 * Iteration 50 — a term binds somebody, and we never guess who.
 */
import { describe, expect, it } from "vitest";
import {
  attributeStoredDeadline,
  attributeTerm,
  isActionableForClient,
  normalizeBoundPartyRole,
} from "@/lib/workflow-terms/party-attribution";

describe("term attribution", () => {
  it("attributes the demandado's term to the counterparty when our client is the demandante", () => {
    // 05001400303420260089800: G+A is DEMANDANTE; the reposición and the
    // pagar-o-excepcionar windows belong to VEEP.
    expect(attributeTerm("DEMANDADO", "DEMANDANTE")).toBe("CONTRAPARTE");
    expect(attributeTerm("DEMANDANTE", "DEMANDANTE")).toBe("PROPIO");
  });

  it("treats judge-side terms as informative regardless of the client role", () => {
    expect(attributeTerm("JUEZ", "DEMANDANTE")).toBe("JUEZ");
    expect(attributeTerm("DEMANDANTE", "DEMANDADO", { isJudgeSide: true })).toBe("JUEZ");
    expect(isActionableForClient("JUEZ")).toBe(false);
    expect(isActionableForClient("CONTRAPARTE")).toBe(false);
  });

  it("does not guess when the client capacity is unknown or has no side", () => {
    expect(attributeTerm("DEMANDADO", null)).toBe("DESCONOCIDO");
    expect(attributeTerm("DEMANDADO", "APODERADO_DE_OFICIO")).toBe("DESCONOCIDO");
    expect(attributeTerm("RECURRENTE", "DEMANDANTE")).toBe("DESCONOCIDO");
  });

  it("binds both parties to our client", () => {
    expect(attributeTerm("AMBAS", null)).toBe("PROPIO");
  });

  it("normalises unknown bound roles instead of throwing", () => {
    expect(normalizeBoundPartyRole("demandante")).toBe("DEMANDANTE");
    expect(normalizeBoundPartyRole(undefined)).toBe("DESCONOCIDO");
    expect(normalizeBoundPartyRole("otra cosa")).toBe("DESCONOCIDO");
  });

  it("marks stored deadlines with no resolvable rule as unattributed (iter51)", () => {
    expect(attributeStoredDeadline(null, null)).toBe("DESCONOCIDO");
    expect(attributeStoredDeadline({}, "DEMANDANTE")).toBe("DESCONOCIDO");
    expect(attributeStoredDeadline({ bound_party_role: "DESCONOCIDO" }, "DEMANDANTE")).toBe(
      "DESCONOCIDO",
    );
  });

  it("moves a stored counterparty term out of the actionable list", () => {
    expect(attributeStoredDeadline({ bound_party_role: "DEMANDADO" }, "DEMANDANTE")).toBe(
      "CONTRAPARTE",
    );
    expect(attributeStoredDeadline({ attribution: "JUEZ" }, "DEMANDANTE")).toBe("JUEZ");
  });
});
