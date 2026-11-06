import { strict as assert } from 'node:assert';
import { certifiedHistoricalRows, parseHistoricalWindow } from './ppHistoricalReplay.ts';
const now = Date.parse('2026-11-06T14:00:00Z');
const rad='05001400300120250012300', id='f5c1fa1d-a06f-439d-a947-959bc2c2f68d';
const w={backend_run_id:id,desde:'2026-03-12',hasta:'2026-03-12'};
const checkpoint={desde:w.desde,hasta:w.hasta,siguiente_desde:'2026-03-13'};
const run={backend_run_id:id,radicado:rad,estado:'COMPLETA',consulta_completa:true,persistencia_completa:true,
  alcance_efectivo_acreditado:true,checkpoint,intento_observado_en:'2026-11-06T13:01:57Z'};
function row() {return {fecha:'11/03/2026',fecha_iso:'2026-03-11',estado:{article_id:'123456',fecha_publicacion:'12/03/2026'},
  documento_atribucion:{radicado:rad,fila_estado:{metodo:'pdfplumber_celdas_despacho_acreditado',
    prueba_despacho:'PRINTED_COURT_AND_VERIFIED_DEPARTMENT',despacho_acreditado:rad.slice(0,12),
    identidad_celda:'2025-00123',article_id:'123456',pagina:1,tabla:1,fila:6,id_origen:'123456:p1:t1:r6'}}};}
function history() {return {backend_run_id:id,radicado:rad,consulta_completa:true,persistencia_completa:true,
  run_status:'SUCCESS_WITH_DATA',ventana_solicitada:checkpoint,intento_observado_en:run.intento_observado_en,actuaciones:[row()]};}

Deno.test('bounded historical request validates calendar, UUID and future dates',()=>{
  assert.deepEqual(parseHistoricalWindow(w,now),w);
  for(const v of [{...w,backend_run_id:'bad'}, {...w,desde:'2026-02-30'}, {...w,hasta:'2026-11-07'},
    {...w,desde:'2026-03-13'}, {...w,desde:'2020-01-01'}, null]) assert.equal(parseHistoricalWindow(v,now),null);
});
Deno.test('matching stored historical certificate retains only rows in its exact window',()=>{
  const outside={...row(),estado:{...row().estado,article_id:'999',fecha_publicacion:'15/10/2026'}};
  const result=certifiedHistoricalRows(run,{...history(),actuaciones:[row(),outside]},rad,w,now);
  assert.equal(result?.accepted,1);assert.equal(result?.outside,1);
  assert.equal(result?.body.actuaciones[0].recuperacion_historica.ventana.desde,'2026-03-12');
  assert.equal(result?.body.actuaciones[0].recuperacion_historica.cobertura_documental,'no_evaluada');
});
Deno.test('run, source, scope, persistence, timing and row attribution all fail closed',()=>{
  const invalidRuns=[{...run,radicado:'other'}, {...run,estado:'PARCIAL'}, {...run,persistencia_completa:false},
    {...run,alcance_efectivo_acreditado:false}, {...run,checkpoint:{...checkpoint,hasta:'2026-03-13'}},
    {...run,intento_observado_en:'2026-11-07T00:00:00Z'}];
  for(const r of invalidRuns) assert.equal(certifiedHistoricalRows(r,history(),rad,w,now),null);
  const missingAttribution={...row(),documento_atribucion:null};
  const wrongCase={...row(),documento_atribucion:{...row().documento_atribucion,radicado:'other'}};
  for(const h of [{...history(),backend_run_id:'other'}, {...history(),persistencia_completa:false},
    {...history(),ventana_solicitada:{...checkpoint,desde:'2026-03-11'}},
    {...history(),actuaciones:[missingAttribution]}, {...history(),actuaciones:[wrongCase]},
    {...history(),actuaciones:[{...row(),estado:{article_id:'123456'}}]}])
    assert.equal(certifiedHistoricalRows(run,h,rad,w,now),null);
});
