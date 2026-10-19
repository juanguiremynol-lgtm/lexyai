import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { documentosEnrichmentPatch, normalizeActDocumentos } from "./actDocumentos.ts";

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
