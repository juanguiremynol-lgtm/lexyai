/**
 * ITER67 — the read API emits its own `documentos_observados_en`. That is when
 * the provider looked; our sync clock is only a fallback.
 */
import { describe, it, expect } from "vitest";
import {
  resolveDocumentosObservadosEn,
  normalizeActDocumentos,
} from "../../supabase/functions/_shared/actDocumentos";
import { resolveActDocumentoUrl, actDocumentoState } from "@/lib/act-documentos";

const LIVE = [
  {
    nombre: "01ActaReparto.pdf",
    estado: "DESCARGADO",
    tipo: "pdf",
    bytes: 17701,
    id_reg_documento: "3989585331",
    gcs_url:
      "https://storage.googleapis.com/andromeda-cpnu-documentos-2026/cpnu/05001400300520260046800/3913343521/3989585331_01ActaReparto.pdf",
    url_origen:
      "https://consultaprocesos.ramajudicial.gov.co:448/api/v2/Descarga/Documento/3989585331",
  },
];

describe("documentos_observados_en resolution", () => {
  it("prefers the provider timestamp over our sync clock", () => {
    expect(
      resolveDocumentosObservadosEn(LIVE, "2026-08-17T00:52:29.582Z", "2026-08-17T09:00:00.000Z"),
    ).toBe("2026-08-17T00:52:29.582Z");
  });

  it("falls back to the sync clock when the provider is silent", () => {
    expect(resolveDocumentosObservadosEn(LIVE, null, "2026-08-17T09:00:00.000Z")).toBe(
      "2026-08-17T09:00:00.000Z",
    );
  });

  it("keeps null when the field was never expressed", () => {
    expect(resolveDocumentosObservadosEn(null, null, "2026-08-17T09:00:00.000Z")).toBeNull();
  });

  it("ignores an unparseable provider timestamp", () => {
    expect(resolveDocumentosObservadosEn(LIVE, "no-es-fecha", "2026-08-17T09:00:00.000Z")).toBe(
      "2026-08-17T09:00:00.000Z",
    );
  });

  it("normalizes the live payload into a downloadable document", () => {
    const [doc] = normalizeActDocumentos(LIVE)!;
    expect(doc.id).toBe("3989585331");
    expect(actDocumentoState(doc)).toBe("DESCARGADO");
    expect(resolveActDocumentoUrl(doc)).toBe(LIVE[0].gcs_url);
  });
});
