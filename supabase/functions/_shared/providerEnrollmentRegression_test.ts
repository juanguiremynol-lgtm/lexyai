import { strict as assert } from 'node:assert';
import { orchestrateSync } from './syncOrchestrator.ts';

Deno.test('fanout and fallback never invoke providers without an enabled enrollment', async () => {
  const calls: string[] = [];
  const fetcher = (provider: string) => async () => {
    calls.push(provider);
    return { ok: true, found: true, isEmpty: false, insertedCount: 0, skippedCount: 0,
      httpStatus: 200, latencyMs: 1, errorCode: null, errorMessage: null };
  };
  const registry = new Map([['CPNU', fetcher('cpnu')], ['SAMAI', fetcher('samai')]]);
  const ctx = { workItemId: 'wi', organizationId: 'org', workflowType: 'TUTELA',
    radicado: '05001333300320250013300', invokedBy: 'CRON', triggerSource: 'test' } as const;
  await orchestrateSync(ctx, registry, {}, '', '', {
    skipEstados: true, skipRunRecord: true, coverageOverrides: [], enabledProviders: new Set(['cpnu']),
  });
  assert.deepEqual(calls, ['cpnu']);
  calls.length = 0;
  await orchestrateSync(ctx, registry, {}, '', '', {
    skipEstados: true, skipRunRecord: true, coverageOverrides: [], enabledProviders: new Set(),
  });
  assert.deepEqual(calls, []);
});
