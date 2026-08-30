/**
 * IW1 — A PLANILLA ANNOUNCED WITHOUT A PDF IS STILL A FIJACIÓN.
 *
 * Publicaciones Procesales states "publicado en el estado No.068 del 28 de
 * agosto de 2026" with numero, article_id and fecha, and ships no listado.
 * Before IW1 the adapter discarded the estado unit for lack of the file:
 * the fijación existed as a fact and was lost as a record.
 *
 * Case under test: 05001400301520240193000 — Verónica Ortiz Castro,
 * Juzgado 015 Civil Municipal de Medellín, 28-ago-2026.
 */
import { describe, it, expect } from "vitest";
import {
  explodeProviderPublicaciones,
  toCanonicalPubRow,
} from "../../supabase/functions/_shared/canonicalPublicacionMapper.ts";

const CTX = {
  work_item_id: "11111111-1111-1111-1111-111111111111",
  organization_id: "22222222-2222-2222-2222-222222222222",
  source: "publicaciones",
  source_radicado: "05001400301520240193000",
};

/** Verbatim shape of the 28-ago-2026 provider payload (PDF fields empty). */
const PAYLOAD_SIN_PLANILLA = {
  actuaciones: [
    {
      fecha: "28/08/2026",
      estado: {
        numero: "68",
        pdf_url: "",
        categoria: "Notificaciones por Estados (3)",
        article_id: "255804890",
        pdf_nombre: "",
        titulo_original: "Notificación por Estado No.068 de 28 de agosto de 2026",
        fecha_publicacion: "28-agosto-2026",
      },
      descripcion: "AutoAceptacargoyenviaenlace202401930ok",
      gcs_url_tabla: "",
      gcs_url_pdf_estado: "",
      pdf_url: "https://publicaciones-procesales-api-x.run.app/pdf/AUTO",
      pdf_individual_nombre: "AutoAceptacargoyenviaenlace202401930ok.pdf",
      documentos_pdf: [
        {
          tipo: "auto",
          fecha: "28/08/2026",
          titulo: "AutoAceptacargoyenviaenlace202401930ok.pdf",
          pdf_url: "https://publicaciones-procesales-api-x.run.app/pdf/AUTO",
        },
      ],
    },
  ],
};

describe("IW1 — planilla anunciada sin documento", () => {
  const units = explodeProviderPublicaciones(PAYLOAD_SIN_PLANILLA);
  const estado = units.find((u) => u.tipo === "Estado Electrónico");
  const providencia = units.find((u) => u.tipo === "Providencia");

  it("emits BOTH the estado and the providencia", () => {
    expect(units).toHaveLength(2);
    expect(estado).toBeDefined();
    expect(providencia).toBeDefined();
  });

  it("records the announcement: numero, article_id, fijación, título", () => {
    expect(estado!.estado_numero).toBe("68");
    expect(estado!.article_id).toBe("255804890");
    expect(estado!.fecha_estado_raw).toBe("28-agosto-2026");
    expect(estado!.titulo).toBe(
      "Notificación por Estado No.068 de 28 de agosto de 2026",
    );
  });

  it("records the absence of the PDF as a positive fact", () => {
    expect(estado!.planilla_sin_documento).toBe(true);
    expect(estado!.clasificacion?.es_descargable).toBe(false);
  });

  it("never invents a PDF path, URL or placeholder (S3)", () => {
    expect(estado!.pdf_url).toBeUndefined();
    // and above all: never the auto's PDF.
    expect(JSON.stringify(estado!.pdf_url ?? "")).not.toContain("/pdf/AUTO");
  });

  it("the canonical row carries the fijación with pdf_available false", () => {
    const row = toCanonicalPubRow(estado!, CTX);
    expect(row.tipo_publicacion).toBe("Estado Electrónico");
    expect(row.pdf_available).toBe(false);
    expect(row.pdf_url).toBeNull();
    expect(row.fecha_fijacion?.slice(0, 10)).toBe("2026-08-28");
    expect((row.raw_data as { planilla_sin_documento?: boolean })
      .planilla_sin_documento).toBe(true);
  });

  it("still emits the providencia with its own PDF", () => {
    const row = toCanonicalPubRow(providencia!, CTX);
    expect(row.pdf_available).toBe(true);
    expect(row.tipo_publicacion).toBe("Providencia");
  });
});

describe("IW1 — an estado WITH a PDF is unchanged", () => {
  it("keeps pdf_available true and the planilla URL", () => {
    const units = explodeProviderPublicaciones({
      actuaciones: [
        {
          estado: {
            numero: "40",
            article_id: "129759334",
            pdf_nombre: "ListadoEstadosNo. 040.pdf",
            fecha_publicacion: "18-junio-2026",
            pdf_url: "https://publicaciones-procesales-api-x.run.app/pdf/EST",
          },
          documentos_pdf: [],
        },
      ],
    });
    const estado = units.find((u) => u.tipo === "Estado Electrónico")!;
    expect(estado.planilla_sin_documento).toBe(false);
    const row = toCanonicalPubRow(estado, CTX);
    expect(row.pdf_available).toBe(true);
  });
});

describe("IW1 — an unidentifiable estado object is still not a publicación", () => {
  it("returns no units when there is no numero, article_id, date or title", () => {
    const units = explodeProviderPublicaciones({
      actuaciones: [{ estado: { categoria: "Notificaciones por Estados" } }],
    });
    expect(units).toHaveLength(0);
  });
});
