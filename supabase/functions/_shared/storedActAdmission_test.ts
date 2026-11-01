import { strict as assert } from 'node:assert';
import { mayConsumeStoredCpnu } from './storedActAdmission.ts';
import { continuationProviders } from './dailyUpdateGate.ts';

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
