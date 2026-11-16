import { describe, it, expect } from "vitest";
import { buildPeticionStatePayload, validatePeticionState, type PeticionStateForm } from "../peticion-admin";

const base: PeticionStateForm = {
  subtype_code: "GENERAL", authority_name: "Autoridad", authority_email_domain: "autoridad.gov.co",
  sent_at: "2026-11-16", authority_received_at: "", authority_radicado: "", anchor_provenance_note: "",
};
const ids = { work_item_id: "w", owner_id: "o", organization_id: null };

describe("peticion manual record", () => {
  it("accepts a petition without any judicial radicado", () => {
    expect(validatePeticionState(base, "2026-11-16")).toEqual([]);
  });
  it("send date alone never sets a legal anchor", () => {
    const p = buildPeticionStatePayload(base, ids);
    expect(p.anchor_source).toBeNull();
    expect(p.authority_received_at).toBeNull();
  });
  it("proven receipt requires evidence and sets anchor_source MANUAL", () => {
    const f = { ...base, authority_received_at: "2026-11-16" };
    expect(validatePeticionState(f, "2026-11-16")).toContain("Indique la prueba de la recepción (acuse, radicado, constancia).");
    const ok = { ...f, anchor_provenance_note: "Acuse 2026-ER-1" };
    expect(validatePeticionState(ok, "2026-11-16")).toEqual([]);
    expect(buildPeticionStatePayload(ok, ids).anchor_source).toBe("MANUAL");
  });
  it("rejects receipt before sending and future dates", () => {
    expect(validatePeticionState({ ...base, authority_received_at: "2026-11-10", anchor_provenance_note: "x" }, "2026-11-16"))
      .toContain("La recepción no puede ser anterior al envío.");
    expect(validatePeticionState({ ...base, sent_at: "2026-11-20" }, "2026-11-16")).toContain("La fecha de envío no puede ser futura.");
  });
});
