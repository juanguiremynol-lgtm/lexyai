import { strict as assert } from 'node:assert';
import { mayConsumeStoredCpnu, mayConsumeStoredSamai } from './storedActAdmission.ts';
import { continuationProviders, samaiContinuationProviders } from './dailyUpdateGate.ts';
import { assessSamaiFeed } from './samaiFeedFreshness.ts';

Deno.test('terminal acts admissions may ingest only CPNU stored results; active and administrative reads remain fenced', () => {
  for (const status of ['DONE','PARTIAL','FAILED','PENDING_UPSTREAM']) {
    const a={admitted:false,reason:'DAILY_UPDATE_ALREADY_STARTED',existing:{status}};
    assert.equal(mayConsumeStoredCpnu(a,'CGP'),true);
    assert.equal(mayConsumeStoredCpnu(a,'CPACA'),false);
  }
  assert.equal(mayConsumeStoredCpnu({admitted:false,reason:'DAILY_UPDATE_ALREADY_STARTED',existing:{status:'STARTED'}},'CGP'),false);
  assert.equal(mayConsumeStoredCpnu({admitted:false,reason:'DAILY_ADMISSION_UNAVAILABLE',existing:{status:'DONE'}},'CGP'),false);
  assert.deepEqual([...continuationProviders(new Set(['samai','cpnu','external']))],['cpnu']);
  assert.deepEqual([...continuationProviders(new Set(['samai','external']))],[]);
});

Deno.test('terminal acts admissions may ingest only SAMAI stored reads for SAMAI-primary workflows', () => {
  for (const status of ['DONE','PARTIAL','FAILED','PENDING_UPSTREAM']) {
    const a={admitted:false,reason:'DAILY_UPDATE_ALREADY_STARTED',existing:{status}};
    assert.equal(mayConsumeStoredSamai(a,'CPACA'),true);
    assert.equal(mayConsumeStoredSamai(a,'CGP'),false);
  }
  assert.equal(mayConsumeStoredSamai({admitted:false,reason:'DAILY_UPDATE_ALREADY_STARTED',existing:{status:'STARTED'}},'CPACA'),false);
  assert.equal(mayConsumeStoredSamai({admitted:false,reason:'DAILY_ADMISSION_UNAVAILABLE',existing:{status:'DONE'}},'CPACA'),false);
  assert.deepEqual([...samaiContinuationProviders(new Set(['samai','cpnu','external']))],['samai']);
  assert.deepEqual([...samaiContinuationProviders(new Set(['cpnu','external']))],[]);
});

const radicado = '05001233300020240115300';
function certifiedFeed(observed: string, expediente: Record<string, unknown> = {}) {
  return {
    radicado, actuaciones: [{ actuacion: 'Auto', fechaActuacion: '2026-11-04' }], total_found: 1,
    fuentes_frescura: { expediente: {
      ultima_consulta_exitosa: observed, ultimo_resultado: 'ok', consulta_exitosa_ultimo_intento: true,
      identidad_verificada: true, paginacion_completa: true, persistencia_confirmada: true, ...expediente,
    } },
  };
}

Deno.test('earlier failed attempt followed by a later complete certified read is consumable without rejuvenating the observation', () => {
  // The daily cycle was sealed FAILED by an attempt that ran before the
  // source completed; the stored read completed afterwards. The gate offers
  // the continuation and the feed assessment accepts it with its OWN source
  // observation timestamp, never the consumption time.
  const admission = { admitted: false, reason: 'DAILY_UPDATE_ALREADY_STARTED', existing: { status: 'FAILED' } };
  assert.equal(mayConsumeStoredSamai(admission, 'CPACA'), true);
  const now = new Date('2026-11-05T14:00:00Z'); // 09:00 Bogotá
  const observed = '2026-11-05T07:40:41.704Z'; // 02:40 Bogotá, same day
  const verdict = assessSamaiFeed(certifiedFeed(observed), radicado, now);
  assert.deepEqual(verdict, { ok: true, observedAt: observed });
});

Deno.test('a truly partial stored read stays non-success under the same continuation', () => {
  const admission = { admitted: false, reason: 'DAILY_UPDATE_ALREADY_STARTED', existing: { status: 'FAILED' } };
  assert.equal(mayConsumeStoredSamai(admission, 'CPACA'), true);
  const now = new Date('2026-11-05T14:00:00Z');
  const observed = '2026-11-05T07:40:41.704Z';
  // Pagination not certified → coverage unverified, never a complete read.
  assert.deepEqual(
    assessSamaiFeed(certifiedFeed(observed, { paginacion_completa: false }), radicado, now),
    { ok: false, code: 'SAMAI_SOURCE_COVERAGE_UNVERIFIED' },
  );
  // Row count mismatch → partial feed, never a complete read.
  assert.deepEqual(
    assessSamaiFeed({ ...certifiedFeed(observed), total_found: 2 }, radicado, now),
    { ok: false, code: 'SAMAI_SOURCE_FEED_PARTIAL' },
  );
  // Last source attempt failed → the cached rows are not a new consultation.
  assert.deepEqual(
    assessSamaiFeed(certifiedFeed(observed, { consulta_exitosa_ultimo_intento: false, ultimo_resultado: 'error' }), radicado, now),
    { ok: false, code: 'SAMAI_SOURCE_LAST_ATTEMPT_FAILED' },
  );
});
