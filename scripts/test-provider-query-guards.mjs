// Runs the real edge handlers with an in-memory database and no network.
// Imports are stubbed only at their external boundaries; production control
// flow (selection, skip response and placement before provider calls) executes.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { providerQueryBlockReason } from '../supabase/functions/_shared/providerQueryEligibility.ts';

const active = { id: 'synthetic-item', organization_id: 'synthetic-org',
  radicado: '00000000000000000000000', workflow_type: 'CGP',
  deleted_at: null, lifecycle_state: 'ACTIVE', monitoring_enabled: true, scraping_enabled: true };

function handler(name, item, { sourceStatus = 'ACTIVE', instanceEnabled = true } = {}) {
  const calls = [], filters = [];
  let serve;
  const db = { from(table) {
    calls.push(`table:${table}`);
    const q = { select() { return q; }, eq(k, v) { filters.push([table, k, v]); return q; },
      is() { return q; }, not() { return q; }, in() { return q; }, order() { return q; },
      async range() { return { data: [item], error: null }; },
      async single() { return { error: null, data: table === 'work_items' ? item
        : table === 'work_item_sources' ? { id: 'synthetic-source', work_item_id: active.id,
          organization_id: active.organization_id, provider_instance_id: 'synthetic-provider', status: sourceStatus }
        : { id: 'synthetic-provider', is_enabled: instanceEnabled } }; },
      async maybeSingle() { return q.single(); },
    };
    return q;
  } };
  const imports = {
    'npm:@supabase/supabase-js@2': { createClient: () => db },
    'npm:@supabase/supabase-js@2.118.0/cors': { corsHeaders: {} },
    '../_shared/providerQueryEligibility.ts': { providerQueryBlockReason },
    '../_shared/bridgeProviderMatrix.ts': { CHAIN: { CGP: ['cpnu', 'publicaciones'] } },
  };
  const forbidden = () => { throw new Error('Provider/network/secret boundary was reached'); };
  const scope = { exports: {}, require: key => imports[key] ?? new Proxy({}, { get: () => forbidden }),
    Deno: { serve: callback => { serve = callback; }, env: { get: key => key === 'SUPABASE_URL' ? 'https://synthetic.invalid' : 'synthetic-key' } },
    Response, Request, Headers, URL, AbortSignal, crypto, console, fetch: forbidden, setTimeout: forbidden };
  const file = new URL(`../supabase/functions/${name}/index.ts`, import.meta.url);
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(js, scope, { filename: file.pathname });
  return { run: async body => {
    const response = await serve(new Request('https://synthetic.invalid', {
      method: 'POST', headers: { authorization: 'Bearer synthetic-key', 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    return { response, body: await response.json(), calls, filters };
  } };
}

for (const [field, value, reason] of [
  ['scraping_enabled', false, 'SCRAPING_DISABLED'],
  ['monitoring_enabled', false, 'MONITORING_DISABLED'],
  ['lifecycle_state', 'ARCHIVED', 'WORK_ITEM_NOT_ACTIVE'],
]) {
  test(`bridge explicit selection and force cannot bypass ${field}`, async () => {
    const result = await handler('bridge-reconcile', { ...active, [field]: value }).run({
      work_item_ids: [active.id], force_refresh: true, heal: true,
    });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.skipped_items, [{ work_item_id: active.id, reason }]);
    assert.deepEqual(result.body.lines, []);
    assert.equal(result.body.processed_items, 1); // cursor advances past skip
    assert.deepEqual(result.calls, ['table:work_items']);
  });
}

test('bridge scheduled selection requires both flags and active lifecycle', async () => {
  const result = await handler('bridge-reconcile', { ...active, scraping_enabled: false }).run({});
  for (const filter of [['work_items', 'scraping_enabled', true], ['work_items', 'monitoring_enabled', true], ['work_items', 'lifecycle_state', 'ACTIVE']]) {
    assert(result.filters.some(actual => JSON.stringify(actual) === JSON.stringify(filter)));
  }
});

for (const [label, item, options, reason] of [
  ['scraping disabled', { ...active, scraping_enabled: false }, {}, 'SCRAPING_DISABLED'],
  ['source disabled', active, { sourceStatus: 'DISABLED' }, 'SOURCE_DISABLED'],
  ['provider disabled', active, { instanceEnabled: false }, 'PROVIDER_DISABLED'],
]) {
  test(`external snapshot skips ${label} before resolving secrets or fetching`, async () => {
    const result = await handler('provider-sync-external-provider', item, options).run({ work_item_source_id: 'synthetic-source' });
    assert.equal(result.body.status, 'SKIPPED');
    assert.equal(result.body.skip_reason, reason);
    assert.equal(result.body.source_complete, false);
    assert.equal(result.body.source_query_attempted, false);
    if (reason !== 'PROVIDER_DISABLED') assert(!result.calls.includes('table:provider_instances'));
  });
}

test('missing flags fail closed; reactivation is reevaluated without mutating history', () => {
  const paused = { ...active, scraping_enabled: false };
  assert.equal(providerQueryBlockReason(paused), 'SCRAPING_DISABLED');
  assert.equal(providerQueryBlockReason({ ...paused, scraping_enabled: true }), null);
  assert.equal(providerQueryBlockReason({ ...active, scraping_enabled: undefined }), 'SCRAPING_DISABLED');
  assert.equal(paused.scraping_enabled, false);
});
