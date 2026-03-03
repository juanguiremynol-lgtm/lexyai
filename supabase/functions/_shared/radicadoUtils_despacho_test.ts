/**
 * radicadoUtils_despacho_test.ts — Tests for normalizeDespacho and CPACA estados diagnostics.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeDespacho,
  matchDespacho,
  normalizeRadicado,
} from './radicadoUtils.ts';

// ═══════════════════════════════════════════
// normalizeDespacho
// ═══════════════════════════════════════════

Deno.test("normalizeDespacho: handles numeric court index equivalence", () => {
  assertEquals(
    normalizeDespacho("JUZGADO 010 ADMINISTRATIVO DE MEDELLÍN"),
    "JUZGADO 10 ADMINISTRATIVO MEDELLIN",
  );
});

Deno.test("normalizeDespacho: removes diacritics", () => {
  const result = normalizeDespacho("JUZGADO DÉCIMO ADMINISTRATIVO DE MEDELLÍN");
  assertEquals(result.includes("MEDELLIN"), true);
  assertEquals(result.includes("DECIMO"), true);
});

Deno.test("normalizeDespacho: collapses whitespace", () => {
  assertEquals(
    normalizeDespacho("  JUZGADO   010    ADMINISTRATIVO  "),
    "JUZGADO 10 ADMINISTRATIVO",
  );
});

Deno.test("normalizeDespacho: handles empty input", () => {
  assertEquals(normalizeDespacho(""), "");
  assertEquals(normalizeDespacho(undefined as any), "");
});

// ═══════════════════════════════════════════
// matchDespacho
// ═══════════════════════════════════════════

Deno.test("matchDespacho: matches '010' vs '10'", () => {
  assertEquals(
    matchDespacho(
      "JUZGADO 010 ADMINISTRATIVO DE MEDELLÍN",
      "JUZGADO 10 ADMINISTRATIVO DE MEDELLIN",
    ),
    true,
  );
});

Deno.test("matchDespacho: matches different accent forms", () => {
  assertEquals(
    matchDespacho(
      "JUZGADO DIEZ ADMINISTRATIVO DE MEDELLÍN",
      "JUZGADO DIEZ ADMINISTRATIVO DE MEDELLIN",
    ),
    true,
  );
});

Deno.test("matchDespacho: does not match different courts", () => {
  assertEquals(
    matchDespacho(
      "JUZGADO 10 ADMINISTRATIVO DE MEDELLÍN",
      "JUZGADO 11 ADMINISTRATIVO DE MEDELLÍN",
    ),
    false,
  );
});

// ═══════════════════════════════════════════
// Fixture radicado normalization
// ═══════════════════════════════════════════

Deno.test("normalizeRadicado: fixture radicado returns exact 23 digits", () => {
  assertEquals(
    normalizeRadicado("05001333301020230019900"),
    "05001333301020230019900",
  );
  assertEquals(normalizeRadicado("05001333301020230019900").length, 23);
});

Deno.test("normalizeRadicado: formatted fixture produces same digits", () => {
  assertEquals(
    normalizeRadicado("05-001-33-33-010-2023-00199-00"),
    "05001333301020230019900",
  );
});
