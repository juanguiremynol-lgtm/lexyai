// Import the handler without opening a socket. All provider traffic is mocked.
const originalServe = Deno.serve;
(Deno as unknown as {serve: unknown}).serve = () => ({ finished: Promise.resolve() });
const { tryProcesarFallback, fetchPublicaciones } = await import('./index.ts');
(Deno as unknown as {serve: unknown}).serve = originalServe;

const id = '21e9c43b-f2fd-4bb3-9247-01169937cad8';
const trace = 'ce4e7809-70f7-4c13-b373-7cb6f0082e0c';
const headers = {'Content-Type':'application/json'};
function response(value: unknown, status = 200) {return new Response(JSON.stringify(value), {status, headers});}
function check(value: unknown, message: string) {if (!value) throw new Error(message);}
async function withMock(mock: typeof fetch, run: () => Promise<void>) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try {await run();} finally {globalThis.fetch = previous;}
}
Deno.test('202 admission remains pending with IDs and one bounded status read', async () => {
  const calls: string[] = [];
  await withMock(async (input) => {
    calls.push(String(input));
    return calls.length === 1
      ? response({backend_run_id:id,trazabilidad_id:trace,estado:'ADMITIDA',consulta_completa:false},202)
      : response({backend_run_id:id,trazabilidad_id:trace,estado:'EN_CURSO',consulta_completa:false});
  }, async () => {
    const result = await tryProcesarFallback('https://pp.invalid','05001400300120250154400',headers);
    check(result?.resultCode === 'NO_DATA' && result.readIncomplete === true, 'admission was not pending');
    check(result?.procesarAck?.body?.backend_run_id === id && result?.procesarAck?.body?.trazabilidad_id === trace, 'IDs lost');
    check(calls.length === 2 && calls[1].endsWith(`/runs/${id}`), 'poll must be bounded');
  });
});
Deno.test('HTTP 409 remains an error, not PROCESSING_TRIGGERED', async () => {
  await withMock(async () => response({detail:'alcance incompatible'},409), async () => {
    const result = await tryProcesarFallback('https://pp.invalid','05001400300120250154400',headers);
    check(result?.ok === false && result.httpStatus === 409 && result.error?.includes('alcance incompatible'), '409 was hidden');
  });
});
Deno.test('completed job requires corresponding readable history', async () => {
  const body = {backend_run_id:id,trazabilidad_id:trace,estado:'COMPLETA',consulta_completa:true};
  const history = {radicado:'05001400300120250154400',backend_run_id:id,consulta_completa:true,run_status:'SUCCESS_EMPTY',actuaciones:[],
    busqueda:{fuente:'db',procesado:true,ultima_sync:new Date().toISOString()}};
  await withMock(async (input) => String(input).includes('/historico/') ? response(history) : response(body,202), async () => {
    const result = await tryProcesarFallback('https://pp.invalid','05001400300120250154400',headers);
    check(result?.durableCompleted === true && result.resultCode === 'SUCCESS', 'completed history was not read');
  });
  await withMock(async (input) => String(input).includes('/historico/') ? response({...history,backend_run_id:'other'}) : response(body,202), async () => {
    const result = await tryProcesarFallback('https://pp.invalid','05001400300120250154400',headers);
    check(result?.durableCompleted !== true && result?.readIncomplete === true, 'mismatched history was certified');
  });
});
Deno.test('admission timeout is error, never an invented accepted job', async () => {
  await withMock(async () => {throw new DOMException('timeout','AbortError');}, async () => {
    const result = await tryProcesarFallback('https://pp.invalid','05001400300120250154400',headers);
    check(result?.ok === false && result.error?.startsWith('PP_ADMISSION_TIMEOUT'), 'timeout was treated as accepted');
  });
});

Deno.test('historical empty never hides a rejected admission', async () => {
  const seen: string[] = [];
  await withMock(async (input) => {
    seen.push(String(input));
    return String(input).includes('/historico/')
      ? response({actuaciones:[],busqueda:{fuente:'db',procesado:false},consulta_completa:false})
      : response({detail:'alcance incompatible'},409);
  }, async () => {
    const result = await fetchPublicaciones('05001400300120250154400','https://pp.invalid','test', {allow:true});
    check(result.ok === false && result.httpStatus === 409 && result.error?.includes('alcance incompatible'), 'old empty hid rejection');
    check(seen.length === 2, 'unexpected request count');
  });
});
Deno.test('cached historical records are retained but do not turn pending into success', async () => {
  await withMock(async (input) => {
    if (String(input).includes('/historico/')) return response({actuaciones:[{descripcion:'estado',estado:{article_id:'1',titulo_original:'Estado 1',fecha_publicacion:'2026-10-28'}}],busqueda:{fuente:'db',procesado:true,ultima_sync:'2026-01-01T00:00:00Z'},consulta_completa:false});
    if (String(input).includes('/runs/')) return response({backend_run_id:id,trazabilidad_id:trace,estado:'EN_CURSO',consulta_completa:false});
    return response({backend_run_id:id,trazabilidad_id:trace,estado:'ADMITIDA',consulta_completa:false},202);
  }, async () => {
    const result = await fetchPublicaciones('05001400300120250154400','https://pp.invalid','test', {allow:true});
    check(result.readIncomplete === true && result.procesarAck?.body?.backend_run_id === id, 'pending ticket not preserved');
    check(result.publicaciones.length > 0, 'cached inventory was dropped');
  });
});

Deno.test('fresh-looking cached data without a durable certificate is pending', async () => {
  await withMock(async () => response({radicado:'05001400300120250154400',actuaciones:[{descripcion:'estado',estado:{article_id:'1',titulo_original:'Estado 1',fecha_publicacion:'2026-10-28'}}],run_status:'SUCCESS_WITH_DATA',busqueda:{fuente:'db',procesado:true,ultima_sync:new Date().toISOString()}}), async () => {
    const result = await fetchPublicaciones('05001400300120250154400','https://pp.invalid','test',{allow:false});
    check(result.publicaciones.length > 0 && result.readIncomplete === true, 'uncertified historical result treated as completed');
  });
});
