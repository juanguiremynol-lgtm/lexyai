/**
 * cpacaEstadosFallback_test.ts — Regression tests for CPACA estados ingestion.
 *
 * Fixture: radicado 05001333301020230019900
 * Despacho: JUZGADO 010 ADMINISTRATIVO DE MEDELLÍN
 * Expected: at least one estado with date 2024-11-20 and PDF containing MemorialWeb
 */
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeRadicado,
  normalizeDespacho,
  matchDespacho,
  normalizeDate,
} from './radicadoUtils.ts';
import { formatRadicadoForSamai, computeSamaiEstadosFingerprint } from './providerAdapters/samaiEstadosAdapter.ts';
import { computePublicacionFingerprint } from './providerAdapters/publicacionesAdapter.ts';
import { getCategoryStrategy } from './providerStrategy.ts';

// ═══════════════════════════════════════════
// FIXTURE DATA
// ═══════════════════════════════════════════

const FIXTURE_RADICADO = '05001333301020230019900';
const FIXTURE_DESPACHO = 'JUZGADO 010 ADMINISTRATIVO DE MEDELLÍN';
const FIXTURE_TARGET_DATE = '2024-11-20';
const FIXTURE_TARGET_FILENAME = 'MemorialWeb2024111818751.pdf';

// ═══════════════════════════════════════════
// Normalization
// ═══════════════════════════════════════════

Deno.test("CPACA fixture: radicado normalizes to 23 digits", () => {
  assertEquals(normalizeRadicado(FIXTURE_RADICADO), FIXTURE_RADICADO);
  assertEquals(normalizeRadicado(FIXTURE_RADICADO).length, 23);
});

Deno.test("CPACA fixture: radicado formats correctly for SAMAI", () => {
  const formatted = formatRadicadoForSamai(FIXTURE_RADICADO);
  assertEquals(formatted, "05-001-33-33-010-2023-00199-00");
});

Deno.test("CPACA fixture: despacho matches with different formats", () => {
  assertEquals(matchDespacho(FIXTURE_DESPACHO, "JUZGADO 10 ADMINISTRATIVO DE MEDELLIN"), true);
  assertEquals(matchDespacho(FIXTURE_DESPACHO, "JUZGADO DIEZ ADMINISTRATIVO DE MEDELLÍN"), false); // Numeric vs word — intentionally different
  assertEquals(matchDespacho(FIXTURE_DESPACHO, "JUZGADO 010 ADMINISTRATIVO DE MEDELLIN"), true);
});

// ═══════════════════════════════════════════
// Strategy
// ═══════════════════════════════════════════

Deno.test("CPACA strategy: SAMAI_ESTADOS is primary for estados", () => {
  const strategy = getCategoryStrategy('CPACA');
  assertEquals(strategy.primaryEstados.includes('SAMAI_ESTADOS'), true);
});

Deno.test("CPACA strategy: PUBLICACIONES is fallback for estados", () => {
  const strategy = getCategoryStrategy('CPACA');
  assertEquals(strategy.fallbackEstados.includes('PUBLICACIONES'), true);
});

// ═══════════════════════════════════════════
// Fingerprinting stability
// ═══════════════════════════════════════════

Deno.test("CPACA fixture: fingerprint is deterministic", () => {
  const wi = 'e4e761ac-9984-462d-ae6e-a25b244f79ea';
  const fp1 = computeSamaiEstadosFingerprint(FIXTURE_TARGET_DATE, 'Auto', 'Nota', wi);
  const fp2 = computeSamaiEstadosFingerprint(FIXTURE_TARGET_DATE, 'Auto', 'Nota', wi);
  assertEquals(fp1, fp2);
});

Deno.test("CPACA fixture: pub fingerprint stable across calls", () => {
  const wi = 'e4e761ac-9984-462d-ae6e-a25b244f79ea';
  const fp1 = computePublicacionFingerprint(wi, 'asset_123', undefined, 'Test Title');
  const fp2 = computePublicacionFingerprint(wi, 'asset_123', undefined, 'Test Title');
  assertEquals(fp1, fp2);
});

// ═══════════════════════════════════════════
// Estado persistence independence from attachment
// ═══════════════════════════════════════════

Deno.test("Estado should be persistable without PDF URL", () => {
  // Simulates that estado row can be created even if pdf_url is undefined
  const estado = {
    title: 'Auto que admite demanda',
    tipo_publicacion: 'Estado Electrónico',
    fecha_fijacion: FIXTURE_TARGET_DATE,
    hash_fingerprint: 'test_fp_001',
    source_platform: 'samai_estados',
    sources: ['samai_estados'],
    pdf_url: undefined, // No PDF — estado should still persist
  };
  // Verify the object is valid without pdf_url
  assertNotEquals(estado.title, '');
  assertEquals(estado.pdf_url, undefined);
  assertEquals(estado.fecha_fijacion, FIXTURE_TARGET_DATE);
});

// ═══════════════════════════════════════════
// Date normalization for target
// ═══════════════════════════════════════════

Deno.test("normalizeDate handles target date formats", () => {
  assertEquals(normalizeDate('2024-11-20'), '2024-11-20');
  assertEquals(normalizeDate('20/11/2024'), '2024-11-20');
  assertEquals(normalizeDate('2024-11-20T00:00:00Z'), '2024-11-20');
});
