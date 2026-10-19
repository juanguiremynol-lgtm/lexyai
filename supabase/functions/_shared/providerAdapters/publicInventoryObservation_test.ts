import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { normalizeSamaiActuaciones } from './samaiAdapter.ts';
import { toOrchestratorResult } from './bridge.ts';
import { planEnrichment } from '../actOriginIdentity.ts';

Deno.test('public no-inventory evidence reaches persistence planning without rewriting act text', () => {
  const observation = { estado: 'detalle_sin_inventario', observado_en: '2026-10-19T17:00:00Z', respuesta_sha256: 'source-response-proof' };
  const annotation = 'Solicitud No. 3432736 Documentos anexos: 2';
  const result = toOrchestratorResult({ provider: 'samai', status: 'SUCCESS',
    actuaciones: normalizeSamaiActuaciones([{ categoria: 'ACTUACION', indice: '25', actuacion: 'RECIBE MEMORIALES ONLINE', anotacion: annotation, anexos: 2, anexos_observacion: observation },
      { categoria: 'ESTADO', indice: '25', actuacion: 'ESTADO', anexos_observacion: observation }]),
    publicaciones: [], metadata: null, parties: null, durationMs: 0 });
  assertEquals(result.actuaciones.length, 1);
  const incoming = result.actuaciones[0];
  assertEquals(incoming.anexos_observacion, observation);
  const row = { id: 'original-act', hash_fingerprint: 'existing-fingerprint', description: annotation, raw_data: { origen_solicitud: '3432736', indice: '25', anotacion: annotation }, documentos: [] };
  const plan = planEnrichment(row, { ...incoming, anotacion: incoming.anotacion ?? null,
    anexos: incoming.anexos, indice: incoming.indice, documentos: incoming.documentos ?? null }, 'equivalent');
  assertEquals(plan?.raw_data.anexos_observacion, observation);
  assertEquals(plan?.raw_data.anotacion, annotation);
  assertEquals(plan?.healed_contamination, false);
  assertEquals(plan?.anotacion_grew, false);
  assertEquals(plan?.event_summary, undefined);
});

Deno.test('unrecognized public observation shape is not persisted as evidence', () => {
  for (const observation of [null, 2, 'missing', []]) {
    const result = toOrchestratorResult({ provider: 'samai', status: 'SUCCESS', actuaciones: normalizeSamaiActuaciones([
      { actuacion: 'Auto', anexos_observacion: observation }]), publicaciones: [], metadata: null, parties: null, durationMs: 0 });
    assertEquals(result.actuaciones[0].anexos_observacion, undefined);
  }
});
