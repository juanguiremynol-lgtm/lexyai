import { strict as assert } from 'node:assert';
import { fetchFromSamai } from './providerAdapters/samaiAdapter.ts';
import { assessSamaiFeed } from './samaiFeedFreshness.ts';
import { persistenceIsComplete, occurredByToday, requiredSourcesComplete, ingestionOutcome, recordEmptyInitialCompletion } from './syncCompletion.ts';
import { syncResponseOk } from './syncResponseVerdict.ts';
import { withSyncTimeline } from './syncTimeline.ts';

const radicado = '05001333300320250013300';
function feed(observed: string, extra: Record<string, unknown> = {}) {
  return {
    radicado, actuaciones: [{ actuacion: 'Auto', fechaActuacion: '2026-10-20' }], total_found: 1,
    fuentes_frescura: {
      expediente: { ultima_consulta_exitosa: observed, ultimo_resultado: 'ok', consulta_exitosa_ultimo_intento: true,
        identidad_verificada: true, paginacion_completa: true, persistencia_confirmada: true },
      estados: { ultima_consulta_exitosa: new Date().toISOString(), ultimo_resultado: 'ok', consulta_exitosa_ultimo_intento: true },
    }, ...extra,
  };
}

Deno.test('freshness belongs to expediente, exact case and current Bogotá day', () => {
  const now = new Date('2026-10-28T06:00:00Z');
  assert.equal(assessSamaiFeed(feed('2026-10-28T05:01:00Z'), radicado, now).ok, true);
  assert.deepEqual(assessSamaiFeed(feed('2026-10-28T04:59:00Z'), radicado, now), { ok: false, code: 'SAMAI_SOURCE_OBSERVATION_STALE' });
  assert.deepEqual(assessSamaiFeed(feed('2026-10-28T05:01:00Z', { radicado: 'different' }), radicado, now), { ok: false, code: 'SAMAI_CASE_MISMATCH' });
  assert.deepEqual(assessSamaiFeed({ radicado, actuaciones: [], fuentes_frescura: { estados: { ultima_consulta_exitosa: now.toISOString() } } }, radicado, now), { ok: false, code: 'SAMAI_SOURCE_OBSERVATION_MISSING' });
  assert.deepEqual(assessSamaiFeed(feed(now.toISOString(), { fuentes_frescura: { expediente: {
    ultima_consulta_exitosa: now.toISOString(), ultimo_resultado: 'ok', consulta_exitosa_ultimo_intento: true,
  } } }), radicado, now), { ok: false, code: 'SAMAI_SOURCE_COVERAGE_UNVERIFIED' });
  assert.equal(assessSamaiFeed(feed('2026-10-28T09:00:00Z'), radicado, now).ok, false);
});

Deno.test('real adapter rejects stale, failed, incomplete and mismatched cached feeds', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = Deno.env.get('SAMAI_FEED_API_KEY');
  Deno.env.set('SAMAI_FEED_API_KEY', 'isolated-test-key');
  try {
    const now = new Date();
    const source = feed(now.toISOString());
    const variants = [
      feed(new Date(now.getTime() - 48 * 3600000).toISOString()),
      feed(now.toISOString(), { radicado: '05001333300320250013301' }),
      feed(now.toISOString(), { total_found: 2 }),
      feed(now.toISOString(), { fuentes_frescura: { expediente: { ultima_consulta_exitosa: now.toISOString(), ultimo_resultado: 'error', consulta_exitosa_ultimo_intento: false } } }),
    ];
    for (const payload of variants) {
      globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
      const result = await fetchFromSamai({ radicado, mode: 'monitoring' });
      assert.equal(result.status, 'ERROR');
      assert.equal(result.actuaciones.length, 0);
    }
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify(source), { status: 200 }));
    const good = await fetchFromSamai({ radicado, mode: 'monitoring' });
    assert.equal(good.status, 'SUCCESS');
    assert.equal(good.sourceObservedAt, now.toISOString());
    assert.equal(good.actuaciones.length, 1);
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify(feed(now.toISOString(), { actuaciones: [], total_found: 0 })), { status: 200 }));
    const empty = await fetchFromSamai({ radicado, mode: 'monitoring' });
    assert.equal(empty.status, 'SUCCESS');
    assert.equal(empty.actuaciones.length, 0);
    assert.equal(empty.sourceObservedAt, now.toISOString());
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnv === undefined) Deno.env.delete('SAMAI_FEED_API_KEY');
    else Deno.env.set('SAMAI_FEED_API_KEY', originalEnv);
  }
});

Deno.test('persistence failure, duplicates and future dates cannot advance a successful cursor', () => {
  const ledger = { parsed: 2, inserted: 1, updated: 0, skippedDuplicate: 1, skippedStructural: 0, rejected: 0, errored: 0 };
  assert.equal(persistenceIsComplete(ledger), true);
  assert.equal(persistenceIsComplete({ ...ledger, errored: 1 }), false);
  assert.equal(persistenceIsComplete({ ...ledger, skippedDuplicate: 0 }), false);
  assert.equal(persistenceIsComplete({ ...ledger, skippedStructural: 1 }), false);
  assert.equal(occurredByToday('2026-11-10', new Date('2026-10-28T12:00:00Z')), false);
  assert.equal(occurredByToday('2026-10-28', new Date('2026-10-28T12:00:00Z')), true);
});

Deno.test('a later required provider failure cannot turn a partial result into success', () => {
  const attempts = [{ status: 'success' }];
  assert.equal(requiredSourcesComplete(true, attempts), true);
  assert.equal(requiredSourcesComplete(true, [...attempts, { status: 'error' }]), false);
  assert.equal(requiredSourcesComplete(true, [...attempts, { status: 'skipped' }]), false);
  assert.equal(requiredSourcesComplete(false, attempts), false);
});

Deno.test('source persistence and failed hearing effects have distinct outcomes', () => {
  assert.deepEqual(ingestionOutcome(true, ['Hearing backfill failed']), { sourceComplete: true, effectsPending: true });
  assert.deepEqual(ingestionOutcome(false, ['write failed']), { sourceComplete: false, effectsPending: false });
});

Deno.test('validated empty records its source observation and propagates a write failure', async () => {
  let written: unknown;
  const makeDb = (error: unknown) => ({ from: () => ({ update: (value: unknown) => {
    written = value;
    return { eq: () => ({ is: () => Promise.resolve({ error }) }) };
  } }) });
  await recordEmptyInitialCompletion(makeDb(null), 'wi', '2026-10-28T05:00:00Z');
  assert.deepEqual(written, { acts_initial_sync_completed_at: '2026-10-28T05:00:00Z' });
  await assert.rejects(() => recordEmptyInitialCompletion(makeDb(new Error('storage failed')), 'wi'));
});

Deno.test('HTTP 200 with an explicit failed verdict remains a failure', () => {
  assert.equal(syncResponseOk(true, { ok: false, code: 'PENDING_UPSTREAM' }), false);
  assert.equal(syncResponseOk(true, { ok: false, code: 'PROVIDER_ERROR' }), false);
  assert.equal(syncResponseOk(true, {}), false);
  assert.equal(syncResponseOk(false, { ok: true }), false);
  assert.equal(syncResponseOk(true, { ok: true, inserted_count: 0 }), true);
});

Deno.test('timeline persists a 200/ok:false failure before returning', async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = Deno.env.get('SUPABASE_URL');
  const previousKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  Deno.env.set('SUPABASE_URL', 'https://test.invalid');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'isolated-test-key');
  let row: Record<string, unknown> | null = null;
  try {
    globalThis.fetch = (_input, init) => {
      row = JSON.parse(String(init?.body));
      return Promise.resolve(new Response('', { status: 201 }));
    };
    const wrapped = withSyncTimeline(
      () => new Response(JSON.stringify({ ok: false, code: 'SAMAI_SOURCE_OBSERVATION_STALE', provider_used: 'samai' }),
        { status: 200, headers: { 'content-type': 'application/json' } }),
      { function_name: 'sync-by-work-item', default_operation: 'acts' },
    );
    await wrapped(new Request('https://test.invalid/run', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ work_item_id: 'test-item' }),
    }));
    assert.ok(row);
    assert.equal((row as Record<string, unknown>).status, 'error');
    assert.equal((row as Record<string, unknown>).error_code, 'SAMAI_SOURCE_OBSERVATION_STALE');
    row = null;
    const rejected = withSyncTimeline(() => new Response(JSON.stringify({ ok: false, code: 'UNAUTHORIZED' }), {
      status: 401, headers: { 'content-type': 'application/json' },
    }), { function_name: 'sync-by-work-item', default_operation: 'acts' });
    await rejected(new Request('https://test.invalid/run', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ work_item_id: 'another-tenant' }),
    }));
    assert.equal(row, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) Deno.env.delete('SUPABASE_URL'); else Deno.env.set('SUPABASE_URL', previousUrl);
    if (previousKey === undefined) Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY'); else Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', previousKey);
  }
});
