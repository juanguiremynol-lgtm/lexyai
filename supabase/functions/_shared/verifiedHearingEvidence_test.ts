import { strict as assert } from 'node:assert';
import { hearingAlreadyResolved } from './verifiedHearingEvidence.ts';
Deno.test('verified hearing evidence requires the same act and an unambiguous explicit time',()=>{
  const row={source_act_id:'original-act',scheduled_at:'2026-11-30T13:30:00Z',time_inferred:false};
  assert(hearingAlreadyResolved([row],'original-act','2026-11-30'));
  assert(!hearingAlreadyResolved([row],'another-act','2026-11-30'));
  assert(!hearingAlreadyResolved([row],'original-act','2026-12-01'));
  assert(!hearingAlreadyResolved([{...row,time_inferred:true}],'original-act','2026-11-30'));
  assert(!hearingAlreadyResolved([row,{...row,scheduled_at:'2026-11-30T14:30:00Z'}],'original-act','2026-11-30'));
});
