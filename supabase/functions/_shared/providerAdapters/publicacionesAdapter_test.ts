/**
 * publicacionesAdapter_test.ts — Unit tests for Publicaciones adapter normalization.
 */
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizePublicacionesResponse,
  computePublicacionFingerprint,
  extractDateFromTitle,
} from './publicacionesAdapter.ts';

// ── Date extraction from titles ──

Deno.test("extractDateFromTitle: YYYYMMDD.pdf format", () => {
  assertEquals(extractDateFromTitle("003Estados20260122.pdf"), "2026-01-22");
});

Deno.test("extractDateFromTitle: Spanish month format", () => {
  assertEquals(extractDateFromTitle("REGISTRO 1 DE JULIO DE 2024.pdf"), "2024-07-01");
});

Deno.test("extractDateFromTitle: DD/MM/YYYY format", () => {
  assertEquals(extractDateFromTitle("Estado del 22/01/2026"), "2026-01-22");
});

Deno.test("extractDateFromTitle: no date returns undefined", () => {
  assertEquals(extractDateFromTitle("Some random title"), undefined);
});

// ── Normalization ──

Deno.test("normalizePublicacionesResponse: extracts publications from v3 response", () => {
  const data = {
    found: true,
    publicaciones: [
      {
        key: "pub-1",
        titulo: "Estado Electrónico 2025-01-15",
        tipo_evento: "Estado Electrónico",
        fecha_publicacion: "2025-01-15",
        asset_id: "asset-001",
        pdf_url: "https://example.com/doc.pdf",
      },
      {
        key: "pub-2",
        titulo: "Edicto 2025-02-01",
        fecha_publicacion: "2025-02-01",
      },
    ],
  };

  const result = normalizePublicacionesResponse(data, { workItemId: 'wi-123' });
  assertEquals(result.length, 2);
  assertEquals(result[0].tipo_publicacion, "Estado Electrónico");
  assertEquals(result[0].fecha_fijacion, "2025-01-15");
  assertEquals(result[0].source_platform, "publicaciones");
  assertEquals(result[0].sources, ["publicaciones"]);
  assertExists(result[0].hash_fingerprint);
});

Deno.test("normalizePublicacionesResponse: infers type from title", () => {
  const data = {
    found: true,
    publicaciones: [
      { titulo: "EDICTO publicado 2025-03-01", fecha_publicacion: "2025-03-01" },
    ],
  };
  const result = normalizePublicacionesResponse(data);
  assertEquals(result[0].tipo_publicacion, "Edicto");
});

Deno.test("normalizePublicacionesResponse: extracts date from title when fecha is missing", () => {
  const data = {
    publicaciones: [
      { titulo: "003Estados20260122.pdf", tipo_evento: "Estado Electrónico" },
    ],
  };
  const result = normalizePublicacionesResponse(data);
  assertEquals(result.length, 1);
  assertEquals(result[0].fecha_fijacion, "2026-01-22");
});

Deno.test("normalizePublicacionesResponse: empty response", () => {
  assertEquals(normalizePublicacionesResponse({ found: false, publicaciones: [] }).length, 0);
  assertEquals(normalizePublicacionesResponse({}).length, 0);
});

Deno.test("normalizePublicacionesResponse: extracts PDF attachments", () => {
  const data = {
    publicaciones: [
      {
        titulo: "Estado 2025-01-01",
        fecha_publicacion: "2025-01-01",
        pdf_url: "https://example.com/estado.pdf",
        url: "https://example.com/page",
      },
    ],
  };
  const result = normalizePublicacionesResponse(data);
  assertEquals(result[0].attachments?.length, 2);
  assertEquals(result[0].attachments![0].type, "pdf");
  assertEquals(result[0].attachments![1].type, "link");
});

// ── Fingerprinting ──

Deno.test("computePublicacionFingerprint: deterministic", () => {
  const fp1 = computePublicacionFingerprint("wi-1", "asset-001", "key-1", "Title");
  const fp2 = computePublicacionFingerprint("wi-1", "asset-001", "key-1", "Title");
  assertEquals(fp1, fp2);
});

Deno.test("computePublicacionFingerprint: different assets produce different fingerprints", () => {
  const fp1 = computePublicacionFingerprint("wi-1", "asset-001", undefined, "Title");
  const fp2 = computePublicacionFingerprint("wi-1", "asset-002", undefined, "Title");
  assertEquals(fp1 !== fp2, true);
});

Deno.test("computePublicacionFingerprint: cross-provider mode", () => {
  const fp = computePublicacionFingerprint("wi-1", "asset-001", undefined, "Title", true);
  assertEquals(fp.startsWith("pub_x_"), true);
});
