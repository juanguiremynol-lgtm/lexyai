import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { ActLoadError, enrichPersistedAct } from "./actBatchState.ts";
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

Deno.test("SAMAI persistence accepts the same confirmed legacy display match as the resolver", async () => {
  const incoming = {
    actuacion: "Auto que resuelve", anotacion: "Confirmación del texto oficial completo",
    anexos: 0, indice: "00012", documentos: null, fecha_registro: "2025-11-11",
  };
  const row = {
    id: "retained", source: "samai", hash_fingerprint: "v1", semantic_key: "same",
    description: "Auto que resuelve - Confirmación del texto…", fecha_registro_source: null,
    raw_data: { actuacion: incoming.actuacion, anotacion: incoming.anotacion },
  };
  const match = resolveActIdentity({
    v1: "v1", semanticKey: "same", provider: row.source, rows: [row],
    incoming: extractActOrigin(incoming), evidence: `${incoming.actuacion} - ${incoming.anotacion}`,
  });
  assertEquals(match.kind === "match" && match.relation, "indeterminate");

  let current = row;
  const writes: Record<string, unknown>[] = [];
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => Promise.resolve({ data: current, error: null }),
  };
  const client = {
    from: () => query,
    rpc: (_name: string, args: { p_patch: Record<string, unknown> }) => ({
      select: () => {
        writes.push(args.p_patch);
        current = { ...current, ...args.p_patch };
        return Promise.resolve({ data: [current], error: null });
      },
    }),
  };
  // A freshly changed full text must stop the write even if the display still matches.
  current = { ...row, raw_data: { ...row.raw_data, anotacion: "Confirmación del texto distinto" } };
  await assertRejects(() => enrichPersistedAct(client, "work-item", row.id, incoming),
    ActLoadError, "unconfirmed source text changed");
  assertEquals(writes.length, 0);

  current = row;
  const persisted = await enrichPersistedAct(client, "work-item", row.id, incoming);
  assertEquals(persisted.id, row.id);
  assertEquals(persisted.hash_fingerprint, row.hash_fingerprint);
  assertEquals(persisted.description, row.description);
  assertEquals(persisted.fecha_registro_source, incoming.fecha_registro);
  assertEquals(writes.length, 1);
});
