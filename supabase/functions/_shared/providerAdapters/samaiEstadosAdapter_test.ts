/**
 * samaiEstadosAdapter_test.ts — Unit tests for SAMAI Estados adapter.
 */
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeSamaiEstadosResponse,
  formatRadicadoForSamai,
  computeSamaiEstadosFingerprint,
} from './samaiEstadosAdapter.ts';

// ── Radicado formatting ──

Deno.test("formatRadicadoForSamai: formats 23-digit radicado", () => {
  assertEquals(
    formatRadicadoForSamai("11001310300520230012300"),
    "11-001-31-03-005-2023-00123-00",
  );
});

Deno.test("formatRadicadoForSamai: passthrough for non-23 digit", () => {
  assertEquals(formatRadicadoForSamai("12345"), "12345");
});

// ── Normalization ──

Deno.test("normalizeSamaiEstadosResponse: extracts estados", () => {
  const data = {
    result: {
      estados: [
        {
          "Fecha Providencia": "2025-01-15",
          "Actuación": "Auto que admite demanda",
          "Anotación": "Se admite la demanda presentada",
        },
        {
          fechaEstado: "2025-02-01",
          actuacion: "Traslado",
          anotacion: "Se corre traslado por 10 días",
        },
      ],
    },
  };

  const result = normalizeSamaiEstadosResponse(data, { workItemId: 'wi-test' });
  assertEquals(result.length, 2);
  assertEquals(result[0].tipo_publicacion, "Auto que admite demanda");
  assertEquals(result[0].fecha_fijacion, "2025-01-15");
  assertEquals(result[0].source_platform, "samai_estados");
  assertEquals(result[0].sources, ["samai_estados"]);
  assertExists(result[0].hash_fingerprint);
});

Deno.test("normalizeSamaiEstadosResponse: handles empty response", () => {
  assertEquals(normalizeSamaiEstadosResponse({}).length, 0);
  assertEquals(normalizeSamaiEstadosResponse({ result: { estados: [] } }).length, 0);
});

Deno.test("normalizeSamaiEstadosResponse: extracts PDF attachments", () => {
  const data = {
    estados: [
      {
        fecha: "2025-01-01",
        actuacion: "Auto",
        Documento: "https://example.com/auto.pdf",
      },
    ],
  };
  const result = normalizeSamaiEstadosResponse(data);
  assertEquals(result[0].attachments?.length, 1);
  assertEquals(result[0].attachments![0].type, "pdf");
});

// ── Fingerprinting ──

Deno.test("computeSamaiEstadosFingerprint: deterministic", () => {
  const fp1 = computeSamaiEstadosFingerprint("2025-01-15", "Auto", "Nota", "wi-1");
  const fp2 = computeSamaiEstadosFingerprint("2025-01-15", "Auto", "Nota", "wi-1");
  assertEquals(fp1, fp2);
});

Deno.test("computeSamaiEstadosFingerprint: cross-provider mode uses 'x' scope", () => {
  const fp = computeSamaiEstadosFingerprint("2025-01-15", "Auto", "Nota", "wi-1", true);
  assertEquals(fp.startsWith("se_x_"), true);
});
