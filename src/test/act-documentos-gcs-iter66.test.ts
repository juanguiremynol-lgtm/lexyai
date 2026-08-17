/**
 * ITER66 — the act document URL lives in `gcs_url`, never only in `url`.
 * These tests lock the binding so a DESCARGADO document can never render as
 * an amber "sin enlace" chip again.
 */
import { describe, it, expect } from "vitest";
import {
  resolveActDocumentoUrl,
  actDocumentoState,
  actDocumentoStateLabel,
} from "@/lib/act-documentos";
import { normalizeActDocumentos } from "../../supabase/functions/_shared/actDocumentos";

const GCS =
  "https://storage.googleapis.com/andromeda-cpnu-documentos-2026/cpnu/05001400300520260046800/3913343521/3989585331_01ActaReparto.pdf";
const ORIGEN =
  "https://consultaprocesos.ramajudicial.gov.co/api/v2/Descarga/Documento/3989585331";

describe("act documento URL binding", () => {
  it("prefers gcs_url over url and url_origen", () => {
    expect(
      resolveActDocumentoUrl({ gcs_url: GCS, url: null, url_origen: ORIGEN }),
    ).toBe(GCS);
  });

  it("falls back to url_origen when nothing else resolves", () => {
    expect(resolveActDocumentoUrl({ url_origen: ORIGEN })).toBe(ORIGEN);
  });

  it("classifies a DESCARGADO document as downloadable", () => {
    expect(actDocumentoState({ estado: "DESCARGADO", gcs_url: GCS })).toBe("DESCARGADO");
  });

  it("keeps PENDIENTE / FALLIDO / INVALIDO distinguishable", () => {
    expect(actDocumentoState({ estado: "PENDIENTE" })).toBe("PENDIENTE");
    expect(actDocumentoState({ estado: "FALLIDO" })).toBe("FALLIDO");
    expect(actDocumentoState({ estado: "INVALIDO" })).toBe("INVALIDO");
    expect(actDocumentoStateLabel("INVALIDO")).toMatch(/inválido/i);
  });

  it("normalizer emits gcs_url and url_origen verbatim", () => {
    const [doc] = normalizeActDocumentos([
      { nombre: "01ActaReparto.pdf", gcs_url: GCS, url_origen: ORIGEN, estado: "DESCARGADO" },
    ])!;
    expect(doc.gcs_url).toBe(GCS);
    expect(doc.url_origen).toBe(ORIGEN);
    expect(doc.url).toBe(GCS);
    expect(doc.disponible).toBe(true);
    expect(resolveActDocumentoUrl(doc)).toBe(GCS);
  });

  it("still marks an announced-but-unlinked document as unavailable", () => {
    const [doc] = normalizeActDocumentos([{ nombre: "01ActaReparto.pdf" }])!;
    expect(doc.disponible).toBe(false);
    expect(resolveActDocumentoUrl(doc)).toBeNull();
    expect(actDocumentoState(doc)).toBe("SIN_ENLACE");
  });
});