import { strict as assert } from 'node:assert';
import { certifiedStoredPPHistory, mayReadStoredPP } from './storedPublicationRead.ts';

const now=Date.parse('2026-11-02T00:10:00Z'),day='2026-11-01',rad='05001400301120260144800';
const admission={admitted:false,reason:'DAILY_UPDATE_ALREADY_STARTED',run_date:day,existing:{status:'PENDING_UPSTREAM'}};
const body={radicado:rad,backend_run_id:'480e06b5-07c9-44b5-a3dc-90608ceeb93d',consulta_completa:true,
  persistencia_completa:true,run_status:'SUCCESS_EMPTY',intento_observado_en:'2026-11-01T23:09:42.563295+00:00',
  ventana_solicitada:{desde:'2026-10-18',hasta:day},actuaciones:[]};
const result={ok:true,historicoRead:{body}};

Deno.test('a deferred terminal admission consumes a later persisted PP certificate with its original source clock',()=>{
 assert.equal(mayReadStoredPP(admission,'CGP'),true);
 assert.equal(certifiedStoredPPHistory(result,rad,day,now)?.intento_observado_en,body.intento_observado_en);
 assert.equal(body.actuaciones.length,0); // valid empty read, no fictional event
 assert.equal(mayReadStoredPP({...admission,existing:{status:'IN_PROGRESS'}},'CGP'),false);
 assert.equal(mayReadStoredPP(admission,'CPACA'),false);
});
Deno.test('partial, unpersisted, wrong-case, stale and old-window feeds never become complete',()=>{
 for(const changed of [{consulta_completa:false},{persistencia_completa:false},{radicado:'05001400301120240210000'},
  {run_status:'LECTURA_PARCIAL'},{intento_observado_en:'2026-10-31T21:00:00Z'},
  {intento_observado_en:'2026-11-03T01:00:00Z'},{ventana_solicitada:{desde:'2026-10-17',hasta:'2026-10-31'}}]){
  assert.equal(certifiedStoredPPHistory({ok:true,historicoRead:{body:{...body,...changed}}},rad,day,now),null);
 }
});
Deno.test('repeated stored consumption preserves the exact certificate and never refreshes its timestamp',()=>{
 const first=certifiedStoredPPHistory(result,rad,day,now);
 const repeated=certifiedStoredPPHistory(result,rad,day,now+600_000);
 assert.deepEqual(first,repeated);
 assert.equal(certifiedStoredPPHistory({ok:true,historicoRead:{body:{radicado:rad,actuaciones:[{id:'retained'}]}}},rad,day,now),null);
});
