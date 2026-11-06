import { describe, expect, it } from "vitest";
import { COVERAGE_UNVERIFIED_LABEL, DEDUP_LABEL, EMPTY_UNVERIFIED_LABEL, isVerifiedSuccess, PROVIDER_UNRESOLVED_LABEL, sourceEvidence, syncCheckState, UNVERIFIED_LABEL } from "../sync-check-state";

const RAD = "05001400300120250000100"; // synthetic 23-digit radicado

describe("get_work_item verified-success contract", () => {
  it("old false-green rows are never 'Consulta exitosa'", () => {
    for (const row of [
      { provider: "unknown", status: "success", error_code: "PROVIDER_UNRESOLVED", records_skipped: 11 },
      { provider: "publicaciones", status: "success", error_code: "PROVIDER_UNRESOLVED", records_skipped: 3 },
      { provider: "none", status: "success", error_code: null, records_inserted: 1 },
      { provider: "publicaciones+unknown", status: "success", error_code: null, records_inserted: 1 },
    ]) {
      const s = syncCheckState(RAD, row);
      expect(s.state).toBe("PENDIENTE");
      expect(s.label).toBe(row.error_code === "PROVIDER_UNRESOLVED" ? PROVIDER_UNRESOLVED_LABEL : UNVERIFIED_LABEL);
      expect(isVerifiedSuccess(row)).toBe(false);
    }
  });

  it("verified success keeps its label", () => {
    const row = { provider: "publicaciones+samai_estados", status: "success", error_code: null, records_skipped: 2,
      metadata:{source_complete:true,source_observed_at:new Date(Date.now()-60_000).toISOString()} };
    expect(isVerifiedSuccess(row)).toBe(true);
    expect(syncCheckState(RAD, row).label).toBe("Consulta exitosa con resultados");
    for (const status of ["empty", "success_empty", "not_found"]) {
      const empty = { provider: "cpnu", status, error_code: null };
      expect(isVerifiedSuccess(empty)).toBe(false);
      expect(syncCheckState(RAD, empty)).toEqual({ state: "PENDIENTE", label: EMPTY_UNVERIFIED_LABEL });
    }
  });

  it("requires complete scope and a source time, while keeping row diagnostics separate", () => {
    const time = new Date(Date.now()-60_000).toISOString();
    const base = {provider:"samai_estados",status:"success",error_code:null,records_skipped:1};
    for (const metadata of [undefined, {source_complete:false,source_observed_at:time},
      {source_complete:true}, {source_complete:true,source_observed_at:"invalid"}]) {
      expect(isVerifiedSuccess({...base,metadata})).toBe(false);
      expect(syncCheckState(RAD,{...base,metadata}).label).toBe(COVERAGE_UNVERIFIED_LABEL);
    }
    const stored={...base,metadata:{source_complete:true,source_observed_at:time,
      source_query_attempted:false,reused_completed_read:true,fecha_estado_diagnostico:"FIJACION_NO_CAPTURADA"}};
    expect(isVerifiedSuccess(stored)).toBe(true);
    expect(syncCheckState(RAD,stored).label).toContain("No es una consulta nueva");
    expect(sourceEvidence(stored)).toEqual({consulta_completa:true,fuente_observada_en:time,observacion_de_hoy:true,lectura_almacenada:true,consulta_nueva:false});
    expect(isVerifiedSuccess({...stored,status:"empty"})).toBe(true);
    expect(syncCheckState(RAD,{...stored,status:"empty"}).state).toBe("SIN_NOVEDADES");
    const old={...stored,metadata:{...stored.metadata,source_observed_at:new Date(Date.now()-48*3600_000).toISOString()}};
    expect(isVerifiedSuccess(old)).toBe(false);
    expect(syncCheckState(RAD,old).label).toContain("vigilancia de hoy no está acreditada");
  });

  it("daily dedup is not a new query", () => {
    expect(syncCheckState(RAD, { provider: "unknown", status: "deduplicated", error_code: "DAILY_UPDATE_ALREADY_STARTED" }))
      .toEqual({ state: "PENDIENTE", label: DEDUP_LABEL });
  });

  it("errors stay failed", () => {
    expect(syncCheckState(RAD, { provider: "publicaciones", status: "error", error_code: "PORTAL_TIMEOUT" }).state).toBe("FALLIDA");
  });

  it("explains a partial provider failure and pending source without calling either success", () => {
    expect(syncCheckState(RAD, { provider: "cpnu", status: "partial", error_code: "PROVIDER_NOT_FOUND" }).label)
      .toContain("PROVIDER_NOT_FOUND");
    expect(syncCheckState(RAD, { provider: "publicaciones", status: "pending_upstream" }).label)
      .toContain("aún no está completa");
  });
  it("explains unresolved providers and does not call skipped queries initial", () => {
    for (const status of ["skipped", "partial", "success"]) {
      expect(syncCheckState(RAD, {provider:"unknown",status,error_code:"PROVIDER_UNRESOLVED"}).label)
        .toBe(PROVIDER_UNRESOLVED_LABEL);
    }
    expect(syncCheckState(RAD, {provider:"unknown",status:"empty",error_code:null}).label).toBe(UNVERIFIED_LABEL);
    expect(syncCheckState(RAD, {provider:"cpnu",status:"partial",error_code:"PROVIDER_NOT_FOUND"}).label)
      .toContain("no demuestra que no exista");
  });
  it("explains an uncertified daily window, incomplete SAMAI inventory and date conflict", () => {
    const codes = [
      ["PP_DAILY_WINDOW_NOT_CERTIFIED", "ventana diaria"],
      ["SAMAI_INVENTORY_INCOMPLETE", "inventario completo"],
      ["PP_NATIVE_DATE_CONFLICT", "conflicto"],
      ["PP_STORED_READ_INCOMPLETE", "incompleta"],
    ];
    for (const [error_code, expected] of codes) {
      const result = syncCheckState(RAD, {provider:"publicaciones",status:"pending_upstream",error_code});
      expect(result.state).toBe("PENDIENTE");
      expect(result.label).toContain(expected);
    }
    expect(syncCheckState(RAD, {provider:"publicaciones",status:"deduplicated",error_code:"PP_STORED_READ_INCOMPLETE"}).label)
      .toContain("vigilancia diaria no está acreditada");
  });
});

describe("SQL IS NULL parity", () => {
  it("empty-string error code is not a verified success", () => {
    expect(isVerifiedSuccess({ provider: "publicaciones", status: "success", error_code: "" })).toBe(false);
  });
});
