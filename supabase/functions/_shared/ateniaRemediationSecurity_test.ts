import { strict as assert } from 'node:assert';
import { authorizeSupervisor, ineligibleRefusal, remediationHeaders, remediationVerdict } from './ateniaRemediationSecurity.ts';

Deno.test('supervisor requires service, cron key or verified platform administrator', async () => {
  const oldService = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const oldCron = Deno.env.get('CRON_SERVICE_KEY');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'local-service-only');
  Deno.env.set('CRON_SERVICE_KEY', 'local-cron-only');
  let adminLookups = 0;
  const admin = {
    auth: { getUser: async (token: string) => token === 'real-user'
      ? { data: { user: { id: 'user1' } }, error: null }
      : { data: { user: null }, error: new Error('invalid') } },
    from: (_name: string) => ({ select: (_cols: string) => ({ eq: (_col: string, _id: string) => ({
      maybeSingle: async () => { adminLookups++; return { data: { user_id: 'user1' }, error: null }; },
    }) }) }),
  };
  try {
    const request = (headers = {}) => new Request('https://example.invalid', { headers });
    assert.equal(await authorizeSupervisor(request(), admin), null);
    assert.equal(await authorizeSupervisor(request({ authorization: 'Bearer wrong' }), admin), null);
    assert.equal(adminLookups, 0);
    assert.equal(await authorizeSupervisor(request({ authorization: 'Bearer local-service-only' }), admin), 'system');
    assert.equal(await authorizeSupervisor(request({ 'x-cron-key': 'local-cron-only' }), admin), 'system');
    assert.equal(await authorizeSupervisor(request({ authorization: 'Bearer real-user' }), admin), 'admin');
    const nonAdmin = { ...admin, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
    assert.equal(await authorizeSupervisor(request({ authorization: 'Bearer real-user' }), nonAdmin), null);
  } finally {
    if (oldService === undefined) Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY'); else Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', oldService);
    if (oldCron === undefined) Deno.env.delete('CRON_SERVICE_KEY'); else Deno.env.set('CRON_SERVICE_KEY', oldCron);
  }
});

Deno.test('worker supplies explicit service identity and trace', () => {
  const h = remediationHeaders('local-service-only', 'job-1');
  assert.equal(h.Authorization, 'Bearer local-service-only');
  assert.equal(h.apikey, 'local-service-only');
  assert.equal(h['x-retry-task-id'], 'job-1');
  assert.throws(() => remediationHeaders('', 'job-1'));
});

Deno.test('only explicit complete results are DONE, with nonapplicable kept separate', () => {
  assert.equal(remediationVerdict({ ok: true, errors: [], inserted_count: 0 }).outcome, 'DONE');
  for (const value of [null, {}, { ok: false }, { ok: true, partial: true },
    { ok: true, pending_upstream: true }, { ok: true, status: 'partial_success' },
    { ok: true, errors: ['storage error'] }, { ok: true, errors: 'storage error' }, { ok: true, scraping_initiated: true }]) {
    assert.equal(remediationVerdict(value).outcome, 'RETRY');
  }
  assert.equal(remediationVerdict({ ok: true, status: 'not_applicable' }).outcome, 'SKIPPED');
  assert.equal(remediationVerdict({ ok: true, status: 'skipped_paused' }).outcome, 'SKIPPED');
  assert.equal(ineligibleRefusal(409, { code: 'MONITORING_DISABLED' }), 'MONITORING_DISABLED');
  assert.equal(ineligibleRefusal(401, { code: 'MONITORING_DISABLED' }), null);
  assert.equal(ineligibleRefusal(409, { code: 'PROVIDER_ERROR' }), null);
});
