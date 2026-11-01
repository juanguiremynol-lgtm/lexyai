import { strict as assert } from 'node:assert';
import { completedSamaiRead } from './completedPublicRead.ts';
import { mayReadStoredSamai } from './completedPublicRead.ts';
import { emptySamaiBuckets, samaiAccountingComplete } from './samaiPublicationAccounting.ts';
import { validStoredSamaiRead } from './storedSamaiRead.ts';
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

Deno.test('incomplete initial accounting -> later certified snapshot -> deferred monitor resumes without a new extraction', () => {
  const now = Date.now(), rad = '05001333300520250001900';
  const admission = { admitted:false,reason:'DAILY_UPDATE_ALREADY_STARTED',
    run_date:new Date(now-5*3600_000).toISOString().slice(0,10),existing:{status:'DONE',trace_id:'initial'} };
  const failedSummary = {source_observed_at:new Date(now-3600_000).toISOString(),source_query_complete:true,
    parsed_count:6,accounted_count:null,buckets:{...emptySamaiBuckets(),SKIPPED_DUPLICATE:3,SKIPPED_DUPLICATE_STRUCTURAL:null}};
  const history = {id:'old',work_item_id:'case',status:'SUCCESS',details:{daily_trace_id:'initial',samai_estados:failedSummary}};
  assert.equal(completedSamaiRead(admission,history,'case'),null);
  assert.equal(mayReadStoredSamai(admission,'CPACA'),true);
  assert.equal(mayReadStoredSamai({...admission,existing:{status:'STARTED'}},'CPACA'),false);
  assert.equal(mayReadStoredSamai(admission,'CGP'),false);
  const observed = new Date(now-60_000).toISOString();
  const snapshot = {radicado:rad,actuaciones:[{Radicacion:rad,categoria:'ESTADO'}],total_found:1,
    stored_read_only:true,provider_queries:0,consulta_completa:true,persistencia_completa:true,
    consultado_en:observed,providencias_consultadas_en:observed,fijaciones_desplegable_leido_en:observed,
    fijaciones_fecha_mas_antigua_leida_en:observed,fijaciones:{visible_dates:15,covered_dates:15}};
  assert.equal(validStoredSamaiRead(snapshot,rad,now),true);
  for(const delta of [{consulta_completa:false},{persistencia_completa:false},{radicado:'05001333300520250001901'},
    {fijaciones:{visible_dates:15,covered_dates:14}},{fijaciones_fecha_mas_antigua_leida_en:new Date(now-21*3600_000).toISOString()},
    {consultado_en:null},{actuaciones:[{Radicacion:rad,categoria:'ACTUACION'}]}])
    assert.equal(validStoredSamaiRead({...snapshot,...delta},rad,now),false);
  const summary = {...failedSummary,source_observed_at:observed,accounted_count:6,
    buckets:{...emptySamaiBuckets(),SKIPPED_DUPLICATE:3,SKIPPED_DUPLICATE_STRUCTURAL:3}};
  assert.equal(samaiAccountingComplete(summary),true);
  const result = completedSamaiRead(admission,{...history,id:'later',details:{daily_trace_id:'initial',samai_estados:summary}},'case');
  assert.equal(result?.source_complete,true);assert.equal(result?.source_observed_at,observed);
  assert.equal(result?.provider_used,'samai_estados');assert.equal(result?.inserted_count,0);
  assert.equal(completedSamaiRead(admission,{...history,details:{daily_trace_id:'initial',samai_estados:{...summary,source_query_complete:false}}},'case'),null);
});
