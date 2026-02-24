/**
 * cpnuAdapter_dedup_test.ts — Tests for strengthened dedup logic.
 *
 * Validates that:
 * 1. Two actuaciones with same fecha_registro but different fecha_actuacion both persist
 * 2. Two actuaciones with same fecha_actuacion+title but different anotacion both persist
 * 3. Re-running normalization produces identical fingerprints (idempotent)
 * 4. Records with different instancia produce different fingerprints
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  normalizeCpnuActuaciones,
  computeCpnuFingerprint,
} from "./cpnuAdapter.ts";

// ═══════════════════════════════════════════
// Test: Same fecha_registro, different fecha_actuacion → distinct fingerprints
// ═══════════════════════════════════════════

Deno.test("dedup: same fecha_registro but different fecha_actuacion → distinct fingerprints", () => {
  const rawActs = [
    {
      fechaActuacion: "2026-02-20",
      actuacion: "FIJACION ESTADO",
      anotacion: "",
      fechaRegistro: "2026-02-19",
      instancia: "00",
      fechaInicial: "2026-02-20",
    },
    {
      fechaActuacion: "2026-02-19",
      actuacion: "AUTO PONE EN CONOCIMIENTO",
      anotacion: "CORRE TRASLADO EXCEPCIONES",
      fechaRegistro: "2026-02-19",
      instancia: "00",
    },
  ];

  const result = normalizeCpnuActuaciones(
    rawActs as any,
    "05088400300520230119400",
    "Juzgado 005 Civil Municipal de Bello",
  );

  assertEquals(result.length, 2);
  // Fingerprints must be different
  const fp1 = result[0].hash_fingerprint;
  const fp2 = result[1].hash_fingerprint;
  if (fp1 === fp2) {
    throw new Error(`DEDUP COLLISION: Both actuaciones produced same fingerprint ${fp1}`);
  }
});

// ═══════════════════════════════════════════
// Test: Same date+title, different anotacion → distinct fingerprints
// ═══════════════════════════════════════════

Deno.test("dedup: same date+title but different anotacion → distinct fingerprints", () => {
  const fp1 = computeCpnuFingerprint(
    "05088400300520230119400", "2026-02-20", "FIJACION ESTADO", "Juzgado",
    undefined, false, "2026-02-20", "", "00",
  );
  const fp2 = computeCpnuFingerprint(
    "05088400300520230119400", "2026-02-20", "FIJACION ESTADO", "Juzgado",
    undefined, false, "2026-02-20", "Alguna anotación diferente", "00",
  );
  if (fp1 === fp2) {
    throw new Error(`DEDUP COLLISION: Same date+title with different anotacion produced same fingerprint`);
  }
});

// ═══════════════════════════════════════════
// Test: Idempotency — re-running produces identical fingerprints
// ═══════════════════════════════════════════

Deno.test("dedup: idempotency — same input produces same fingerprint", () => {
  const rawActs = [
    {
      fechaActuacion: "2026-02-20",
      actuacion: "FIJACION ESTADO",
      anotacion: "",
      fechaRegistro: "2026-02-19",
      instancia: "00",
    },
  ];

  const result1 = normalizeCpnuActuaciones(rawActs as any, "05088400300520230119400", "Juzgado");
  const result2 = normalizeCpnuActuaciones(rawActs as any, "05088400300520230119400", "Juzgado");

  assertEquals(result1[0].hash_fingerprint, result2[0].hash_fingerprint);
});

// ═══════════════════════════════════════════
// Test: Different instancia → different fingerprints
// ═══════════════════════════════════════════

Deno.test("dedup: different instancia → different fingerprints", () => {
  const fp1 = computeCpnuFingerprint(
    "05088400300520230119400", "2026-02-20", "AUTO", "Juzgado",
    undefined, false, "2026-02-20", "", "00",
  );
  const fp2 = computeCpnuFingerprint(
    "05088400300520230119400", "2026-02-20", "AUTO", "Juzgado",
    undefined, false, "2026-02-20", "", "01",
  );
  if (fp1 === fp2) {
    throw new Error(`DEDUP COLLISION: Different instancia produced same fingerprint`);
  }
});

// ═══════════════════════════════════════════
// Test: inicia_termino is preserved in normalization
// ═══════════════════════════════════════════

Deno.test("dedup: inicia_termino is preserved in normalized output", () => {
  const rawActs = [
    {
      fechaActuacion: "2026-02-20",
      actuacion: "FIJACION ESTADO",
      anotacion: "",
      fechaRegistro: "2026-02-19",
      fechaInicial: "2026-02-20",
      instancia: "00",
    },
    {
      fechaActuacion: "2026-02-19",
      actuacion: "AUTO PONE EN CONOCIMIENTO",
      anotacion: "CORRE TRASLADO EXCEPCIONES",
      fechaRegistro: "2026-02-19",
      instancia: "00",
      // No fechaInicial — inicia_termino should be undefined
    },
  ];

  const result = normalizeCpnuActuaciones(rawActs as any, "05088400300520230119400", "Juzgado");

  assertEquals(result[0].fecha_inicia_termino, "2026-02-20");
  assertEquals(result[1].fecha_inicia_termino, undefined);
});

// ═══════════════════════════════════════════
// Test: instancia is preserved in normalized output
// ═══════════════════════════════════════════

Deno.test("dedup: instancia is preserved in normalized output", () => {
  const rawActs = [
    {
      fechaActuacion: "2026-02-20",
      actuacion: "FIJACION ESTADO",
      anotacion: "",
      instancia: "00",
    },
  ];

  const result = normalizeCpnuActuaciones(rawActs as any, "05088400300520230119400", "Juzgado");
  assertEquals(result[0].instancia, "00");
});
