import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { documentosEnrichmentPatch, mergeActDocumentos, normalizeActDocumentos } from "./actDocumentos.ts";

Deno.test("documents: preserve a linkless descriptor and provider metadata", () => {
  const docs = normalizeActDocumentos([{ tokenDocumento: "token-1", nombre: "anexo.pdf", estado: "CLASIFICADA", consulta: { status: "restricted" } }]);
  assertEquals(docs?.[0].id, "token-1");
  assertEquals(docs?.[0].consulta, { status: "restricted" });
  assertEquals(docs?.[0].disponible, false);
});

Deno.test("documents: additive enrichment retains both documents and original URLs", () => {
  const prior = [{ id: "A", url: "https://source.example/a", foo: "kept" }, { id: "B", url: "https://source.example/b" }];
  const patch = documentosEnrichmentPatch(prior, null, [{ id: "A", gcs_url: "https://storage.googleapis.com/test/a.pdf", sha256: "hash", size: 1200 }], null);
  assertEquals(patch?.documentos.length, 2);
  assertEquals(patch?.documentos[0].foo, "kept");
  assertEquals(patch?.documentos[0].url, "https://source.example/a");
  assertEquals(patch?.documentos[0].gcs_url, "https://storage.googleapis.com/test/a.pdf");
});

Deno.test("documents: filename alone cannot merge two documents or identify a later link", () => {
  const docs = normalizeActDocumentos([{ nombre: "anexo.pdf" }, { nombre: "anexo.pdf", url: "https://source.example/one" }, { nombre: "anexo.pdf", url: "https://source.example/two" }]);
  assertEquals(docs?.length, 3);
});

Deno.test("documents: conflicting provider identities stay distinct even with a shared URL", () => {
  const docs = normalizeActDocumentos([{ id: "A", url: "https://source.example/shared" }, { id: "B", url: "https://source.example/shared" }]);
  assertEquals(docs?.length, 2);
});

Deno.test("documents: failed CPNU download keeps its source link without claiming availability", () => {
  const docs = normalizeActDocumentos([{ id: '4033646621', url: 'https://consultaprocesos.ramajudicial.gov.co:448/api/v2/Descarga/Documento/4033646621', estado: 'FALLIDO', error: 'HTTP 500', disponible: true }]);
  assertEquals(docs?.[0].disponible, false);
  assertEquals(docs?.[0].estado, 'FALLIDO');
});

Deno.test("documents: merging repeated failed descriptors cannot promote a retained URL", () => {
  const doc = { id: 'X', url: 'https://source.example/failing.pdf', estado: 'FALLIDO', disponible: false };
  const merged = mergeActDocumentos([doc], [{ ...doc, error: 'HTTP 500', disponible: true }]);
  assertEquals(merged?.length, 1);
  assertEquals(merged?.[0].disponible, false);
});

Deno.test("documents: dated readable stored copy survives a failed retry of its original URL", () => {
  const g = 'https://storage.googleapis.com/andromeda-cpnu-documentos-2026/a.pdf';
  const stored = { id: 'A', url: g, gcs_url: g, estado: 'FALLIDO', descarga_estado: 'descargado_y_leido', descarga_observado_en: '2026-10-20T10:00:00Z',
    pdf_verificacion: { paginas: 2, paginas_leidas: 2, bytes: 2048, sha256: 'a'.repeat(64) }, disponible: true };
  const retry = { id: 'A', url: 'https://source.example/a.pdf', estado: 'FALLIDO', descarga_estado: 'no_verificada', descarga_observado_en: '2026-10-20T11:00:00Z', disponible: false };
  const merged = mergeActDocumentos([stored], [retry]);
  assertEquals(merged?.[0].gcs_url, g);
  assertEquals(merged?.[0].disponible, true);
});
