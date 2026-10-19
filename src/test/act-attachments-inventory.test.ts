import { describe, it, expect } from "vitest";
import { isAndromedaCopyUrl, summarizeActAttachments, verifyPdfBytes, knownDocumentPendingCause, type FullPdfVerification } from "@/lib/act-attachments-inventory";
import { getActAttachments } from "@/lib/mcp/act-attachments-core";

const OWN = "https://storage.googleapis.com/andromeda-cpnu-documentos-2026/x/a.pdf";
const OWN2 = "https://storage.googleapis.com/andromeda-cpnu-documentos-2026/x/b.pdf";

describe('pending automatic recovery explanations', () => {
  it('retains the dated public detail limitation without claiming absence of files', () => {
    const observed = '2026-10-19T17:00:00Z';
    const result = summarizeActAttachments({ documentos: [], raw_data: { anexos: 2,
      anexos_observacion: { estado: 'detalle_sin_inventario', observado_en: observed } } });
    expect(result.observado_en).toBe(observed);
    expect(result.causa).toContain('No recuperados por la vía pública consultada');
    expect(result.causa).toContain('no acredita');
    expect(result.recuperacion_completa).toBe(false);
  });
  it.each([
    ['detalle_sin_inventario', 'desconocido', 'no devolvió'],
    ['error_consulta', 'error', 'problema temporal'],
    ['respuesta_acceso_denegado', 'restringido', 'rechazó esta consulta'],
    ['control_no_disponible', 'desconocido', 'no pudo identificar'],
  ])('distinguishes %s without turning it into user work', (sourceState, state, cause) => {
    const result = summarizeActAttachments({ description: 'Documentos anexos: 2', documentos: [],
      raw_data: { anexos_observacion: { estado: sourceState, error: { kind: 'network' } } } });
    expect(result.estado).toBe(state); expect(result.causa).toContain(cause);
    expect(result.causa).not.toMatch(/CAPTCHA|inici[ae] sesión|descargue|ejecute/i);
    expect(result.recuperacion_completa).toBe(false); expect(result.faltantes).toBe(2);
  });
  it('exposes the known cause for each pending file, including a failed cached copy', () => {
    const doc = { gcs_url: OWN, descarga_estado: 'no_verificada', recuperacion_cache: { cacheIssue: 'stored_object_missing' },
      descarga_error: { kind: 'http_transient', intentos_agotados: true } };
    const result = summarizeActAttachments({ documentos: [doc] });
    expect(result.archivos[0].causa_pendiente).toContain('copia almacenada');
    expect(result.causa).toContain('todavía no se ha recuperado'); expect(result.verificados).toBe(0);
    expect(knownDocumentPendingCause({ descarga_estado: 'no_verificada', descarga_error: { kind: 'validation' } })).toContain('lectura');
    expect(knownDocumentPendingCause({ descarga_estado: 'no_verificada', descarga_error: { kind: 'http_access' } })).toContain('rechazó');
  });
  it.each(['error_consulta', 'respuesta_acceso_denegado', 'detalle_sin_inventario'])('a retained link does not hide the latest detail cause: %s', (estado) => {
    const result = summarizeActAttachments({ documentos: [{ gcs_url: OWN }], raw_data: { anexos_observacion: { estado, error: { kind: 'network' } } } });
    expect(result.causa).toContain('consulta automática'); expect(result.causa).toContain('pendiente');
    expect(result.verificados).toBe(0); expect(result.recuperacion_completa).toBe(false);
  });
});
const pdfRes = () => new Response(new TextEncoder().encode("%PDF-1.7\n..."), { status: 206 });
const fetchMap = (m: Record<string, () => Response>) => async (u: string) => (m[u] ?? (() => new Response("", { status: 404 })))();

describe("provenance", () => {
  it("accepts only Andromeda buckets with exact host and no query", () => {
    expect(isAndromedaCopyUrl(OWN)).toBe(true);
    expect(isAndromedaCopyUrl("https://storage.googleapis.com/other-bucket/a.pdf")).toBe(false);
    expect(isAndromedaCopyUrl(`${OWN}?X-Goog-Signature=abc`)).toBe(false);
    expect(isAndromedaCopyUrl("https://andromeda-cpnu-documentos-2026.storage.googleapis.com/a.pdf")).toBe(false);
    expect(isAndromedaCopyUrl("http://storage.googleapis.com/andromeda-cpnu-documentos-2026/a.pdf")).toBe(false);
    expect(isAndromedaCopyUrl("https://storage.googleapis.com/andromeda-cpnu-documentos-2026/../evil/a.pdf")).toBe(false);
  });
});

describe("byte verification", () => {
  it("PDF bytes → pdf; 403/expired → inaccesible; HTML → no_pdf; network → error_red", async () => {
    expect((await verifyPdfBytes(OWN, async () => pdfRes())).status).toBe("cabecera_pdf");
    expect((await verifyPdfBytes(OWN, async () => new Response("AccessDenied", { status: 403 }))).status).toBe("inaccesible");
    expect((await verifyPdfBytes(OWN, async () => new Response("<html>", { status: 200 }))).status).toBe("no_pdf");
    expect((await verifyPdfBytes(OWN, async () => { throw new Error("timeout"); })).status).toBe("error_red");
  });
});

describe("summary states", () => {
  it("null documentos, no evidence → desconocido", () => {
    expect(summarizeActAttachments({ documentos: null, raw_data: {} }).estado).toBe("desconocido");
  });
  it("URL without verification is never disponible", () => {
    const s = summarizeActAttachments({ documentos: [{ gcs_url: OWN }], raw_data: {} });
    expect(s.estado).toBe("enlaces_sin_verificar");
    expect(s.archivos[0].url).toBeNull();
  });
  it("foreign bucket is never exposed nor counted", () => {
    const s = summarizeActAttachments(
      { documentos: [{ gcs_url: "https://storage.googleapis.com/other/a.pdf" }], raw_data: {} },
      { "https://storage.googleapis.com/other/a.pdf": { status: "cabecera_pdf", http: 200 } },
    );
    expect(s.verificados).toBe(0);
    expect(s.archivos[0].verificacion).toBe("origen_no_permitido");
    expect(s.archivos[0].url).toBeNull();
  });
  it("one header of six announced is not a recovered document", () => {
    const s = summarizeActAttachments(
      { documentos: [{ gcs_url: OWN }, { gcs_url: OWN2 }], raw_data: { anexos_inventario: { anunciados: 6 } } },
      { [OWN]: { status: "cabecera_pdf", http: 206 }, [OWN2]: { status: "inaccesible", http: 403 } },
    );
    expect(s.estado).toBe("cabeceras_verificadas");
    expect(s.verificados).toBe(0);
    expect(s.cabeceras_verificadas).toBe(1);
    expect(s.anunciados).toBe(6);
    expect(s.faltantes).toBe(6);
    expect(s.recuperacion_completa).toBe(false);
  });
  it("all links expired → inaccesible", () => {
    const s = summarizeActAttachments({ documentos: [{ gcs_url: OWN }] }, { [OWN]: { status: "inaccesible", http: 403 } });
    expect(s.estado).toBe("inaccesible");
  });
  it("explicit provider zero → sin_anexos", () => {
    expect(summarizeActAttachments({ documentos: [], documentos_observados_en: "2026-10-18", raw_data: { anexos: 0 } }).estado).toBe("sin_anexos");
  });
  it.each([false, true, " ", [], {}, 0.5])("invalid annex count %j does not assert zero or a total", (anexos) => {
    const s = summarizeActAttachments({ documentos: [], raw_data: { anexos } });
    expect(s.anunciados).toBeNull();
    expect(s.estado).toBe("desconocido");
  });
  it.each(["1 archivo", "1-archivo", "2 Archivos", "- 2 archivos"])("reads the source annex count from %s", (description) => {
    const s = summarizeActAttachments({ documentos: [], description });
    expect(s.anunciados).toBe(Number(description.match(/\d+/)![0]));
  });
});

// Fake RLS: user U1 sees org1 rows only.
function fakeSb(visibleActs: any[], visibleItems: any[]) {
  return {
    from(table: string) {
      const rows = table === "work_item_acts" ? visibleActs : visibleItems;
      let id: string | null = null;
      const q: any = {
        select: () => q,
        eq: (_c: string, v: string) => { id = v; return q; },
        maybeSingle: async () => ({ data: rows.find((r) => r.id === id) ?? null, error: null }),
      };
      return q;
    },
  };
}
const resolver = async (sb: any, a: { id?: string; radicado?: string }) => {
  const { data } = await sb.from("work_items").select().eq("id", a.id ?? a.radicado).maybeSingle();
  return data ? { item: data, error: null } : { item: null, error: "Asunto no encontrado (o no pertenece a tu cuenta)." };
};
const ACT = { id: "a1", work_item_id: "w1", documentos: [{ gcs_url: OWN }], raw_data: { anexos_inventario: { anunciados: 6 } } };

describe("MCP core isolation", () => {
  it("act_id alone works for the owner and verifies bytes", async () => {
    const r = await getActAttachments({ sb: fakeSb([ACT], [{ id: "w1" }]), resolveWorkItem: resolver, fetchImpl: fetchMap({ [OWN]: pdfRes }), act_id: "a1" });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.data.estado).toBe("cabeceras_verificadas"); expect(r.data.faltantes).toBe(6); expect(r.data.verificados).toBe(0); expect(r.data.recuperacion_completa).toBe(false); }
  });
  it("other account (RLS hides act) → not found, no fetch performed", async () => {
    let fetched = false;
    const r = await getActAttachments({ sb: fakeSb([], []), resolveWorkItem: resolver, fetchImpl: async () => { fetched = true; return pdfRes(); }, act_id: "a1" });
    expect(r.ok).toBe(false);
    expect(fetched).toBe(false);
  });
  it("act visible but its matter not visible/deleted → rejected", async () => {
    const r = await getActAttachments({ sb: fakeSb([ACT], []), resolveWorkItem: resolver, fetchImpl: fetchMap({}), act_id: "a1" });
    expect(r.ok).toBe(false);
  });
  it("named matter different from the act's matter → rejected", async () => {
    const r = await getActAttachments({ sb: fakeSb([ACT], [{ id: "w1" }, { id: "w2" }]), resolveWorkItem: resolver, fetchImpl: fetchMap({}), act_id: "a1", work_item_id: "w2" });
    expect(r).toEqual({ ok: false, error: "La actuación no pertenece al asunto indicado." });
  });
});

describe("verifyPdfBytes header-only stream limit", () => {
  it("reads at most the header limit and cancels when the server ignores Range", async () => {
    const { verifyPdfBytes, PDF_HEADER_READ_LIMIT } = await import("@/lib/act-attachments-inventory");
    let pulled = 0;
    let cancelled = false;
    const chunk = new Uint8Array(64 * 1024);
    chunk.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const body = new ReadableStream<Uint8Array>({
      pull(c) { pulled += chunk.length; c.enqueue(chunk); }, // endless 200 body
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const res = new Response(body, { status: 200 });
    const r = await verifyPdfBytes("https://storage.googleapis.com/andromeda-cpnu-documentos-2026/a.pdf", async () => res);
    expect(r).toEqual({ status: "cabecera_pdf", http: 200 });
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(2 * chunk.length);
    expect(PDF_HEADER_READ_LIMIT).toBe(1024);
  });
});

const verified = (actId = "a1", docId = "d1"): FullPdfVerification => ({
  status: "pdf_verificado", http: 200, descarga_completa: true,
  paginas_legibles: 2, paginas_totales: 2, sha256: "a".repeat(64), bytes: 2048,
  atribucion: { act_id: actId, documento_id: docId, evidencia: "Source document id, request, date and PDF text match" },
});
const fullAct = {
  id: "a1", description: "RECIBE MEMORIALES ONLINE - Documentos anexos: 6",
  documentos: [{ id: "d1", gcs_url: OWN }], raw_data: {},
};
describe("recovery requires complete readable bytes and exact act attribution", () => {
  it("a truncated PDF header is reachable but neither readable nor recovered", async () => {
    const result = await verifyPdfBytes(OWN, async () => new Response("%PDF-"));
    const s = summarizeActAttachments(fullAct, { [OWN]: result });
    expect(s.archivos[0].url).toBe(OWN);
    expect(s.archivos[0].descarga_completa_y_legible).toBe(false);
    expect(s.archivos[0].atribuido_a_actuacion).toBe(false);
    expect(s.verificados).toBe(0);
    expect(s.recuperacion_completa).toBe(false);
  });
  it("one fully verified and attributed PDF of six remains partial", () => {
    const s = summarizeActAttachments(fullAct, { [OWN]: verified() });
    expect(s.estado).toBe("parcial");
    expect(s.verificados).toBe(1);
    expect(s.faltantes).toBe(5);
    expect(s.recuperacion_completa).toBe(false);
  });
  it("full readable bytes from another act or document do not count as recovered", () => {
    for (const v of [verified("a2"), verified("a1", "different-document")]) {
      const s = summarizeActAttachments(fullAct, { [OWN]: v });
      expect(s.descargados_completos).toBe(1);
      expect(s.verificados).toBe(0);
      expect(s.estado).toBe("pdf_sin_atribuir");
    }
  });
  it("hash/size/provider estado without full readable pages cannot promote a file", () => {
    const invalid = { ...verified(), paginas_legibles: 1 };
    const s = summarizeActAttachments(fullAct, { [OWN]: invalid });
    expect(s.verificados).toBe(0);
    expect(s.recuperacion_completa).toBe(false);
    const providerClaim = { ...fullAct, documentos: [{ ...fullAct.documentos[0], estado: "DESCARGADO", sha256: "a".repeat(64), size_bytes: 2048, pdf_verified: true }] };
    expect(summarizeActAttachments(providerClaim).verificados).toBe(0);
  });
  it("complete recovery requires a known count, not the descriptor array length", () => {
    const unknown = summarizeActAttachments({ ...fullAct, description: null }, { [OWN]: verified() });
    expect(unknown.anunciados).toBeNull();
    expect(unknown.estado).toBe("parcial");
    expect(unknown.recuperacion_completa).toBe(false);
    const complete = summarizeActAttachments({ ...fullAct, description: "Documentos anexos: 1" }, { [OWN]: verified() });
    expect(complete.estado).toBe("disponible");
    expect(complete.recuperacion_completa).toBe(true);
  });
  it("historical descriptor-derived totals never certify complete recovery", () => {
    const raw_data = { anexos_inventario: { anunciados: 1, fuente_conteo: "descriptores" } };
    const unknown = summarizeActAttachments({ ...fullAct, description: null, raw_data }, { [OWN]: verified() });
    expect(unknown.anunciados).toBeNull();
    expect(unknown.estado).toBe("parcial");
    expect(unknown.recuperacion_completa).toBe(false);
    const announced = summarizeActAttachments({ ...fullAct, description: null, raw_data: { ...raw_data, anexos: 6 } }, { [OWN]: verified() });
    expect(announced.anunciados).toBe(6);
    expect(announced.faltantes).toBe(5);
    expect(announced.recuperacion_completa).toBe(false);
  });
  it("duplicate descriptors of one copy cannot fill two announced annexes", () => {
    const s = summarizeActAttachments({ ...fullAct, description: "Documentos anexos: 2", documentos: [fullAct.documentos[0], fullAct.documentos[0]] }, { [OWN]: verified() });
    expect(s.verificados).toBe(1);
    expect(s.estado).toBe("parcial");
  });
  it.each([{ id: "d2", nombre: "sin enlace.pdf" }, { id: "d2", gcs_url: OWN2 }])("a known unverified document prevents complete recovery despite a smaller announced count: %j", (unverified) => {
    const s = summarizeActAttachments({ ...fullAct, description: "Documentos anexos: 1", documentos: [fullAct.documentos[0], unverified] }, { [OWN]: verified() });
    expect(s.verificados).toBe(1);
    expect(s.archivos[1].recuperado).toBe(false);
    expect(s.estado).toBe("parcial");
    expect(s.recuperacion_completa).toBe(false);
  });
  it("empty descriptor array and observation timestamp cannot erase six announced annexes", () => {
    const s = summarizeActAttachments({ ...fullAct, documentos: [], documentos_observados_en: "2026-10-18", raw_data: { anexos_inventario: { estado: "sin_anexos", anunciados: 0 } } });
    expect(s.anunciados).toBe(6);
    expect(s.estado).toBe("desconocido");
    expect(s.faltantes).toBe(6);
  });
  it("unattempted links are not reported inaccessible after a verification cap", () => {
    const s = summarizeActAttachments({ documentos: [{ url: OWN }, { url: OWN2 }] }, { [OWN]: { status: "inaccesible", http: 403 } });
    expect(s.estado).toBe("enlaces_sin_verificar");
  });
  it("allows known SAMAI copies, rejects traversal and never fetches a foreign origin", async () => {
    expect(isAndromedaCopyUrl("https://storage.googleapis.com/andromeda-samai-documentos-2026/samai/x.pdf")).toBe(true);
    expect(isAndromedaCopyUrl("https://storage.googleapis.com/andromeda-cpnu-documentos-2026/x/../a.pdf")).toBe(false);
    let fetched = false;
    await verifyPdfBytes("https://example.com/a.pdf", async () => { fetched = true; return pdfRes(); });
    expect(fetched).toBe(false);
  });
});
