import { strict as assert } from 'node:assert';
import { cpnuSourceObservation, cpnuNegativeEvidence } from './cpnuReadEvidence.ts';
import { fetchFromCpnu } from './cpnuAdapter.ts';
import { toOrchestratorResult } from './bridge.ts';

Deno.test('CPNU public outcomes, source clock, no indirect buscar, partial pagination', async () => {
  const savedFetch = globalThis.fetch;
  const names = ['CPNU_BASE_URL', 'CPNU_API_KEY'];
  const env = names.map(n => Deno.env.get(n));
  Deno.env.set('CPNU_BASE_URL', 'https://fixture.test');
  Deno.env.set('CPNU_API_KEY', 'local-fixture');
  const radicado = '05001400500620260049900';
  const observed = '2026-10-31T07:17:35.192Z';
  try {
    assert.equal(cpnuSourceObservation({fetchedAt: observed}), observed);
    assert.equal(cpnuSourceObservation({fetchedAt:'2026-10-31'}), undefined);
    assert.equal(cpnuSourceObservation({read_at: observed}), undefined);
    for (const [payload, code] of [
      [{found:false}, 'RECORD_NOT_FOUND'], [{restringido:true}, 'PROCESO_PRIVADO'],
      [{detalleCompleto:false}, 'PENDING_UPSTREAM'], [{success:false}, 'PENDING_UPSTREAM'],
    ] as const) {
      const calls: string[] = [];
      globalThis.fetch = async u => { calls.push(String(u)); return Response.json(payload); };
      const result = await fetchFromCpnu({radicado,mode:'monitoring',allowBuscar:false});
      assert.equal(result.status, 'ERROR');
      assert.equal(result.errorMessage, code);
      assert.equal(calls.length,1);
      assert(!calls.some(u=>u.includes('/buscar')));
    }
    globalThis.fetch = async () => Response.json({found:true,actuaciones:[],fetchedAt:observed,snapshot_origen:'memory'});
    const empty = await fetchFromCpnu({radicado,mode:'monitoring',allowBuscar:false});
    assert.equal(empty.status,'EMPTY');
    assert.equal(empty.sourceObservedAt,observed);
    const negative = {success:false,motivo:'PROCESO_NO_ENCONTRADO_EN_PROVEEDOR',
      interpretacion:'PROVEEDOR_NO_TIENE_EL_PROCESO',proveedor_consultado:true,ultima_consulta_proveedor_en:observed};
    globalThis.fetch = async () => Response.json(negative,{status:410});
    const absent = await fetchFromCpnu({radicado,mode:'monitoring',allowBuscar:false});
    assert.equal(absent.status,'ERROR');assert.equal(absent.errorMessage,'CPNU_PROVIDER_NOT_FOUND');
    assert.equal(absent.sourceObservedAt,observed);
    assert.equal(cpnuNegativeEvidence({...negative,proveedor_consultado:false}),'PENDING_UPSTREAM');
    globalThis.fetch = async () => Response.json({error:'Gone'},{status:410});
    assert.equal((await fetchFromCpnu({radicado,mode:'monitoring',allowBuscar:false})).errorMessage,'UPSTREAM_HTTP_410');
    globalThis.fetch = async () => Response.json({status:'ok'});
    assert.equal((await fetchFromCpnu({radicado,mode:'monitoring',allowBuscar:false})).errorMessage,'UNCLASSIFIED_PROVIDER_SHAPE');
    globalThis.fetch = async u => String(u).includes('pagina=2')
      ? new Response('unavailable',{status:503})
      : Response.json({found:true,fetchedAt:observed,actuaciones:[{actuacion:'Auto',fechaActuacion:'2026-10-30'}],paginacionActuaciones:{totalPaginas:2}});
    const partial = await fetchFromCpnu({radicado,mode:'monitoring',allowBuscar:false});
    assert.equal(partial.actuaciones.length,1);
    assert.equal(partial.sourceReadComplete,false);
    assert.equal(toOrchestratorResult(partial).sourceReadComplete,false);
    globalThis.fetch = async () => Response.json({error:'backend failure'},{status:500});
    assert.equal((await fetchFromCpnu({radicado,mode:'monitoring',allowBuscar:false})).status,'ERROR');
  } finally {
    globalThis.fetch = savedFetch;
    names.forEach((n,i) => env[i]===undefined?Deno.env.delete(n):Deno.env.set(n,env[i]!));
  }
});
