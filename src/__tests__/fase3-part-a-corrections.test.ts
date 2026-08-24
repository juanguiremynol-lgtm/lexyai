import { describe, expect, it } from "vitest";
import { GOV_PROCEDURE_STAGES } from "@/lib/gov-procedure/catalog";
import { PETICION_STAGES } from "@/lib/peticion/catalog";
import { caducidadAnchor, addCalendarYears } from "@/lib/gov-procedure/background-timers";

/** A.1 — the reserved-prefix guard is GLOBAL, not per-workflow. */
const RESERVED_PREFIXES = ["TERMINO_", "ALERTA_"];

const ALL_CATALOG_STAGES: Array<{ workflow: string; code: string }> = [
  ...GOV_PROCEDURE_STAGES.map((s) => ({ workflow: "GOV_PROCEDURE", code: s.code as string })),
  ...PETICION_STAGES.map((s) => ({ workflow: "PETICION", code: (s as { code: string }).code })),
];

describe("A.1 — reserved stage prefixes across the WHOLE catalog", () => {
  it("no stage code in any catalog-governed workflow starts with a reserved prefix", () => {
    const collisions = ALL_CATALOG_STAGES.filter((s) =>
      RESERVED_PREFIXES.some((p) => s.code.startsWith(p)),
    );
    expect(collisions).toEqual([]);
  });

  it("EN_TERMINO_DESCARGOS is allowed: the reserved token is a prefix, not a substring", () => {
    expect(RESERVED_PREFIXES.some((p) => "EN_TERMINO_DESCARGOS".startsWith(p))).toBe(false);
  });

  it("the guard is scope-global: it iterates the catalog, not a single workflow", () => {
    expect(new Set(ALL_CATALOG_STAGES.map((s) => s.workflow)).size).toBeGreaterThan(1);
  });
});

describe("A.2 — caducidad anchoring", () => {
  it("anchors on the fact date when the conduct is not continuing", () => {
    expect(caducidadAnchor({ factDate: "2023-03-15", cessationDate: null, conductaContinuada: false }))
      .toBe("2023-03-15");
  });

  it("anchors on the day AFTER cessation for a continuing conduct", () => {
    expect(caducidadAnchor({ factDate: "2020-01-01", cessationDate: "2023-03-15", conductaContinuada: true }))
      .toBe("2023-03-16");
  });

  it("produces no date at all when the anchor is missing", () => {
    expect(caducidadAnchor({ factDate: null, cessationDate: null, conductaContinuada: false })).toBeNull();
    expect(caducidadAnchor({ factDate: "2023-03-15", cessationDate: null, conductaContinuada: true })).toBeNull();
  });
});

describe("A.3 — the three-year caducidad is calendar arithmetic, never business days", () => {
  it("2023-03-15 + 1 year = 2024-03-15", () => {
    expect(addCalendarYears("2023-03-15", 1)).toBe("2024-03-15");
  });

  it("2023-03-15 + 3 years = 2026-03-15 regardless of weekends and holidays", () => {
    expect(addCalendarYears("2023-03-15", 3)).toBe("2026-03-15");
  });

  it("a 1 January anchor lands on 1 January, a holiday", () => {
    expect(addCalendarYears("2023-01-01", 3)).toBe("2026-01-01");
  });
});
