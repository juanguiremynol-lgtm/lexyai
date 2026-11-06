import { describe, expect, it } from "vitest";
import { publicationTitleDateDiscrepancy, publicationTitleDateNotice } from "../../publication-title-date";

describe("date in publication title", () => {
  it("flags a different provider title date without rewriting either date", () => {
    const title = "Providencia Auto.pdf — 09/10/2026";
    expect(publicationTitleDateDiscrepancy(title, "2026-10-06T12:00:00Z"))
      .toEqual({ fecha_titulo: "2026-10-09", fecha_providencia: "2026-10-06" });
    expect(publicationTitleDateNotice(title, "2026-10-06T12:00:00Z"))
      .toContain("difiere de la fecha del auto guardada");
  });

  it("does not infer a conflict without two valid dates or from a state title", () => {
    expect(publicationTitleDateDiscrepancy("Providencia Auto.pdf — 09/10/2026", "2026-10-09")).toBeNull();
    expect(publicationTitleDateDiscrepancy("Providencia Auto.pdf — 09/10/2026", null)).toBeNull();
    expect(publicationTitleDateDiscrepancy("Providencia Auto.pdf — 32/10/2026", "2026-10-06")).toBeNull();
    expect(publicationTitleDateDiscrepancy("Estado 159 — 13/10/2026", "2026-10-06")).toBeNull();
  });
});
