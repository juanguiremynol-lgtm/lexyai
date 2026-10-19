import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fetchFromSamaiEstados, normalizeSamaiEstadosResponse } from '../../supabase/functions/_shared/providerAdapters/samaiEstadosAdapter.ts';
import { normalizeSamaiActuaciones } from '../../supabase/functions/_shared/providerAdapters/samaiAdapter.ts';
import { publicationDownloadUrls, samaiEstadosToProviderUnits } from '../../supabase/functions/_shared/samaiEstadosIngestion.ts';
import { canonicalPubIdentityFromRow, toCanonicalPubRow } from '../../supabase/functions/_shared/canonicalPublicacionMapper.ts';

const WI = '33333333-3333-3333-3333-333333333333';
const context = { work_item_id: WI, organization_id: '22222222-2222-2222-2222-222222222222', source: 'samai_estados', source_radicado: '99999233300020260000100' };
const estado = (id: number, suffix: string) => ({
  id,
  categoria: 'ESTADO',
  fuente: 'estados',
  source_act_id: `samai_estados_actuaciones:${id}`,
  'Fecha Providencia': '15/10/2026',
  fecha_providencia_iso: '2026-10-15',
  fecha_estado_iso: '2026-10-16',
  fecha_estado_procedencia: { fuente: 'SAMAI_WESTADOS', vinculo: 'hash_documento', fijacion_id: 51 },
  hash_documento: `origin-${id}`,
  'Actuación': `Auto que dispone publicar notificación ${suffix}`,
  'Docum. a notif.': `Anotación completa ${id}; no es el memorial de una actuación relacionada.`,
  actuaciones_relacionadas: ['samai_actuaciones:9'],
  documentos: [
    { id_documento: `documento-${id}-1`, urlDescarga: `https://example.invalid/${id}/providencia.pdf`, descripcion: 'Providencia' },
    { id_documento: `documento-${id}-2`, urlDescarga: `https://example.invalid/${id}/estado.pdf`, descripcion: 'Publicación' },
  ],
});
const act = { categoria: 'ACTUACION', fuente: 'expediente', source_act_id: 'samai_actuaciones:9', indice: 9, 'Fecha Providencia': '15/10/2026', 'Actuación': 'RECIBE MEMORIALES ONLINE', 'Docum. a notif.': 'Solicitud No. 9000001; Documentos anexos: 2.' };
const mixedFeed = { actuaciones: [act, estado(101, 'uno'), estado(102, 'dos')] };

function rowsFor(payload: unknown, ctx = context) {
  return samaiEstadosToProviderUnits(normalizeSamaiEstadosResponse(payload, { workItemId: ctx.work_item_id }))
    .map((unit) => toCanonicalPubRow(unit, ctx));
}

afterEach(() => vi.unstubAllGlobals());

describe('ingestión independiente de ESTADOS', () => {
  it('llama snapshot y lleva cada publicación y sus documentos hasta el registro del RPC', async () => {
    vi.stubGlobal('Deno', { env: { get: (key: string) => key === 'SAMAI_ESTADOS_BASE_URL' ? 'https://example.invalid/samai-estados' : undefined } });
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(mixedFeed), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const fetched = await fetchFromSamaiEstados({ radicado: context.source_radicado, mode: 'monitoring', workItemId: WI });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.invalid/samai-estados/snapshot');
    expect(fetched.actuaciones).toEqual([]);
    expect(fetched.publicaciones).toHaveLength(2);
    expect(fetched.publicaciones.map((p) => p.attachments?.length)).toEqual([2, 2]);
    const rows = samaiEstadosToProviderUnits(fetched.publicaciones).map((unit) => toCanonicalPubRow(unit, context));
    expect(new Set(rows.map((row) => row.hash_fingerprint)).size).toBe(2);
    rows.forEach((row, index) => {
      const id = index + 101;
      expect(row.raw_data).toMatchObject({ key: `samai_estados_actuaciones:${id}`, raw_data: { source_act_id: `samai_estados_actuaciones:${id}`, actuaciones_relacionadas: ['samai_actuaciones:9'], documentos: estado(id, '').documentos } });
      expect(row.annotation).toContain(`Anotación completa ${id}`);
      expect(row.fecha_fijacion?.slice(0, 10)).toBe('2026-10-16');
      expect(row.fecha_providencia?.slice(0, 10)).toBe('2026-10-15');
      expect(row.source_radicado).toBe(context.source_radicado);
      expect(canonicalPubIdentityFromRow(row, WI)).toBe(row.hash_fingerprint);
    });
    expect(normalizeSamaiActuaciones(mixedFeed.actuaciones, { workItemId: WI })).toHaveLength(1);
    expect(samaiEstadosToProviderUnits(fetched.publicaciones).map(publicationDownloadUrls)).toEqual([
      ['https://example.invalid/101/providencia.pdf', 'https://example.invalid/101/estado.pdf'],
      ['https://example.invalid/102/providencia.pdf', 'https://example.invalid/102/estado.pdf'],
    ]);
  });

  it('conserva los estados sin fecha de publicación acreditada sin inventar la fijación', () => {
    const raw = { ...estado(103, 'sin fecha'), fecha_estado_procedencia: undefined, fecha_estado_iso: undefined };
    const row = rowsFor({ actuaciones: [raw] })[0];
    expect(row.fecha_fijacion).toBeNull();
    expect(row.fecha_providencia?.slice(0, 10)).toBe('2026-10-15');
    expect((row.raw_data as any).raw_data.documentos).toHaveLength(2);
  });
});

// This opt-in uses ONLY the disposable database cloned by the local integration
// harness. It is deliberately independent of the sync_run database and never
// reads hosted credentials. The complete schema retains all real triggers/RPCs.
describe.skipIf(process.env.SAMAI_ESTADOS_RPC !== '1')('RPC real con esquema completo y datos aislados', () => {
  function sql(query: string) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG') && key !== 'SUPABASE_DB_URL'));
    return execFileSync('/tmp/itest/lpsql', ['-d', 'sync_estados', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8', env }).trim();
  }
  function invoke(rows: unknown[]) {
    const literal = JSON.stringify(rows).replace(/'/g, "''");
    return JSON.parse(sql(`select public.rpc_upsert_work_item_publicaciones('${literal}'::jsonb)`));
  }
  it('persiste publicaciones, documentos y relaciones; repetir no crea filas ni efectos nuevos', () => {
    const input = rowsFor(mixedFeed);
    const beforeActs = Number(sql('select count(*) from public.work_item_acts'));
    const first = invoke(input);
    expect(first.errors).toEqual([]);
    expect(first.inserted_count).toBe(2);
    const storedFirst = JSON.parse(sql(`select jsonb_agg(to_jsonb(p) order by p.hash_fingerprint) from public.work_item_publicaciones p where p.work_item_id='${WI}'`));
    const queueRecords = storedFirst.flatMap((saved: any) => publicationDownloadUrls(saved.raw_data).map((remote_url) => ({
      work_item_id: WI, organization_id: context.organization_id, publicacion_id: saved.id,
      remote_url, filename: remote_url.split('/').pop(), status: 'pending', attempt_count: 0, max_attempts: 5,
    })));
    // Same insert-if-absent semantics as the production Supabase upsert. The
    // queue is not consumed here: downloads remain simulated in this test.
    const enqueue = () => sql(`insert into estado_attachment_queue(work_item_id,organization_id,publicacion_id,remote_url,filename,status,attempt_count,max_attempts)
      select x.work_item_id,x.organization_id,x.publicacion_id,x.remote_url,x.filename,x.status,x.attempt_count,x.max_attempts
      from jsonb_populate_recordset(null::estado_attachment_queue,'${JSON.stringify(queueRecords).replace(/'/g, "''")}'::jsonb) x
      on conflict(publicacion_id,remote_url) do nothing`);
    enqueue();
    expect(queueRecords).toHaveLength(4);
    sql(`update estado_attachment_queue set attempt_count=2 where remote_url='https://example.invalid/101/estado.pdf'`);
    const queueBefore = sql('select jsonb_agg(jsonb_build_object(\'id\',id,\'url\',remote_url,\'publication\',publicacion_id,\'attempts\',attempt_count) order by remote_url) from estado_attachment_queue');
    const effects = sql(`select jsonb_build_object('alerts',(select count(*) from alert_instances),'notifications',(select count(*) from notifications),'deadlines',(select count(*) from work_item_deadlines),'attachments',(select count(*) from estado_attachment_queue))`);
    const second = invoke(input);
    expect(second.errors).toEqual([]);
    expect(second.inserted_count).toBe(0);
    enqueue();
    expect(sql('select jsonb_agg(jsonb_build_object(\'id\',id,\'url\',remote_url,\'publication\',publicacion_id,\'attempts\',attempt_count) order by remote_url) from estado_attachment_queue')).toBe(queueBefore);
    // A later partial response must not remove known attachments/relationships.
    const partial = input.map((row) => ({ ...row, raw_data: { ...(row.raw_data as any), raw_data: { ...(row.raw_data as any).raw_data, documentos: [], actuaciones_relacionadas: [] } } }));
    expect(invoke(partial).errors).toEqual([]);
    const storedSecond = JSON.parse(sql(`select jsonb_agg(to_jsonb(p) order by p.hash_fingerprint) from public.work_item_publicaciones p where p.work_item_id='${WI}'`));
    expect(storedSecond.map((row: any) => row.id)).toEqual(storedFirst.map((row: any) => row.id));
    expect(storedSecond).toHaveLength(2);
    storedSecond.forEach((row: any) => {
      expect(row.raw_data.raw_data.documentos).toHaveLength(2);
      expect(row.raw_data.raw_data.actuaciones_relacionadas).toEqual(['samai_actuaciones:9']);
      expect(row.fecha_fijacion?.slice(0, 10)).toBe('2026-10-16');
      expect(row.fecha_providencia?.slice(0, 10)).toBe('2026-10-15');
      expect(row.source).toBe('samai_estados');
    });
    expect(sql(`select jsonb_build_object('alerts',(select count(*) from alert_instances),'notifications',(select count(*) from notifications),'deadlines',(select count(*) from work_item_deadlines),'attachments',(select count(*) from estado_attachment_queue))`)).toBe(effects);
    expect(Number(sql('select count(*) from public.work_item_acts'))).toBe(beforeActs);
    // A separately identified estado is never allowed to overwrite this row.
    const conflicting = { ...input[0], raw_data: { ...(input[0].raw_data as any), raw_data: { ...(input[0].raw_data as any).raw_data, source_act_id: 'samai_estados_actuaciones:999' } } };
    const conflict = invoke([conflicting]);
    expect(conflict.rejected_count).toBe(1);
    expect(conflict.errors.join(' ')).toContain('SAMAI_PUBLICATION_ORIGIN_CONFLICT');
    expect(sql(`select raw_data #>> '{raw_data,source_act_id}' from work_item_publicaciones where hash_fingerprint='${input[0].hash_fingerprint}' and work_item_id='${WI}'`)).toBe('samai_estados_actuaciones:101');
    if (process.env.SAMAI_ESTADOS_EVIDENCE) writeFileSync(process.env.SAMAI_ESTADOS_EVIDENCE, JSON.stringify({ kind: 'isolated replay; mocked upstream HTTP; real production RPC and full schema; queue inserts execute SQL equivalent to insert-if-absent; worker/download not run', first, second, conflict, stored: storedSecond, queue: JSON.parse(queueBefore), effects: JSON.parse(effects) }, null, 2));
  });

  it.skipIf(!process.env.SAMAI_ESTADOS_CAPTURE)('reproduce la publicación real preservada en la auditoría sin nuevas consultas remotas', () => {
    const captured = JSON.parse(readFileSync(process.env.SAMAI_ESTADOS_CAPTURE!, 'utf8')).filas[0].raw_data.raw_data;
    const capturedWI = '44444444-4444-4444-4444-444444444444';
    const capturedRadicado = String(captured.Radicacion).replace(/\D/g, '');
    expect(capturedRadicado).toMatch(/^\d{23}$/);
    sql(`insert into work_items(id,owner_id,organization_id,workflow_type,stage,radicado,monitoring_enabled,created_at)
      select '${capturedWI}',owner_id,organization_id,workflow_type,stage,'${capturedRadicado}',false,created_at
      from work_items where id='${WI}'`);
    const [row] = rowsFor({ actuaciones: [captured] }, { ...context, work_item_id: capturedWI, source_radicado: capturedRadicado });
    const first = invoke([row]);
    expect(first.errors).toEqual([]);
    expect(first.inserted_count).toBe(1);
    const second = invoke([row]);
    expect(second.errors).toEqual([]);
    expect(second.inserted_count).toBe(0);
    const saved = JSON.parse(sql(`select to_jsonb(p) from work_item_publicaciones p where hash_fingerprint='${row.hash_fingerprint}' and work_item_id='${capturedWI}'`));
    expect(saved.raw_data.raw_data.hash_documento).toBe(captured.hash_documento);
    expect(saved.pdf_url).toBe(row.pdf_url);
    expect(saved.raw_data.raw_data.pdf_url).toBe(captured.pdf_url);
    expect(saved.raw_data.raw_data.url_descarga).toBe(captured.url_descarga);
    expect(saved.fecha_fijacion).toBeNull();
    expect(saved.fecha_providencia.slice(0, 10)).toBe(captured.fecha_providencia_iso);
    expect(saved.annotation).toBe(captured['Docum. a notif.']);
    expect(saved.source_radicado).toBe(capturedRadicado);
    if (process.env.SAMAI_ESTADOS_EVIDENCE) writeFileSync(process.env.SAMAI_ESTADOS_EVIDENCE.replace(/\.json$/, '-captured.json'), JSON.stringify({ kind: 'replay of captured real upstream row into isolated complete schema; no remote query/download', first, second, saved }, null, 2));
  });
});
