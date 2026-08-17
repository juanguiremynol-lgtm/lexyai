/**
 * ITER60 — GCP emits explicit radicado_23 / radicado_base_21 / instancia
 * (the 2-digit consecutivo) / despacho, plus act-level `documentos`.
 */
import { describe, expect, it } from "vitest";
import { resolveProviderLinkage } from "../../supabase/functions/_shared/recursoStreams.ts";
import {
  documentosObserved,
  normalizeActDocumentos,
} from "../../supabase/functions/_shared/actDocumentos.ts";

describe("ITER60 — explicit provider fields", () => {
  it("reads radicado_23 / radicado_base_21 / despacho verbatim", () => {
    const l = resolveProviderLinkage({
      radicado_23: "05001400302820260052101",
      radicado_base_21: "050014003028202600521",
      instancia: "01",
      despacho: "Juzgado 009 Civil del Circuito de Medellín",
    });
    expect(l.radicacion).toBe("05001400302820260052101");
    expect(l.base21).toBe("050014003028202600521");
    expect(l.despacho).toBe("Juzgado 009 Civil del Circuito de Medellín");
    expect(l.conflict).toBe(false);
  });

  it("reads `instancia` as the consecutivo, never as an ordinal grade", () => {
    // The contract break: "01" used to be an alias of tipo_categoria.
    expect(resolveProviderLinkage({ radicado_23: "05001400302820260052101", instancia: "01" }).instancia)
      .toBe("SEGUNDA");
    expect(resolveProviderLinkage({ radicado_23: "05001400302820260052100", instancia: "00" }).instancia)
      .toBe("PRIMERA");
  });
});

describe("ITER60 — act documents", () => {
  it("normalises CPNU documents, keeps name-only announcements, drops empties", () => {
    const docs = normalizeActDocumentos([
      { idRegDocumento: 991, nombre: "Auto.pdf", url: "https://x/1.pdf", fechaCarga: "2026-08-01" },
      { nombre: "01ActaReparto.pdf", url: "" },
      {},
      { idRegDocumento: 991, nombre: "duplicado", url: "https://x/1.pdf" },
    ]);
    expect(docs).toHaveLength(2);
    expect(docs?.[0]).toMatchObject({ id: "991", nombre: "Auto.pdf", url: "https://x/1.pdf", disponible: true });
    // ITER64 — announced without a link is NOT the same as "no documents".
    expect(docs?.[1]).toMatchObject({
      nombre: "01ActaReparto.pdf",
      url: null,
      disponible: false,
      estado: "SIN_ENLACE_DEL_PROVEEDOR",
    });
  });

  it("distinguishes 'provider says none' from 'never asked'", () => {
    expect(normalizeActDocumentos([])).toEqual([]);
    expect(documentosObserved([])).toBe(true);
    expect(normalizeActDocumentos(undefined)).toBeNull();
    expect(documentosObserved(undefined)).toBe(false);
  });
});
