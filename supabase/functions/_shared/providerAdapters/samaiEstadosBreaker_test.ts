import { isSharedSessionBlock, withSamaiEstadosBreaker } from './samaiEstadosBreaker.ts';
import type { ProviderAdapterResult } from './types.ts';
function equal(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
const valid: ProviderAdapterResult = { provider:'samai_estados', status:'EMPTY', actuaciones:[], publicaciones:[], metadata:null, parties:null, durationMs:1, httpStatus:200 };
Deno.test('only the exact provider session endpoint in the 502 body is shared evidence', () => {
  const detail="Error al conectar con SAMAI: Client error '403 Forbidden' for url 'https://samai.consejodeestado.gov.co/Vistas/utiles/WEstados.aspx'";
  equal([isSharedSessionBlock(502,{detail:detail+' extra'}),isSharedSessionBlock(403,{detail}),
    isSharedSessionBlock(502,{detail:detail.replace('WEstados.aspx','documento.aspx')}),isSharedSessionBlock(502,{detail:'HTTP 502'})], [true,false,false,false]);
});
Deno.test('open circuit never calls provider or marks a query successful', async () => {
  let calls=0;
  const result=await withSamaiEstadosBreaker(async () => [{allowed:false,generation:1,probe_token:null,retry_at:'2026-10-28T12:15:00Z'}], async () => {calls++;return valid;});
  equal([calls,result.status,result.errorMessage], [0,'ERROR','PROVIDER_BREAKER_OPEN:2026-10-28T12:15:00Z']);
});
Deno.test('a confirmed shared session 403 is sealed and returned as failure', async () => {
  let outcome='';
  const result=await withSamaiEstadosBreaker(async (name,body) => {
    if (name.startsWith('acquire')) return [{allowed:true,generation:0,probe_token:null,retry_at:null}];
    outcome=String(body._outcome);return true;
  }, async () => ({...valid,status:'ERROR',httpStatus:502,errorMessage:'SAMAI_ESTADOS_SESSION_403'}));
  equal([outcome,result.status,result.httpStatus],['TRANSIENT_FAILURE','ERROR',502]);
});
Deno.test('generic 502 and timeout do not open the shared session circuit', async () => {
  const outcomes: string[] = [];
  const rpc = async (name: string, body: Record<string,unknown>) => {
    if (name.startsWith('acquire')) return [{allowed:true,generation:0,probe_token:null,retry_at:null}];
    outcomes.push(String(body._outcome));return true;
  };
  await withSamaiEstadosBreaker(rpc, async () => ({...valid,status:'ERROR',httpStatus:502,errorMessage:'HTTP 502'}));
  await withSamaiEstadosBreaker(rpc, async () => ({...valid,status:'TIMEOUT',httpStatus:undefined}));
  equal(outcomes,['OTHER_FAILURE','OTHER_FAILURE']);
});
Deno.test('lost probe or unavailable database returns pending rather than success', async () => {
  const lost=await withSamaiEstadosBreaker(async (name) => name.startsWith('acquire') ? [{allowed:true,generation:2,probe_token:'probe',retry_at:null}] : false, async () => valid);
  const unavailable=await withSamaiEstadosBreaker(async () => {throw new Error('unavailable');}, async () => valid);
  equal([lost.errorMessage,unavailable.errorMessage],['PROVIDER_BREAKER_LEASE_LOST','PROVIDER_BREAKER_UNAVAILABLE']);
});
