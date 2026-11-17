import { describe, expect, it } from "vitest";
import { resolvePresentationDate } from "../tools/create-peticion";
import { deadlineAttribution } from "../deadline-status";

describe("create_peticion presentation date", () => {
  it("uses the explicit date", () => {
    expect(resolvePresentationDate({ presented: true, fecha_presentacion: "2026-11-16" }, "2026-11-17").date).toBe("2026-11-16");
  });
  it("uses today only with explicit confirmation", () => {
    expect(resolvePresentationDate({ presented: true, presentado_hoy_confirmado: true }, "2026-11-17").date).toBe("2026-11-17");
  });
  it("rejects a presented petition without date (never infers creation date)", () => {
    const r = resolvePresentationDate({ presented: true }, "2026-11-17");
    expect(r.date).toBeNull();
    expect(r.error).toMatch(/FECHA_PRESENTACION_REQUERIDA/);
  });
  it("draft without presentation has no date", () => {
    expect(resolvePresentationDate({ presented: false }, "2026-11-17")).toEqual({ date: null });
  });
  it("rejects a date without presented=true", () => {
    expect(resolvePresentationDate({ presented: false, fecha_presentacion: "2026-11-16" }, "2026-11-17").error).toBeTruthy();
  });
});

describe("deadline attribution", () => {
  it("petition terms belong to the administrative authority, not the judge", () => {
    expect(deadlineAttribution({ bound_party_role: "AUTORIDAD_ADMINISTRATIVA", is_judge_side: false })).toBe("AUTORIDAD_ADMINISTRATIVA");
  });
  it("judicial judge-side terms are unchanged", () => {
    expect(deadlineAttribution({ bound_party_role: "JUEZ", is_judge_side: true })).toBe("DESPACHO");
  });
});
