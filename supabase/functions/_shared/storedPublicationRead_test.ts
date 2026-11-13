import { strict as assert } from 'node:assert';
import { certifiedStoredPPHistory, storedReadEvidence } from './storedPublicationRead.ts';

Deno.test('only an identified, complete, persisted recent daily window certifies current PP coverage', () => {
  const radicado = '05001400300120250012300';
  const backend_run_id = 'f5c1fa1d-a06f-439d-a947-959bc2c2f68d';
  const now = Date.parse('2026-11-06T15:00:00Z');
  const body = { backend_run_id, radicado, run_status: 'SUCCESS_WITH_DATA',
    consulta_completa: true, persistencia_completa: true, intento_observado_en: '2026-11-06T13:01:57Z',
    ventana_solicitada: { desde: '2026-10-23', hasta: '2026-11-06' } };
  const candidate = (change: Record<string, unknown> = {}) => ({ ok: true, historicoRead: { body: { ...body, ...change } } });
  assert.deepEqual(certifiedStoredPPHistory(candidate(), radicado, '2026-11-06', now), body);
  for (const change of [
    { ventana_solicitada: { desde: '2026-03-12', hasta: '2026-03-12' } },
    { ventana_solicitada: { desde: '2026-10-24', hasta: '2026-11-06' } },
    { consulta_completa: false }, { persistencia_completa: false },
    { radicado: '05001400300120250012301' },
    { intento_observado_en: '2026-11-05T13:01:57Z' },
  ]) assert.equal(certifiedStoredPPHistory(candidate(change), radicado, '2026-11-06', now), null);
});

Deno.test('partial PP reads retain scoped diagnostics, bound native IDs and never source texts', () => {
  const run_id = 'f5c1fa1d-a06f-439d-a947-959bc2c2f68d';
  const radicado = '05001400300120250012300';
  const runStatusRead = { run_id, polled_at: '2026-11-13T14:00:00Z', http_status: 200,
    body: { backend_run_id: run_id, radicado, motivo_parcial: 'FECHA_PLANILLA_CONTRADICTORIA',
      estado: 'PARCIAL', persistencia_completa: false, eventos_detectados: 0,
      checkpoint: { desde: '2026-11-01', hasta: '2026-11-13', articulos_en_progreso: 0, privado: 'secreto' },
      publication_dates_requiring_revalidation: ['501', '502', '501'],
      publication_metadata_observations: Array.from({length: 25}, (_, i) => ({article_id: i+100, details: 'secreto'})),
      publication_variant_negative_evidence: [{article_id:'bad-id', url:'secreto'}] } };
  const read = storedReadEvidence({runStatusRead}, radicado);
  assert.ok('checkpoint' in read);
  assert.equal(read.status, 'PARCIAL'); assert.equal(read.persistence_complete,false);
  assert.equal(read.checkpoint.processing_articles,0); assert.equal(read.detected_events,0);
  assert.deepEqual(read.date_revalidation,{count:3, article_ids:['501','502'],ids_truncated:false});
  assert.equal(read.metadata_observations?.article_ids.length,20);assert.equal(read.metadata_observations?.ids_truncated,true);
  assert.deepEqual(read.negative_variants?.article_ids,[]);
  assert.ok(!JSON.stringify(read).includes('secreto'));
  const foreign = storedReadEvidence({runStatusRead}, radicado.slice(0,-1)+'1');
  assert.equal(foreign.identity_match,false); assert.ok(!('checkpoint' in foreign));
  const unavailable = storedReadEvidence({runStatusRead:{...runStatusRead,body:null,http_status:null}},radicado);
  assert.equal(unavailable.backend_run_id,run_id); assert.equal(unavailable.http_status,null);
  assert.equal(unavailable.identity_match,false);
});
