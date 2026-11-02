// Follow-up of a stored admitted run: GET /runs only, never a new POST.
const originalServe = Deno.serve;
(Deno as unknown as {serve: unknown}).serve = () => ({ finished: Promise.resolve() });
const { followAdmittedRun } = await import('./index.ts');
(Deno as unknown as {serve: unknown}).serve = originalServe;

const id = '0233cc45-1944-44f8-bafb-7580b4cddace';
const rad = '05376311200120261033300';
const json = {'Content-Type':'application/json'};
const res = (v: unknown, s = 200) => new Response(JSON.stringify(v), {status: s, headers: json});
function check(v: unknown, m: string) { if (!v) throw new Error(m); }
async function withMock(mock: (url: string, init?: RequestInit) => Response, run: () => Promise<void>) {
  const prev = globalThis.fetch;
  globalThis.fetch = (async (i: RequestInfo | URL, init?: RequestInit) => mock(String(i), init)) as typeof fetch;
  try { await run(); } finally { globalThis.fetch = prev; }
}

Deno.test('EN_CURSO follow-up is pending, live-polled, and never POSTs', async () => {
  const calls: string[] = [];
  await withMock((u, init) => { calls.push(`${init?.method ?? 'GET'} ${u}`); return res({backend_run_id:id,trazabilidad_id:'t',estado:'EN_CURSO',consulta_completa:false}); }, async () => {
    const r = await followAdmittedRun(rad, 'https://pp.invalid', 'k', id);
    check(r.ok && r.readIncomplete === true && r.resultCode === 'NO_DATA', 'must stay pending');
    check(r.runStatusRead?.http_status === 200 && r.runStatusRead?.run_id === id, 'live read not recorded');
    check(calls.length === 1 && calls[0] === `GET https://pp.invalid/runs/${id}`, `unexpected calls ${calls}`);
  });
});

Deno.test('unknown run (404) is an explicit failure, not success nor new extraction', async () => {
  const calls: string[] = [];
  await withMock((u, init) => { calls.push(`${init?.method ?? 'GET'} ${u}`); return res({detail:'not found'}, 404); }, async () => {
    const r = await followAdmittedRun(rad, 'https://pp.invalid', 'k', id);
    check(!r.ok && r.resultCode === 'ERROR' && /404/.test(r.error ?? ''), 'must fail explicitly');
    check(calls.every((c) => c.startsWith('GET ')), 'no POST allowed');
  });
});

Deno.test('completed run without certified history stays pending', async () => {
  await withMock((u) => u.includes('/runs/')
    ? res({backend_run_id:id,estado:'COMPLETA',consulta_completa:true})
    : res({radicado:rad,backend_run_id:'other',consulta_completa:false}), async () => {
    const r = await followAdmittedRun(rad, 'https://pp.invalid', 'k', id);
    check(r.ok && r.readIncomplete === true && !r.durableCompleted, 'uncertified history must not complete');
  });
});

Deno.test('stored body is sanitized to bounded scalars without secrets', async () => {
  const { sanitizeRunBody } = await import('./index.ts');
  const o = sanitizeRunBody({ estado: 'ADMITIDA', api_key: 'x', checkpoint: { p: 3 }, n: 1 })!;
  check(o.estado === 'ADMITIDA' && !('api_key' in o) && o.checkpoint === '{"p":3}' && o.n === 1, 'bad sanitize');
});

const partialStatus = () => ({backend_run_id:id,radicado:rad,estado:'PARCIAL',consulta_completa:false,
  eventos_detectados:1,intento_observado_en:'2026-11-01T18:00:00Z'});
const positive = {descripcion:'Auto admisorio',fecha:'2026-10-21',estado:{article_id:'274600832',numero:'039',fecha_publicacion:'2026-10-22'},
  documento_atribucion:{radicado:rad,paginas_fuente:[2],paquete:{radicado:rad,paginas_caso:[[2,2]]}}};
const partialHistory = () => ({radicado:rad,backend_run_id:id,consulta_completa:false,persistencia_completa:true,
  run_status:'LECTURA_PARCIAL',intento_observado_en:'2026-11-01T18:00:00Z',actuaciones:[positive]});
Deno.test('persisted positive rows survive partial coverage: exact stored GET, original clock, no POST', async () => {
  const calls: string[] = [];
  await withMock((u, init) => {calls.push(`${init?.method ?? 'GET'} ${u}`); return res(u.includes('/runs/') ? partialStatus() : partialHistory());}, async () => {
    const r = await followAdmittedRun(rad,'https://pp.invalid','k',id);
    check(r.ok && r.readIncomplete && !r.durableCompleted, 'partial data must never certify coverage');
    check(r.publicaciones.length > 0 && r.persistedPartial?.accepted === 1, 'persisted positives disappeared');
    check(r.persistedPartial?.sourceObservedAt === '2026-11-01T18:00:00Z', 'source clock changed on ingest');
    check(calls.length === 2 && calls[1].endsWith(`backend_run_id=${id}`) && calls.every(x=>x.startsWith('GET ')), 'must read the exact stored UUID only');
  });
});
Deno.test('partial history rejects different run, process or failed persistence', async () => {
  for (const change of [{backend_run_id:'other'},{radicado:'05001400303420260089800'},{persistencia_completa:false}]) {
    await withMock((u) => res(u.includes('/runs/') ? partialStatus() : {...partialHistory(),...change}), async () => {
      const r = await followAdmittedRun(rad,'https://pp.invalid','k',id);
      check(r.readIncomplete && r.publicaciones.length === 0 && !r.durableCompleted, 'invalid persisted history accepted');
    });
  }
});
Deno.test('partial rows require exact native process, article and attributed pages; rejections stay explicit', async () => {
  await withMock((u) => res(u.includes('/runs/') ? partialStatus() : {...partialHistory(),actuaciones:[positive,
    {...positive,documento_atribucion:{radicado:'05001400303420260089800',paginas_fuente:[2]}},
    {...positive,documento_atribucion:{radicado:rad,paginas_fuente:[]}},
    {...positive,estado:{article_id:'wrong'}}]}), async () => {
    const r = await followAdmittedRun(rad,'https://pp.invalid','k',id);
    check(r.persistedPartial?.accepted === 1 && JSON.stringify(r.persistedPartial.rejected) === '[1,2,3]', 'unverified rows were accepted or silently dropped');
    check((r.historicoRead?.body as any)?.actuaciones?.length === 4, 'original reader evidence lost');
  });
});
Deno.test('partial read without persisted positive evidence never fetches history', async () => {
  let n=0;
  await withMock(() => {n++;return res({...partialStatus(),eventos_detectados:0});}, async () => {
    const r=await followAdmittedRun(rad,'https://pp.invalid','k',id);
    check(n===1 && !r.ok && r.publicaciones.length===0,'unproductive follow-up');
  });
});
