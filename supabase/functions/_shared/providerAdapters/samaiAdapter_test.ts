/**
 * samaiAdapter_test.ts — Unit tests for SAMAI adapter normalization and helpers.
 */

import { assertEquals, assertExists } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  normalizeSamaiActuaciones,
  computeSamaiFingerprint,
  extractSamaiParties,
  extractSamaiMetadata,
} from './samaiAdapter.ts';

// ─────────────── normalizeSamaiActuaciones ───────────────

Deno.test('normalizeSamaiActuaciones: maps SAMAI field names correctly', () => {
  const raw = [
    {
      fechaActuacion: '2024-03-15',
      actuacion: 'Auto admisorio',
      anotacion: 'Se admite la demanda',
      fechaRegistro: '2024-03-16',
      estado: 'Firmado',
      anexos: 3,
      indice: '001',
    },
  ];

  const result = normalizeSamaiActuaciones(raw);
  assertEquals(result.length, 1);
  assertEquals(result[0].fecha_actuacion, '2024-03-15');
  assertEquals(result[0].actuacion, 'Auto admisorio');
  assertEquals(result[0].anotacion, 'Se admite la demanda');
  assertEquals(result[0].source_platform, 'samai');
  assertEquals(result[0].sources, ['samai']);
  assertEquals(result[0].fecha_registro, '2024-03-16');
  assertEquals(result[0].estado, 'Firmado');
  assertEquals(result[0].anexos_count, 3);
  assertEquals(result[0].indice, '001');
  assertExists(result[0].hash_fingerprint);
});

Deno.test('normalizeSamaiActuaciones: handles alternative field names', () => {
  const raw = [
    {
      fecha_actuacion: '2024-01-10',
      tipo_actuacion: 'Sentencia',
      descripcion: 'Se profiere sentencia',
    },
  ];

  const result = normalizeSamaiActuaciones(raw);
  assertEquals(result[0].fecha_actuacion, '2024-01-10');
  assertEquals(result[0].actuacion, 'Sentencia');
  assertEquals(result[0].anotacion, 'Se profiere sentencia');
});

Deno.test('normalizeSamaiActuaciones: empty input returns empty array', () => {
  assertEquals(normalizeSamaiActuaciones([]).length, 0);
});

// ─────────────── computeSamaiFingerprint ───────────────

Deno.test('computeSamaiFingerprint: deterministic output', () => {
  const a = computeSamaiFingerprint('2024-03-15', 'Auto', 'Desc');
  const b = computeSamaiFingerprint('2024-03-15', 'Auto', 'Desc');
  assertEquals(a, b);
});

Deno.test('computeSamaiFingerprint: different inputs produce different hashes', () => {
  const a = computeSamaiFingerprint('2024-03-15', 'Auto', 'Desc');
  const b = computeSamaiFingerprint('2024-03-16', 'Auto', 'Desc');
  if (a === b) throw new Error('Expected different fingerprints');
});

Deno.test('computeSamaiFingerprint: cross-provider dedup omits provider prefix', () => {
  const normal = computeSamaiFingerprint('2024-01-01', 'Test', null);
  const cross = computeSamaiFingerprint('2024-01-01', 'Test', null, { crossProviderDedup: true });
  assertEquals(normal.startsWith('samai:'), true);
  assertEquals(cross.startsWith('samai:'), false);
});

Deno.test('computeSamaiFingerprint: workItemId scoping', () => {
  const fp = computeSamaiFingerprint('2024-01-01', 'Test', null, { workItemId: 'wi-123' });
  assertEquals(fp.includes('wi:wi-123:'), true);
});

// ─────────────── extractSamaiParties ───────────────

Deno.test('extractSamaiParties: extracts demandante and demandado', () => {
  const sujetos = [
    { tipo: 'Demandante', nombre: 'JUAN PEREZ' },
    { tipo: 'Demandado', nombre: 'EMPRESA S.A.' },
    { tipo: 'Ministerio Público', nombre: 'PROCURADURIA' },
  ];

  const result = extractSamaiParties(sujetos);
  assertEquals(result.demandante, 'JUAN PEREZ');
  assertEquals(result.demandado, 'EMPRESA S.A');
  assertExists(result.sujetos_procesales);
  assertEquals(result.sujetos_procesales!.length, 3);
});

Deno.test('extractSamaiParties: handles accionante/accionado roles', () => {
  const sujetos = [
    { tipo: 'Accionante', nombre: 'MARIA GARCIA' },
    { tipo: 'Accionado', nombre: 'GOBIERNO' },
  ];

  const result = extractSamaiParties(sujetos);
  assertEquals(result.demandante, 'MARIA GARCIA');
  assertEquals(result.demandado, 'GOBIERNO');
});

Deno.test('extractSamaiParties: empty sujetos returns null', () => {
  const result = extractSamaiParties([]);
  assertEquals(result.demandante, null);
  assertEquals(result.demandado, null);
});

// ─────────────── extractSamaiMetadata ───────────────

Deno.test('extractSamaiMetadata: extracts core fields', () => {
  const data: Record<string, unknown> = {
    corporacionNombre: 'Juzgado 1 Civil',
    ciudad: 'Bogotá',
    departamento: 'Cundinamarca',
    ponente: 'Dr. García',
    etapa: 'Pruebas',
    clasificacion: { tipoProceso: 'Ejecutivo', clase: 'Civil' },
    fechas: { radicado: '2024-01-15' },
  };

  const result = extractSamaiMetadata(data, []);
  assertEquals(result.despacho, 'Juzgado 1 Civil');
  assertEquals(result.ciudad, 'Bogotá');
  assertEquals(result.ponente, 'Dr. García');
  assertEquals(result.tipo_proceso, 'Ejecutivo');
  assertEquals(result.fecha_radicacion, '2024-01-15');
});

Deno.test('extractSamaiMetadata: extracts ministerio publico from sujetos', () => {
  const sujetos = [
    { tipo: 'Ministerio Público', nombre: 'PROCURADURIA GENERAL' },
  ];

  const result = extractSamaiMetadata({}, sujetos);
  assertEquals(result.ministerio_publico, 'PROCURADURIA GENERAL');
});
