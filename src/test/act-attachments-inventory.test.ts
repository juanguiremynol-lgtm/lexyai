import { describe, it, expect } from "vitest";
import { summarizeActAttachments } from "@/lib/act-attachments-inventory";

describe("act attachments inventory (ITER70)", () => {
  it("null documentos is no_consultado, never sin_anexos (real case act 745950bb)", () => {
    const s = summarizeActAttachments({ documentos: null, documentos_observados_en: null, raw_data: {} });
    expect(s.estado).toBe("no_consultado");
    expect(s.anunciados).toBeNull();
  });
  it("uses stored inventory with announced count", () => {
    const s = summarizeActAttachments({
      documentos: null,
      raw_data: { anexos_inventario: { anunciados: 6, estado: "no_consultado", causa: "x" } },
    });
    expect(s.estado).toBe("no_consultado");
    expect(s.anunciados).toBe(6);
  });
  it("only Andromeda-held copies are exposed as links", () => {
    const s = summarizeActAttachments({
      documentos: [
        { nombre: "a.pdf", gcs_url: "https://storage.googleapis.com/b/a.pdf" },
        { nombre: "b.pdf", url: "https://samai.consejodeestado.gov.co/x" },
      ],
      raw_data: {},
    });
    expect(s.estado).toBe("disponible");
    expect(s.enlazados).toBe(1);
    expect(s.archivos.map((a) => a.nombre)).toEqual(["a.pdf"]);
  });
  it("explicit provider zero is sin_anexos", () => {
    const s = summarizeActAttachments({ documentos: [], documentos_observados_en: "2026-10-18T00:00:00Z", raw_data: {} });
    expect(s.estado).toBe("sin_anexos");
  });
});
