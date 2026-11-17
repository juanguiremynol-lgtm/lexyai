import { describe, expect, it } from "vitest";
import { expectedDeadlineEffect, validateFilingInput } from "../filing-constants";

const base = { filed_on: "2026-11-17", source_reference: "correo enviado al despacho" };

describe("register_filing rules", () => {
  it("requires the declared filing date", () => {
    expect(validateFilingInput({ ...base, filed_on: "", action_kind: "MEMORIAL", work_item_id: "x" })).toBe("FECHA_PRESENTACION_REQUERIDA");
  });
  it("requires a support", () => {
    expect(validateFilingInput({ ...base, source_reference: " ", action_kind: "MEMORIAL", work_item_id: "x" })).toBe("SOPORTE_REQUERIDO");
  });
  it("new petitions go through create_peticion", () => {
    expect(validateFilingInput({ ...base, action_kind: "PETICION", workflow_type: "PETICION" })).toBe("USE_CREATE_PETICION");
  });
  it("new matters need an explicit workflow (never inferred from the authority)", () => {
    expect(validateFilingInput({ ...base, action_kind: "DEMANDA" })).toBe("WORKFLOW_REQUERIDO");
  });
  it("sanctioning subtypes are not CPACA", () => {
    expect(validateFilingInput({ ...base, action_kind: "DEMANDA", workflow_type: "CPACA", procedure_subtype: "TRANSITO_SANCIONATORIO" })).toBe("SUBTIPO_SOLO_GOV_PROCEDURE");
  });
  it("GOV_PROCEDURE needs a subtype", () => {
    expect(validateFilingInput({ ...base, action_kind: "DESCARGOS", workflow_type: "GOV_PROCEDURE" })).toBe("SUBTIPO_REQUERIDO");
  });
  it("jurisdictional superintendence is not an administrative procedure", () => {
    expect(validateFilingInput({ ...base, action_kind: "DEMANDA", workflow_type: "GOV_PROCEDURE", procedure_subtype: "ESPECIAL", tribunal_type: "AUTORIDAD_JURISDICCIONAL" })).toBe("CLASIFICACION_INCOHERENTE");
    expect(validateFilingInput({ ...base, action_kind: "DEMANDA", workflow_type: "CGP", tribunal_type: "AUTORIDAD_JURISDICCIONAL" })).toBeNull();
  });
  it("non-23-digit judicial radicado is rejected", () => {
    expect(validateFilingInput({ ...base, action_kind: "MEMORIAL", radicado: "12345" })).toBe("RADICADO_INVALIDO");
  });
  it("filings never create a term by themselves", () => {
    expect(expectedDeadlineEffect("DEMANDA")).toBe("PENDING_TRIGGER");
    expect(expectedDeadlineEffect("TUTELA")).toBe("PENDING_TRIGGER");
    expect(expectedDeadlineEffect("SOLICITUD_ADMINISTRATIVA")).toBe("NONE");
  });
});
