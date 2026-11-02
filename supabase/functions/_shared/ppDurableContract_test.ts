import { durableVerdict, matchingCompletedHistory, terminalDurableRun } from './ppDurableContract.ts';

function eq(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const id = '21e9c43b-f2fd-4bb3-9247-01169937cad8';
const trace = 'ce4e7809-70f7-4c13-b373-7cb6f0082e0c';

Deno.test('202 admission remains pending and preserves identifiers', () => {
  eq(durableVerdict(202, {backend_run_id:id, trazabilidad_id:trace, estado:'ADMITIDA', consulta_completa:false}),
    {kind:'pending', runId:id, traceId:trace, reason:'PP_RUN_PENDING'});
  eq(durableVerdict(200, {backend_run_id:id, trazabilidad_id:trace, estado:'EN_CURSO', consulta_completa:false}, id).kind, 'pending');
});
Deno.test('4xx, invalid or conflicting identity, and partial are never accepted', () => {
  eq(durableVerdict(409, {detail:'alcance incompatible'}), {kind:'error', runId:null, traceId:null, reason:'HTTP 409: alcance incompatible'});
  eq(durableVerdict(401, {}).kind, 'error');
  eq(durableVerdict(202, {estado:'ADMITIDA'}).kind, 'error');
  eq(durableVerdict(200, {backend_run_id:id,estado:'COMPLETA',consulta_completa:true}, '45d1830d-58b8-4f61-9172-646562ab1471').kind, 'error');
  eq(durableVerdict(200, {backend_run_id:id,estado:'PARCIAL',motivo_parcial:'ENUMERACION_INCOMPLETA'}).kind, 'error');
  eq(durableVerdict(200, {backend_run_id:id,estado:'EN_CURSO',consulta_completa:true}).kind, 'error');
});
Deno.test('complete requires both a complete ticket and its matching persisted history', () => {
  eq(durableVerdict(200, {backend_run_id:id,estado:'COMPLETA',consulta_completa:true}).kind, 'complete');
  eq(durableVerdict(200, {backend_run_id:id,estado:'COMPLETA',consulta_completa:false}).kind, 'error');
  eq(matchingCompletedHistory(id, {backend_run_id:id,consulta_completa:true,run_status:'SUCCESS_EMPTY'}), true);
  eq(matchingCompletedHistory(id, {backend_run_id:id,consulta_completa:true,run_status:'SUCCESS_WITH_DATA',persistencia_completa:false}), false);
  eq(matchingCompletedHistory(id, {backend_run_id:'other',consulta_completa:true,run_status:'SUCCESS_EMPTY'}), false);
  eq(matchingCompletedHistory(id, {backend_run_id:id,consulta_completa:false,run_status:'SUCCESS_EMPTY'}), false);
});

Deno.test('terminal partial positives close polling without certifying success; live and replaced runs stay open', () => {
  const rad='05001400300120250154400';
  const b={backend_run_id:id,radicado:rad,estado:'PARCIAL',consulta_completa:false};
  eq(terminalDurableRun(b,rad,id),true);
  eq(durableVerdict(200,b,id).kind,'error');
  eq(terminalDurableRun({...b,estado:'FALLIDA'},rad,id),true);
  eq(terminalDurableRun({...b,estado:'ADMITIDA'},rad,id),false);
  eq(terminalDurableRun({...b,estado:'EN_CURSO'},rad,id),false);
  eq(terminalDurableRun({...b,backend_run_id:'other'},rad,id),false);
  eq(terminalDurableRun({...b,radicado:'other'},rad,id),false);
  eq(terminalDurableRun({...b,consulta_completa:true},rad,id),false);
});
