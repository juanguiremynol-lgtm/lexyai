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
