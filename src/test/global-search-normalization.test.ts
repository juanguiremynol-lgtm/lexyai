/**
 * Iteration 9-A — normalized global search semantics.
 *
 * Mirrors the SQL rules of `search_work_items_normalized`. Every case below
 * is one of the production failures reported by the user.
 */
import { describe, it, expect } from "vitest";
import {
  digitsOf,
  fold,
  formatRadicadoPretty,
  matchedFields,
  matchesQuery,
  radicadoQueryVariants,
  rankOf,
  searchWorkItems,
  type SearchableWorkItem,
} from "@/lib/search/normalized-search";

const WI: SearchableWorkItem = {
  radicado: "05001310302120250021100",
  title: "Proceso verbal",
  demandantes: "LONDOÑO SIERRA, JUAN",
  demandados: "BANCOLOMBIA S.A.",
  authority_name: "Juzgado 21 Civil del Circuito de Rionegro",
  authority_city: "Rionegro",
  workflow_type: "CGP",
  stage: "CONTESTACION",
  client_name: "Juan Londoño Sierra",
  client_id_number: "1.017.133.290",
  despacho_emails: ["j01cilactoceja@cendoj.ramajudicial.gov.co"],
  linked_emails: ["Traslado excepciones", "secretaria@cendoj.ramajudicial.gov.co"],
};

const OTHER: SearchableWorkItem = {
  radicado: "11001310300520240075200",
  title: "Ejecutivo",
  demandantes: "PEREZ, ANA",
  demandados: "XYZ LTDA",
  authority_name: "Juzgado 05 Civil del Circuito de Bogotá",
  authority_city: "Bogotá",
  workflow_type: "CGP",
  stage: "FILING",
};

describe("radicadoQueryVariants", () => {
  it("handles the hyphenated court form", () => {
    const v = radicadoQueryVariants("05001-31-03-021-2025-00211-00");
    expect(v.canonical23).toBe("05001310302120250021100");
    expect(v.base21).toBe("050013103021202500211");
    expect(v.partial).toBe(false);
  });

  it("handles space-separated and 21-digit base forms", () => {
    expect(radicadoQueryVariants("05001 3103 021 2025 00211 00").canonical23).toBe(
      "05001310302120250021100",
    );
    expect(radicadoQueryVariants("050013103021202500211").canonical23).toBe(
      "05001310302120250021100",
    );
  });

  it("repairs the 22-digit missing-leading-zero form", () => {
    expect(radicadoQueryVariants("5001310302120250021100").canonical23).toBe(
      "05001310302120250021100",
    );
  });

  it("flags 4+ digit fragments as partial", () => {
    expect(radicadoQueryVariants("00211").partial).toBe(true);
    expect(radicadoQueryVariants("211").partial).toBe(false);
  });
});

describe("reported production failures now match", () => {
  const cases: [string, string][] = [
    ["Londoño Sierra", "demandante"],
    ["LONDONO SIERRA", "demandante"], // accent-insensitive
    ["05001-31-03-021-2025-00211-00", "radicado"],
    ["05001 31 03 021 2025 00211 00", "radicado"],
    ["050013103021202500211", "radicado"],
    ["2025-00211", "radicado parcial"],
    ["00211", "radicado parcial"],
    ["0021100", "radicado parcial"],
    ["j01cilactoceja@cendoj.ramajudicial.gov.co", "correo del despacho"],
    ["j01cilactoceja", "correo del despacho"],
    ["juzgado 21 civil", "despacho"],
    ["Rionegro", "ciudad"],
    ["1.017.133.290", "cliente"],
    ["Bancolombia", "demandado"],
  ];

  for (const [query, field] of cases) {
    it(`"${query}" → ${field}`, () => {
      expect(matchesQuery(WI, query)).toBe(true);
      expect(matchedFields(WI, query)).toContain(field);
    });
  }
});

describe("multi-token AND semantics", () => {
  it("requires every token to hit some field", () => {
    expect(matchesQuery(WI, "Londoño Rionegro")).toBe(true);
    expect(matchesQuery(WI, "Londoño Bogotá")).toBe(false);
    expect(matchesQuery(OTHER, "Londoño Rionegro")).toBe(false);
  });

  it("mixes radicado fragment with a party name", () => {
    expect(matchesQuery(WI, "00211 Londoño")).toBe(true);
  });
});

describe("ranking", () => {
  it("puts exact/base radicado above substring matches", () => {
    expect(rankOf(WI, "05001310302120250021100")).toBe(1);
    expect(rankOf(WI, "050013103021202500211")).toBe(2);
    expect(rankOf(WI, "00211")).toBe(3);
    expect(rankOf(WI, "Londoño")).toBe(4);
    expect(rankOf(WI, "Rionegro")).toBe(5);
  });

  it("orders results by rank", () => {
    const rows = searchWorkItems([OTHER, WI], "05001-31-03-021-2025-00211-00");
    expect(rows.map((r) => r.radicado)).toEqual([WI.radicado]);
  });
});

describe("helpers", () => {
  it("normalizes digits and folds accents", () => {
    expect(digitsOf("05001-31-03")).toBe("0500131 03".replace(/\D/g, ""));
    expect(fold("Bogotá LONDOÑO")).toBe("bogota londono");
  });

  it("formats a radicado for humans", () => {
    expect(formatRadicadoPretty("05001310302120250021100")).toBe(
      "05001-31-03-021-2025-00211-00",
    );
  });

  it("matches on linked confirmed e-mail subjects", () => {
    expect(matchedFields(WI, "excepciones")).toContain("correo vinculado");
  });
});