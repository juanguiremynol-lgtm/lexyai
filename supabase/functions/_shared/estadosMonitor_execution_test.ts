import { runEstadosMonitor } from "./estadosMonitor.ts";
import { emptySamaiBuckets } from "./samaiPublicationAccounting.ts";
import { bogotaDay } from "./dailyCompletion.ts";

function ppProof(complete = true) {
  return { source_complete: true, source_observed_at: new Date().toISOString(),
    pp_window: { to: bogotaDay(), outcome: "SUCCESS_EMPTY", daily_plan_complete: complete },
    backend_trace: { backend_run_id: "21e9c43b-f2fd-4bb3-9247-01169937cad8", consulta_completa: true,
      consulta_completa_plan_diario: complete } };
}

async function exercise(result: Record<string, unknown>, sealed: boolean | "rpc_error" = true,
  channel: "publicaciones" | "samai_estados" = "publicaciones") {
  const env = {SUPABASE_URL:"https://example.invalid",SUPABASE_SERVICE_ROLE_KEY:"isolated-test-key",CRON_SERVICE_KEY:"isolated-cron-key"};
  const previous = Object.fromEntries(Object.keys(env).map(k=>[k,Deno.env.get(k)]));
  const oldFetch=globalThis.fetch;
  const calls: Array<{path:string,body:Record<string, unknown>}> = [];
  for(const [k,v] of Object.entries(env))Deno.env.set(k,v);
  globalThis.fetch=async (input,init) => {
    const path=new URL(typeof input==="string" ? input : input instanceof URL ? input.href : input.url).pathname;
    const body=JSON.parse(String(init && 'body' in init ? init.body ?? "{}" : "{}")); calls.push({path,body});
    if(path.endsWith("start_public_monitor_run"))return Response.json([{run_id:"00000000-0000-0000-0000-000000000001",acquired:true,selected_count:1}]);
    if(path.endsWith("claim_public_monitor_items"))return Response.json([{work_item_id:"00000000-0000-0000-0000-000000000002",ordinal:1,lease_token:"00000000-0000-0000-0000-000000000003"}]);
    if(path.endsWith("peek_samai_estados_breaker"))return Response.json([{paused:false}]);
    if(path.endsWith("sync-publicaciones-by-work-item"))return Response.json(result);
    if(path.endsWith("finish_public_monitor_item"))return sealed==="rpc_error" ? Response.json({message:"simulated interruption"},{status:503}) : Response.json(sealed);
    if(path.endsWith("work_items"))return Response.json(null);
    if(path.endsWith("finish_public_monitor_hop"))return Response.json([{status:result.result_code==="PENDING_UPSTREAM" ? "PARTIAL":"OK",remaining_count:result.result_code==="PENDING_UPSTREAM" ? 1:0,depth_remaining:0}]);
    if(path.endsWith("refresh_estados_fijacion_coverage_signals"))return Response.json(null);
    throw new Error(`Unexpected HTTP request blocked: ${path}`);
  };
  try {
    const response=await runEstadosMonitor(new Request("https://example.invalid/monitor",{method:"POST",headers:{"x-cron-key":"isolated-cron-key"},body:"{}"}),channel);
    return {status:response.status,body:await response.json(),calls};
  } finally {
    globalThis.fetch=oldFetch;
    for(const [k,v] of Object.entries(previous)){if(v===undefined)Deno.env.delete(k);else Deno.env.set(k,v);}
  }
}
function assert(v:unknown){if(!v)throw new Error("assertion failed");}
Deno.test("OPTIONS identifies the monitor revision without a database or provider call",async()=>{
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("unexpected call"); };
  try {
    const response=await runEstadosMonitor(new Request("https://example.invalid",{method:"OPTIONS"}),"samai_estados");
    assert(response.headers.get("X-Andromeda-Monitor-Revision")==="pp-daily-proof-20261121");
  } finally { globalThis.fetch=oldFetch; }
});
Deno.test("a mixed tutela response keeps the SAMAI adapter cause distinct from the PP run cause",async()=>{
  const ppCause = "PP_RUN_PARCIAL: CENTRO_AUTOR_NO_IDENTIFICADO";
  const samaiCause = "PROVIDENCIAS_PERSISTIDAS_NO_VIGENTES";
  const payload = {ok:false,provider_used:"publicaciones+samai_estados",status:"provider_unavailable",
    reason:ppCause,errors:[ppCause],backend_trace:{estado:"PARCIAL",consulta_completa:false},
    samai_estados_summary:{called:true,status:"ERROR",http_status:200,source_query_complete:false,error:samaiCause}};
  for (const [channel, cause] of [["samai_estados",samaiCause],["publicaciones",ppCause]] as const) {
    const {calls} = await exercise(payload,true,channel);
    const seal = calls.find(c=>c.path.endsWith("finish_public_monitor_item"))!.body;
    assert(seal._success===false && seal._retryable===false && seal._error_code===cause);
    assert((seal._result as typeof payload).reason===ppCause);
    assert(!calls.some(c=>c.path.endsWith("work_items") && "last_sync_attempt_at" in c.body));
  }
});
Deno.test("a different or unidentified source cannot confer its success or error on the monitored source",async()=>{
  for (const payload of [{ok:true,provider_used:"publicaciones",result_code:"SUCCESS_EMPTY"},
    {ok:false,provider_used:"publicaciones",errors:["PP_RUN_PARCIAL: AUTHOR_CASE_COURT_CONFLICT"]},
    {ok:true,result_code:"SUCCESS_EMPTY"}]) {
    const {calls} = await exercise(payload,true,"samai_estados");
    const seal = calls.find(c=>c.path.endsWith("finish_public_monitor_item"))!.body;
    assert(seal._success===false && seal._retryable===false && seal._error_code==="PROVIDER_UNRESOLVED");
    assert(!calls.some(c=>c.path.endsWith("work_items")));
  }
});
Deno.test("exclusive reads retain their verdict and mixed success requires own evidence plus the aggregate barriers",async()=>{
  const samai = {called:true,status:"EMPTY",http_status:200,source_query_complete:true,parsed_count:0,accounted_count:0,buckets:emptySamaiBuckets()};
  const common = {ok:true,result_code:"SUCCESS_EMPTY",provider_used:"publicaciones+samai_estados"};
  for (const [channel,payload,success,sourceClock] of [
    ["samai_estados",{...common,provider_used:"samai_estados"},true,true],
    ["publicaciones",{...common,...ppProof(),provider_used:"publicaciones"},true,true],
    ["samai_estados",{...common,samai_estados_summary:samai},true,false],
    ["samai_estados",{...common,ok:false,source_complete:false,samai_estados_summary:samai},false,false],
    ["publicaciones",{...common,samai_estados_summary:samai},false,false],
  ] as const) {
    const {calls}=await exercise(payload,true,channel);
    const seal=calls.find(c=>c.path.endsWith("finish_public_monitor_item"))!.body;
    assert(seal._success===success);
    assert(calls.some(c=>c.path.endsWith("work_items") && "last_sync_attempt_at" in c.body)===sourceClock);
  }
});
Deno.test("monitor execution retains pending verdict and token, without a false success clock",async()=>{
  const result=await exercise({ok:true,result_code:"PENDING_UPSTREAM"});
  assert(result.body.ok===false);
  const seal=result.calls.find(x=>x.path.endsWith("finish_public_monitor_item"));
  if (!seal) throw new Error('Missing completion RPC');
  assert(seal.body._success===false && seal.body._retryable===true && !!seal.body._lease_token);
  const label=result.calls.find(x=>x.path.endsWith("work_items"));
  if (!label) throw new Error('Missing source label write');
  assert(!("pp_ultima_sync" in label.body));
});
Deno.test("a completed query can keep documentary pending causes",async()=>{
  const result=await exercise({ok:true,provider_used:"publicaciones",result_code:"SUCCESS_WITH_DATA",documentos_pendientes:6,...ppProof()});
  assert(result.body.ok===true);
  const seal=result.calls.find(x=>x.path.endsWith("finish_public_monitor_item"));
  if (!seal) throw new Error('Missing completion RPC');
  assert(seal.body._success===true && (seal.body._result as Record<string,unknown>).documentos_pendientes===6);
});
Deno.test("PP retains a confirmed recent window while deferring an incomplete daily plan",async()=>{
  const { calls } = await exercise({ ok:true, provider_used:"publicaciones", result_code:"SUCCESS_EMPTY", ...ppProof(false) });
  const seal = calls.find(x=>x.path.endsWith("finish_public_monitor_item"))!.body;
  assert(seal._success===false && seal._retryable===true && seal._error_code==="PP_DAILY_PLAN_UNVERIFIED");
  const evidence = (seal._result as Record<string, unknown>).monitor_evidence as Record<string, unknown>;
  assert(evidence.recent_window_verified===true && evidence.daily_plan_verified===false);
  const label = calls.find(x=>x.path.endsWith("work_items"))!.body;
  assert(label.pp_estado === "pending" && !("pp_ultima_sync" in label));
});

Deno.test("a previous day's PP observation cannot finish today's monitor",async()=>{
  const {calls}=await exercise({ok:true,provider_used:"publicaciones",result_code:"SUCCESS_EMPTY",...ppProof(),
    source_observed_at: new Date(Date.now() - 86400_000).toISOString()});
  const seal=calls.find(x=>x.path.endsWith("finish_public_monitor_item"))!.body;
  assert(seal._success===false && seal._error_code==="PP_DAILY_WINDOW_UNVERIFIED");
});
Deno.test("incomplete source or unresolved provider never seal a successful monitor",async()=>{
  for (const result of [{ok:true,result_code:'SUCCESS_EMPTY',source_complete:false},
    {ok:true,result_code:'SUCCESS_EMPTY',error_code:'PROVIDER_UNRESOLVED'}]) {
    const attempt=await exercise(result);
    const seal=attempt.calls.find(x=>x.path.endsWith('finish_public_monitor_item'));
    assert(seal?.body._success===false);
    const label=attempt.calls.find(x=>x.path.endsWith('work_items'));
    assert(!!label && !('pp_ultima_sync' in label.body));
  }
});
Deno.test("a stored replay does not advance the last source attempt or success clock",async()=>{
  const attempt=await exercise({ok:true,result_code:'SUCCESS_WITH_DATA',reused_completed_read:true,source_query_attempted:false});
  const label=attempt.calls.find(x=>x.path.endsWith('work_items'));
  assert(!!label && !('pp_ultima_sync' in label.body) && !('last_sync_attempt_at' in label.body));
});
Deno.test("an incomplete stored read does not advance source attempt or success clocks",async()=>{
  const attempt=await exercise({ok:false,result_code:'PENDING_UPSTREAM',source_complete:false,
    reused_completed_read:false,source_query_attempted:false});
  const label=attempt.calls.find(x=>x.path.endsWith('work_items'));
  assert(!!label && !('pp_ultima_sync' in label.body) && !('last_sync_attempt_at' in label.body));
});
Deno.test("interrupted or fenced completion cannot advance labels or the hop",async()=>{
  for(const sealed of [false,"rpc_error"] as const){
    const result=await exercise({ok:true,result_code:"SUCCESS_WITH_DATA"},sealed);
    assert(result.status===503);
    assert(!result.calls.some(x=>x.path.endsWith("work_items") || x.path.endsWith("finish_public_monitor_hop")));
  }
});
