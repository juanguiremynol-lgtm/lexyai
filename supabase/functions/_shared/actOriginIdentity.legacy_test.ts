import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { extractActOrigin, resolveActIdentity } from "./actOriginIdentity.ts";

Deno.test("legacy SAMAI display truncation requires exact retained evidence; positions stay scoped", () => {
  const evidence = "Recibo de memorial - CONTESTACION DEMANDA Y LLAMAMIENTO EN GARANTIA";
  const legacy = { id: "retained", source: "samai", hash_fingerprint: "v1", semantic_key: "same", description: "Recibo de memorial - CONTESTACION DEMANDA Y LLAMAMIENTO...",
    raw_data: { actuacion: "Recibo de memorial", anotacion: "CONTESTACION DEMANDA Y LLAMAMIENTO EN GARANTIA" } };
  const input = { v1: "v1", semanticKey: "same", provider: "samai", incoming: extractActOrigin({ indice: "50" }), evidence, rows: [legacy] };
  assertEquals(resolveActIdentity(input).kind, "match");
  // A contaminated raw annotation must not override the protected description.
  assertEquals(resolveActIdentity({ ...input, rows: [{ ...legacy, description: "Recibo de memorial - OTRA PARTE..." }] }).kind, "insert");
  // A display prefix alone is insufficient: retained full content must agree.
  assertEquals(resolveActIdentity({ ...input, rows: [{ ...legacy, raw_data: { ...legacy.raw_data, anotacion: "CONTESTACION DEMANDA Y LLAMAMIENTO DIFERENTE" } }] }).kind, "insert");
  // A request survives a corrected event date when filing identity AND full
  // retained source text agree, even though its display text was shortened.
  const text = "MEMORIAL - Radicó la solicitud No. 1557739 de fecha: 01/04/2025 16:34:05";
  const stable = { ...legacy, semantic_key: "old-date", description: "MEMORIAL - Radicó la solicitud...", raw_data: { actuacion: "MEMORIAL", anotacion: text.slice(11), origen_solicitud: "1557739", origen_radicada_en: "01/04/2025 16:34:05" } };
  const d = resolveActIdentity({ ...input, v1: "new-date-v1", semanticKey: "new-date", incoming: extractActOrigin({ indice: "42", anotacion: text }), evidence: text, rows: [stable] });
  assertEquals(d.kind === "match" && d.row.id, "retained");
  // SAMAI positions can be reassigned between snapshots, unlike CPNU ids.
  assertEquals(resolveActIdentity({ ...input, v1: "other-v1", semanticKey: "other-date", evidence: "Otro auto", rows: [{ ...legacy, raw_data: { ...legacy.raw_data, origen_indice: "50" } }] }).kind, "insert");
});
