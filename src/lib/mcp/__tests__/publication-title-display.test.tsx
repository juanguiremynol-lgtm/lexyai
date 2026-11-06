import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EstadosTable } from "../../../pages/WorkItemDetail/tabs/EstadosTable";
import { publicationTitleDateNotice } from "../../publication-title-date";

describe("publication date notice", () => {
  it("shows the conflicting dates next to the original filename", () => {
    const title = "Providencia Auto.pdf — 09/10/2026";
    const html = renderToStaticMarkup(<EstadosTable rows={[{ key: "a", fuente: "PP", title,
      advertencia_fecha: publicationTitleDateNotice(title, "2026-10-06"), fecha: "2026-10-13" }]} />);
    expect(html).toContain("Providencia Auto.pdf");
    expect(html).toContain("difiere de la fecha del auto guardada");
    expect(html).toMatch(/9(?: de)? oct(?: de)? 2026/);
    expect(html).toMatch(/6(?: de)? oct(?: de)? 2026/);
    expect(html).toMatch(/13(?: de)? oct(?: de)? 2026/);
  });
});
