import { strict as assert } from 'node:assert';
import { completedDailyReference } from './ppDurableContract.ts';
Deno.test('daily reference requires exact case, complete current window and verified scope',()=>{
  const now=Date.parse('2026-10-31T20:00:00Z');const rad='05030318900120250000200';
  const daily={radicado:rad,tipo_cobertura:'RECIENTE',backend_run_id:'00000000-0000-4000-8000-000000000001',trazabilidad_id:'00000000-0000-4000-8000-000000000002',
    estado:'COMPLETA',consulta_completa:true,alcance_efectivo_acreditado:true,checkpoint:{desde:'2026-10-17',hasta:'2026-10-31'}};
  const parent={radicado:rad,estado:'ADMITIDA',consulta_completa:false,consulta_diaria:daily};
  assert.equal(completedDailyReference(parent,rad,now),daily);
  assert.equal(parent.estado,'ADMITIDA'); // never complete the historical parent
  for(const change of [{radicado:rad.slice(0,-1)+'1'},{estado:'PARCIAL',consulta_completa:false},
    {alcance_efectivo_acreditado:false},{checkpoint:{desde:'2026-10-17',hasta:'2026-10-30'}},
    {checkpoint:{desde:'2026-10-20',hasta:'2026-10-31'}}])
    assert.equal(completedDailyReference({...parent,consulta_diaria:{...daily,...change}},rad,now),null);
});
