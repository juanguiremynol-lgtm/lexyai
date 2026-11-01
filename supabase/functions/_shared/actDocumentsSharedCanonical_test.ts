import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mergeActDocumentos, documentosEnrichmentPatch } from "./actDocumentos.ts";
import { observationCanonicalizer } from "./actDocumentObservation.ts";

// Large stored histories made sync-by-work-item exceed its CPU limit because
// every merge re-serialized them. A canonicalizer shared within one fresh read
// must give the same result while serializing each stored variant once.
const variant = (i: number) => ({ id: "doc-1", descarga_observado_en: `2026-10-${String(10 + i).padStart(2, "0")}T07:00:00Z`, pdf_verificacion: { bytes: 100 + i } });
const stored = () => [{ id: "doc-1", url: "https://example.test/a.pdf", descarga_observado_en: "2026-10-30T07:00:00Z", metadata_variants: Array.from({ length: 15 }, (_, i) => variant(i)) }];
const incoming = [{ id: "doc-1", url: "https://example.test/a.pdf", descarga_observado_en: "2026-11-01T07:00:00Z" }];

Deno.test("shared canonicalizer preserves merge output and reuses stored variants", () => {
  const tree = stored();
  const base = observationCanonicalizer();
  const seen = new WeakSet<object>();
  let misses = 0;
  const spy = (value: any) => {
    if (value && typeof value === "object" && !seen.has(value)) { seen.add(value); misses++; }
    return base(value);
  };
  const first = mergeActDocumentos(tree, incoming, spy);
  const afterFirst = misses;
  const second = mergeActDocumentos(tree, incoming, spy);
  assertEquals(first, mergeActDocumentos(stored(), incoming));
  assertEquals(second, first);
  for (const v of tree[0].metadata_variants) assertEquals(seen.has(v), true);
  // Only fresh per-merge copies are new on the second pass, never stored variants.
  assertEquals(misses - afterFirst < afterFirst, true);
  const now = "2026-11-01T08:00:00Z";
  assertEquals(
    documentosEnrichmentPatch(tree, null, first, null, now, spy),
    documentosEnrichmentPatch(stored(), null, mergeActDocumentos(stored(), incoming), null, now),
  );
});
