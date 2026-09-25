import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isStrictIsoDate, samaiFechaEstado, samaiFechaProvidenciaIso } from "./canonicalPublicacionMapper.ts";

const prov = (over: Record<string, unknown> = {}) => ({
  raw_data: { fecha_estado_iso: "2026-09-24", hash_documento: "abc", url_descarga: "https://x/y.pdf",
    fecha_estado_procedencia: { fuente: "SAMAI_WESTADOS", vinculo: "hash_documento" }, ...over },
});

Deno.test("strict date rejects impossible dates", () => {
  assertEquals(isStrictIsoDate("2026-02-30"), false);
  assertEquals(isStrictIsoDate("2026-13-01"), false);
  assertEquals(isStrictIsoDate("24/09/2026"), false);
  assertEquals(isStrictIsoDate(null), false);
  assertEquals(isStrictIsoDate("2028-02-29"), true);
});
Deno.test("both link methods accepted", () => {
  assertEquals(samaiFechaEstado(prov()), "2026-09-24");
  assertEquals(samaiFechaEstado(prov({ fecha_estado_procedencia: { fuente: "SAMAI_WESTADOS", vinculo: "url_descarga" } })), "2026-09-24");
});
Deno.test("malformed provenance / empty link / impossible date refused", () => {
  assertEquals(samaiFechaEstado(prov({ fecha_estado_procedencia: { fuente: "OTRA", vinculo: "hash_documento" } })), null);
  assertEquals(samaiFechaEstado(prov({ hash_documento: "" })), null);
  assertEquals(samaiFechaEstado(prov({ fecha_estado_procedencia: null })), null);
  assertEquals(samaiFechaEstado(prov({ fecha_estado_iso: "2026-02-30" })), null);
});
Deno.test("providencia only from fecha_providencia_iso", () => {
  assertEquals(samaiFechaProvidenciaIso({ fecha_providencia_iso: "2026-09-23" }), "2026-09-23");
  assertEquals(samaiFechaProvidenciaIso({ "Fecha Providencia": "23/09/2026" }), null);
});
