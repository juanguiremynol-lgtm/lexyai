import { describe, it, expect } from "vitest";
import {
  buildPresentationRpcArgs, validatePresentation, buildAuthorityPayload, friendlyRpcError,
  type PresentationForm, type CurrentAnchor,
} from "../peticion-admin";

const base: PresentationForm = {
  presented_on: "2026-11-16", source: "USUARIO_DECLARADO", support: "Correo enviado desde Outlook",
  components: ["DOCUMENTOS_INFORMACION", "GENERAL_INTERVENCION"], reason: "", email_link_id: null,
};
const current: CurrentAnchor = { sent_at: "2026-11-16", components: ["DOCUMENTOS_INFORMACION", "GENERAL_INTERVENCION"], anchor_version: 1, anchor_source: "PRESENTACION_DOCUMENTADA" };

describe("peticion presentation (operative term start)", () => {
  it("starts without acuse, radicado or authority receipt", () => {
    expect(validatePresentation(base, "2026-11-17", null)).toEqual([]);
  });
  it("requires an explicit presentation date (never inferred)", () => {
    expect(validatePresentation({ ...base, presented_on: "" }, "2026-11-17", null)[0]).toMatch(/fecha de presentación/);
  });
  it("rejects future dates and empty components", () => {
    expect(validatePresentation({ ...base, presented_on: "2026-11-18" }, "2026-11-17", null)).toContain("La fecha de presentación no puede ser futura.");
    expect(validatePresentation({ ...base, components: [] }, "2026-11-17", null)).toContain("Seleccione al menos un componente de la petición.");
  });
  it("Outlook origin needs a linked message", () => {
    expect(validatePresentation({ ...base, source: "OUTLOOK" }, "2026-11-17", null)).toContain("Para usar Outlook como origen, vincule primero el correo enviado.");
  });
  it("date correction or removed component requires a reason; adding one does not", () => {
    const msg = "Indique el motivo de la corrección (rebote, fecha real distinta, traslado…).";
    expect(validatePresentation({ ...base, presented_on: "2026-11-13" }, "2026-11-17", current)).toContain(msg);
    expect(validatePresentation({ ...base, components: ["GENERAL_INTERVENCION"] }, "2026-11-17", current)).toContain(msg);
    expect(validatePresentation({ ...base, components: [...base.components, "CONSULTA"] }, "2026-11-17", current)).toEqual([]);
  });
  it("mixed petition sends both components and the expected version on edits", () => {
    const a = buildPresentationRpcArgs("w", { ...base, components: ["GENERAL_INTERVENCION", "DOCUMENTOS_INFORMACION", "GENERAL_INTERVENCION"] }, current);
    expect(a.p_components).toEqual(["DOCUMENTOS_INFORMACION", "GENERAL_INTERVENCION"]);
    expect(a.p_expected_version).toBe(1);
    expect(buildPresentationRpcArgs("w", base, null).p_expected_version).toBeNull();
  });
  it("authority metadata never carries anchor fields", () => {
    const p = buildAuthorityPayload({ authority_name: "CORNARE", authority_email_domain: "CORNARE.gov.co", authority_radicado: "" }, { work_item_id: "w", owner_id: "o", organization_id: null });
    expect(p).not.toHaveProperty("anchor_source");
    expect(p).not.toHaveProperty("sent_at");
    expect(p.authority_email_domain).toBe("cornare.gov.co");
  });
  it("maps server errors to Spanish messages", () => {
    expect(friendlyRpcError("VERSION_DESACTUALIZADA: actual 2")).toMatch(/Recargue/);
  });
});
