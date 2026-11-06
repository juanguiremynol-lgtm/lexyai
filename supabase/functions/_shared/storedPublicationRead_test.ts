import { strict as assert } from 'node:assert';
import { certifiedStoredPPHistory } from './storedPublicationRead.ts';

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
