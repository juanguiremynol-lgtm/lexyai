import { runEstadosMonitor } from "./estadosMonitor.ts";

async function exercise(result: Record<string, unknown>, sealed: boolean | "rpc_error" = true) {
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
    if(path.endsWith("sync-publicaciones-by-work-item"))return Response.json(result);
    if(path.endsWith("finish_public_monitor_item"))return sealed==="rpc_error" ? Response.json({message:"simulated interruption"},{status:503}) : Response.json(sealed);
    if(path.endsWith("work_items"))return Response.json(null);
    if(path.endsWith("finish_public_monitor_hop"))return Response.json([{status:result.result_code==="PENDING_UPSTREAM" ? "PARTIAL":"OK",remaining_count:result.result_code==="PENDING_UPSTREAM" ? 1:0,depth_remaining:0}]);
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
