import { describe, expect, it } from "vitest";
import { DEDUP_LABEL, isVerifiedSuccess, syncCheckState, UNVERIFIED_LABEL } from "../sync-check-state";

const RAD = "05001400300120250000100"; // synthetic 23-digit radicado

describe("get_work_item verified-success contract", () => {
  it("old false-green rows are never 'Consulta exitosa'", () => {
    for (const row of [
      { provider: "unknown", status: "success", error_code: "PROVIDER_UNRESOLVED", records_skipped: 11 },
      { provider: "publicaciones", status: "success", error_code: "PROVIDER_UNRESOLVED", records_skipped: 3 },
      { provider: "none", status: "success", error_code: null, records_inserted: 1 },
      { provider: "publicaciones+unknown", status: "success", error_code: null, records_inserted: 1 },
      { provider: "", status: "empty", error_code: null },
    ]) {
      const s = syncCheckState(RAD, row);
      expect(s.state).toBe("PENDIENTE");
      expect(s.label).toBe(UNVERIFIED_LABEL);
      expect(isVerifiedSuccess(row)).toBe(false);
    }
  });

  it("verified success keeps its label", () => {
    const row = { provider: "publicaciones+samai_estados", status: "success", error_code: null, records_skipped: 2 };
    expect(isVerifiedSuccess(row)).toBe(true);
    expect(syncCheckState(RAD, row).label).toBe("Consulta exitosa con resultados");
    expect(syncCheckState(RAD, { provider: "cpnu", status: "empty", error_code: null }).label).toBe("Consulta exitosa sin novedades");
  });

  it("daily dedup is not a new query", () => {
    expect(syncCheckState(RAD, { provider: "unknown", status: "deduplicated", error_code: "DAILY_UPDATE_ALREADY_STARTED" }))
      .toEqual({ state: "PENDIENTE", label: DEDUP_LABEL });
  });

  it("errors stay failed", () => {
    expect(syncCheckState(RAD, { provider: "publicaciones", status: "error", error_code: "PORTAL_TIMEOUT" }).state).toBe("FALLIDA");
  });
});
