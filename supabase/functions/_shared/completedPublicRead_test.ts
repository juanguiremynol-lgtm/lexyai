import { strict as assert } from 'node:assert';
import { completedSamaiRead } from './completedPublicRead.ts';
Deno.test('completed daily reads require matching persisted source evidence; no new source call', () => {
  const now = new Date();
  const admission = { admitted:false,reason:'DAILY_UPDATE_ALREADY_STARTED',run_date:new Date(+now-5*3600_000).toISOString().slice(0,10),
    existing:{status:'DONE',trace_id:'the-admitted-trace'} };
  const summary = {source_observed_at:now.toISOString(),source_query_complete:true,parsed_count:2,accounted_count:2,
    buckets:{ERROR:0,REJECTED_PARTIES:0,REJECTED_TRIGGER:0,SKIPPED_DUPLICATE:2}};
  const history = {id:'history',work_item_id:'case',status:'SUCCESS',details:{daily_trace_id:'the-admitted-trace',samai_estados:summary}};
  const good = completedSamaiRead(admission,history,'case');
  assert.equal(good?.reused_completed_read,true);assert.equal(good?.inserted_count,0);
  assert.equal(good?.samai_estados_summary.called,false);
  for (const changed of [{source_observed_at:undefined},{source_query_complete:false},{accounted_count:1},
    {source_observed_at:new Date(+now-48*3600_000).toISOString()}, {buckets:{...summary.buckets,ERROR:1}}])
    assert.equal(completedSamaiRead(admission,{...history,details:{...history.details,samai_estados:{...summary,...changed}}},'case'),null);
  assert.equal(completedSamaiRead(admission,{...history,work_item_id:'other'},'case'),null);
  assert.equal(completedSamaiRead({...admission,existing:{status:'DONE',trace_id:'different'}},history,'case'),null);
});
