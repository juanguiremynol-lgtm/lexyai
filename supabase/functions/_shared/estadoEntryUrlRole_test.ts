import { assertEquals } from "jsr:@std/assert@1";
import { mapProviderPayloadToCanonicalPubRows } from "./canonicalPublicacionMapper.ts";

const AUTO = "https://publicacionesprocesales.ramajudicial.gov.co/c/document_library/get_file?uuid=12a95c98-7757-f612-3c47-d4ffdba0402f&groupId=6098902";
const ESTADO = "https://publicacionesprocesales.ramajudicial.gov.co/c/document_library/get_file?uuid=2003ad39-9316-5546-8fd9-82cf06f4c3ef&groupId=6098902";
const PROXY_AUTO = "https://publicaciones-procesales-api-11974381924.us-central1.run.app/pdf/QVVUTw";
const PROXY_EST = "https://publicaciones-procesales-api-11974381924.us-central1.run.app/pdf/RVNU";

// J23 article 273810898 shape (estado 125 + auto 19/10).
const raw = {
  url: AUTO, fecha: "19/10/2026", pdf_url: PROXY_AUTO,
  estado: { numero: "125", pdf_url: ESTADO, article_id: "273810898", pdf_nombre: "Estado 125.pdf",
    titulo_original: "Notificación por Estado No.125 de 20 de octubre de 2026", fecha_publicacion: "20-octubre-2026" },
  documentos_pdf: [
    { tipo: "auto", fecha: "19/10/2026", titulo: "2025-00638AutoAceptaDesistimiento.pdf", pdf_url: PROXY_AUTO },
    { tipo: "estado", fecha: "20-octubre-2026", titulo: "Estado 125.pdf", pdf_url: PROXY_EST },
  ],
};

Deno.test("estado row points to its own official estado link; providencia keeps the auto", () => {
  const rows = mapProviderPayloadToCanonicalPubRows({ publicaciones: [raw] } as any, { workItemId: "b4037a4d-0dab-422d-a65f-b7172b040fa4" } as any) as any[];
  const estado = rows.find(r => /^Estado 125/.test(r.title));
  const prov = rows.find(r => /^Providencia/.test(r.title));
  assertEquals(estado?.entry_url, ESTADO);
  assertEquals(prov?.entry_url, AUTO);
});
