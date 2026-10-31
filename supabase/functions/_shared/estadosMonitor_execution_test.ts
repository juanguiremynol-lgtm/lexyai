import { runEstadosMonitor } from "./estadosMonitor.ts";

async function exercise(result: Record<string, unknown>, sealed: boolean | "rpc_error" = true, emptyClaim = false) {
  const env = {SUPABASE_URL:"https://example.invalid",SUPABASE_SERVICE_ROLE_KEY:"isolated-test-key",CRON_SERVICE_KEY:"isolated-cron-key"};
  const previous = Object.fromEntries(Object.keys(env).map(k=>[k,Deno.env.get(k)]));
  const oldFetch=globalThis.fetch;
  const calls: Array<{path:string,body:Record<string, unknown>}> = [];
  for(const [k,v] of Object.entries(env))Deno.env.set(k,v);
  globalThis.fetch=async (input,init) => {
    const path=new URL(typeof input==="string" ? input : input instanceof URL ? input.href : input.url).pathname;
    const body=JSON.parse(String(init && 'body' in init ? init.body ?? "{}" : "{}")); calls.push({path,body});
    if(path.endsWith("start_public_monitor_run"))return Response.json([{run_id:"00000000-0000-0000-0000-000000000001",acquired:true,selected_count:1}]);
    if(path.endsWith("claim_public_monitor_items"))return Response.json(emptyClaim ? [] : [{work_item_id:"00000000-0000-0000-0000-000000000002",ordinal:1,lease_token:"00000000-0000-0000-0000-000000000003"}]);
    if(path.endsWith("sync-publicaciones-by-work-item"))return Response.json(result);
    if(path.endsWith("finish_public_monitor_item"))return sealed==="rpc_error" ? Response.json({message:"simulated interruption"},{status:503}) : Response.json(sealed);
    if(path.endsWith("defer_public_monitor_read"))return sealed==="rpc_error" ? Response.json({message:"simulated interruption"},{status:503}) : Response.json(sealed);
    if(path.endsWith("work_items"))return Response.json(null);
    if(path.endsWith("finish_public_monitor_hop"))return Response.json([{status:["PENDING_UPSTREAM","DAILY_UPDATE_ALREADY_STARTED"].includes(String(result.result_code)) ? "PARTIAL":"OK",remaining_count:["PENDING_UPSTREAM","DAILY_UPDATE_ALREADY_STARTED"].includes(String(result.result_code)) ? 1:0,depth_remaining:emptyClaim ? 20:0}]);
    if(path.endsWith("refresh_estados_fijacion_coverage_signals"))return Response.json(null);
    throw new Error(`Unexpected HTTP request blocked: ${path}`);
  };
  try {
    const response=await runEstadosMonitor(new Request("https://example.invalid/monitor",{method:"POST",headers:{"x-cron-key":"isolated-cron-key"},body:"{}"}),"publicaciones");
    return {status:response.status,body:await response.json(),calls};
  } finally {
    globalThis.fetch=oldFetch;
    for(const [k,v] of Object.entries(previous)){if(v===undefined)Deno.env.delete(k);else Deno.env.set(k,v);}
  }
}
function assert(v:unknown){if(!v)throw new Error("assertion failed");}
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
  const result=await exercise({ok:true,result_code:"SUCCESS_WITH_DATA",documentos_pendientes:6});
  assert(result.body.ok===true);
  const seal=result.calls.find(x=>x.path.endsWith("finish_public_monitor_item"));
  if (!seal) throw new Error('Missing completion RPC');
  assert(seal.body._success===true && (seal.body._result as Record<string,unknown>).documentos_pendientes===6);
});
Deno.test("interrupted or fenced completion cannot advance labels or the hop",async()=>{
  for(const sealed of [false,"rpc_error"] as const){
    const result=await exercise({ok:true,result_code:"SUCCESS_WITH_DATA"},sealed);
    assert(result.status===503);
    assert(!result.calls.some(x=>x.path.endsWith("work_items") || x.path.endsWith("finish_public_monitor_hop")));
  }
});
Deno.test("an existing daily admission defers without a false failure or source clock",async()=>{
  const retryAt=new Date(Date.now()+600_000).toISOString();
  const result=await exercise({ok:false,result_code:"DAILY_UPDATE_ALREADY_STARTED",deduplicated:true,daily_update:{admitted:false,next_eligible_at:retryAt}});
  assert(result.body.ok===false);
  const defer=result.calls.find(x=>x.path.endsWith("defer_public_monitor_read"));
  assert(defer?.body._retry_at===retryAt && !!defer?.body._lease_token);
  assert(!result.calls.some(x=>x.path.endsWith("finish_public_monitor_item") || x.path.endsWith("work_items")));
  assert(result.calls.some(x=>x.path.endsWith("finish_public_monitor_hop")));
});
Deno.test("a replaced or interrupted deferred claim cannot finish the hop",async()=>{
  for(const sealed of [false,"rpc_error"] as const){
    const result=await exercise({ok:false,result_code:"DAILY_UPDATE_ALREADY_STARTED",deduplicated:true,daily_update:{admitted:false,next_eligible_at:new Date(Date.now()+600_000).toISOString()}},sealed);
    assert(result.status===503);
    assert(!result.calls.some(x=>x.path.endsWith("finish_public_monitor_hop") || x.path.endsWith("work_items")));
  }
});
Deno.test("future pending items do not spin empty chained invocations",async()=>{
  const result=await exercise({result_code:"DAILY_UPDATE_ALREADY_STARTED"},true,true);
  assert(result.body.ok===false);
  assert(!result.calls.some(x=>x.path.endsWith("sync-publicaciones-by-work-item")));
  assert(result.calls.length===3); // start, empty claim, finish-hop; no next HTTP hop
});
