import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildAnexosInventario,
  extractActOrigin,
  originFromRow,
  originsConflict,
  originVersionedFingerprint,
} from "./actOriginIdentity.ts";

// Verbatim SAMAI read-api text, 05001233300020260142400 (2026-10-18 probe).
const A = "El Señor(a):JHON HERLINZON RINCON MAZABEL con vinculación al proceso: ApodDdo - Policía Nacional, a través de la ventanilla virtual, radicó la solicitud No. 3435550 tipo: Recepción de Memoriales de fecha: 16/10/2026 16:12:08, donde solicitó: Presentación de memorial o escrito Radicado: 05001233300020260142400 Vinculación: ApodDdo Documentos anexos: 6 . Se realiza la siguiente gestión: OPOSICION MEDIDA CAUTELAR - 6 archivos";
const B = "El Señor(a):ELKIN YESID SALAZAR ECHEVERRI con vinculación al proceso: ApodDdo - MUNCIPIO DE LA CEJA DEL TAMBO, a través de la ventanilla virtual, radicó la solicitud No. 3432736 tipo: Recepción de Memoriales de fecha: 16/10/2026 10:46:42, donde solicitó: Presentación de memorial o escrito Radicado: 05001233300020260142400 Vinculación: ApodDdo Documentos anexos: 2 . Se realiza la siguiente gestión: Pronunciamiento frente a la solicitud de medidas cautelares - 2 archivos";
// 05001233300020240115300
const C = "El Señor(a):OSCAR NICOLAS PEÑA RUIZ con vinculación al proceso: Ddo, a través de la ventanilla virtual, radicó la solicitud No. 3433923 tipo: Recepción de Memoriales de fecha: 16/10/2026 12:59:34, donde solicitó: Presentación de memorial o escrito Radicado: 05001233300020240115300 Vinculación: Ddo Documentos anexos: 1 . Se realiza la siguiente gestión: OposiciOn a medidas cautelares - 1 archivo";

Deno.test("origin: extracts solicitud and radicación timestamp", () => {
  const o = extractActOrigin({ anotacion: A });
  assertEquals(o.solicitud, "3435550");
  assertEquals(o.radicada_en, "16/10/2026 16:12:08");
  assertEquals(o.key, "solicitud:3435550");
});

Deno.test("origin: two memoriales same day/title are DIFFERENT acts (case 2)", () => {
  assert(originsConflict(extractActOrigin({ anotacion: A }), extractActOrigin({ anotacion: B })));
});

Deno.test("origin: same solicitud re-read is the same act", () => {
  assertEquals(originsConflict(extractActOrigin({ anotacion: A }), extractActOrigin({ anotacion: A + " " })), false);
});

Deno.test("origin: indice wins over text", () => {
  const o = extractActOrigin({ indice: 132, anotacion: C });
  assertEquals(o.key, "indice:132");
  assert(originsConflict(o, extractActOrigin({ indice: 133, anotacion: C })));
});

Deno.test("origin: unknown on one side never conflicts", () => {
  assertEquals(originsConflict(extractActOrigin({ anotacion: "Auto traslado" }), extractActOrigin({ anotacion: A })), false);
});

Deno.test("origin: stored row uses protected description, not contaminated raw anotacion", () => {
  // Real contaminated row f148bbab: description=A, raw_data.anotacion=B.
  const o = originFromRow({ description: `RECIBE MEMORIALES ONLINE - ${A}`, raw_data: { anotacion: B } });
  assertEquals(o.solicitud, "3435550");
});

Deno.test("origin: versioned fingerprint differs and is deterministic", () => {
  const o = extractActOrigin({ anotacion: B });
  const v = originVersionedFingerprint("wi_8fac310f_3ea7d5151a589063", o);
  assert(v !== "wi_8fac310f_3ea7d5151a589063");
  assertEquals(v, originVersionedFingerprint("wi_8fac310f_3ea7d5151a589063", o));
  assert(v.startsWith("wi_8fac310f_3ea7d5151a589063_o"));
});

Deno.test("inventory: announced-but-unlinked is no_consultado, never sin_anexos (case 1)", () => {
  const inv = buildAnexosInventario({ anexos: null, anotacion: C, documentos: null });
  assertEquals(inv.anunciados, 1);
  assertEquals(inv.estado, "no_consultado");
  assertEquals(inv.fuente_conteo, "texto_actuacion");
});

Deno.test("inventory: null count + no text is no_consultado, not sin_anexos", () => {
  assertEquals(buildAnexosInventario({ anexos: null, anotacion: "Auto traslado" }).estado, "no_consultado");
});

Deno.test("inventory: provider zero is sin_anexos", () => {
  assertEquals(buildAnexosInventario({ anexos: 0 }).estado, "sin_anexos");
});

Deno.test("inventory: linked descriptors are disponible with partial count", () => {
  const inv = buildAnexosInventario({ anotacion: A, documentos: [{ gcs_url: "https://storage.googleapis.com/x.pdf" }] });
  assertEquals(inv.estado, "disponible");
  assertEquals(inv.enlazados, 1);
  assertEquals(inv.anunciados, 6);
});

Deno.test("inventory: reserved and error states are explicit", () => {
  assertEquals(buildAnexosInventario({ anotacion: A, reserved: true }).estado, "restringido");
  assertEquals(buildAnexosInventario({ anotacion: A, providerError: "HTTP 500" }).estado, "error");
});

import { normalizeSamaiActuaciones } from "./providerAdapters/samaiAdapter.ts";

Deno.test("samai normalizer: null URL fields stay not-observed (no documentos key)", () => {
  const [n] = normalizeSamaiActuaciones([{ "Fecha Providencia": "2026-10-16T00:00:00.000Z", "Actuación": "RECIBE MEMORIALES ONLINE", "Docum. a notif.": A, url_descarga: null, pdf_url: null, gcs_url: null, anexos: null }]);
  assertEquals((n as any).documentos, undefined);
  assertEquals(n.anotacion, A);
});

Deno.test("samai normalizer: a real provider URL becomes a descriptor", () => {
  const [n] = normalizeSamaiActuaciones([{ "Fecha Providencia": "2026-10-16", "Actuación": "AUTO", gcs_url: "https://storage.googleapis.com/b/x.pdf" }]);
  assertEquals((n as any).documentos[0].gcs_url, "https://storage.googleapis.com/b/x.pdf");
});
