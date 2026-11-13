import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrintedDateNotes } from "@/pages/WorkItemDetail/tabs/PrintedDateNotes";

const url = "https://storage.googleapis.com/andromeda-pp-documentos-2026/12345678901234567890123/raw/estados/file.pdf";
const sample = { publication_id:"pub", source_article:"12345", original_sha256:"a".repeat(64),
  first_page:8,last_page:9,recorded_fixation:"2026-10-21",printed_fixation:"2026-10-22",source_url:url,observed_at:"2026-11-13T18:00:00Z" };
const html = (data: unknown) => renderToStaticMarkup(createElement(PrintedDateNotes,{ publications:[{id:"pub", title:"Estado", printed_observations:data}] }));
describe("estado original archivado", () => {
  it("shows the archived pages and separates the printed and recorded date", () => {
    const result = html([sample]);
    for(const text of ["Estado del artículo 12345","Fijación impresa","Fecha registrada","páginas 8–9",url+"#page=8",sample.original_sha256]) expect(result).toContain(text);
  });
  it("ignores unrelated or malformed sources", () => {
    expect(html([{...sample,publication_id:"other"},{...sample,source_url:"https://example.invalid/estado.pdf"}])).toBe("");
    expect(html([])).toBe("");
  });
});
