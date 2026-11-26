import { assertEquals } from 'jsr:@std/assert@1';
import {
  explodeProviderPublicaciones, toCanonicalPubRow, mapProviderPayloadToCanonicalPubRows, canonicalPubIdentityFromRow,
} from './canonicalPublicacionMapper.ts';
import { ppExplicitPublicationDates, ppPublicationAttributionConflict } from './ppExplicitPublicationDates.ts';
import { normalizePublicacionesResponse } from './providerAdapters/publicacionesAdapter.ts';
import { matchingPartialHistory } from './ppDurableContract.ts';
import { hasUnaccreditedAssociationFlag, resolvePPDateRoles } from './ppDateRoles.ts';

const rad = '05001310302120250021100';
const wi = '11111111-1111-4111-8111-111111111111';
const ctx = { work_item_id: wi, organization_id: null, source: 'publicaciones', source_radicado: rad };
const modern = (estado: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  fecha: '2026-10-20', fecha_auto: '2026-10-19', fecha_providencia_impresa: '2026-02-10',
  estado: { article_id: '284836437', numero: '154', fecha_publicacion: '2026-10-20', pdf_nombre: 'Estado 154.pdf',
    pdf_url: 'https://example.test/e.pdf', ...estado },
  documentos_pdf: [{ tipo: 'estado', titulo: 'Estado 154.pdf', fecha: '2026-10-20', pdf_url: 'https://example.test/e.pdf' }],
  documento_atribucion: { radicado: rad },
  ...extra,
});

Deno.test('same modern payload: adapter, full mapper, bridge identity and writer agree', () => {
  const raw = modern({ fecha_publicacion_portal: '2026-10-20', fecha_fijacion_impresa: '2026-02-12' });
  const payload = { actuaciones: [raw] };
  const writer = ppExplicitPublicationDates(explodeProviderPublicaciones(payload)[0], ctx);
  const mapped = mapProviderPayloadToCanonicalPubRows(payload, ctx)[0];
  const adapter = normalizePublicacionesResponse(payload, { workItemId: wi, radicado: rad } as any)[0];
  assertEquals(writer.fecha_fijacion?.slice(0, 10), '2026-02-12');
  assertEquals(writer.published_at?.slice(0, 10), '2026-10-20');
  assertEquals(writer.fecha_providencia?.slice(0, 10), '2026-02-10');
  for (const k of ['fecha_fijacion', 'published_at', 'fecha_providencia', 'hash_fingerprint'] as const)
    assertEquals(mapped[k], writer[k]);
  assertEquals(adapter.hash_fingerprint, writer.hash_fingerprint);
  assertEquals(adapter.fecha_fijacion, '2026-02-12');
  // bridge-reconcile recomputes identity from the stored row
  assertEquals(canonicalPubIdentityFromRow(writer, wi), writer.hash_fingerprint);
});

Deno.test('unknown printed fixation stays NULL; portal never fills it; moving portal keeps legal date and identity', () => {
  const unk = toCanonicalPubRow(explodeProviderPublicaciones([modern({ fecha_publicacion_portal: '2026-10-20' })])[0], ctx);
  assertEquals(unk.fecha_fijacion, null);
  assertEquals(unk.published_at?.slice(0, 10), '2026-10-20');
  const a = toCanonicalPubRow(explodeProviderPublicaciones([modern({ fecha_publicacion_portal: '2026-10-20', fecha_fijacion_impresa: '2026-02-12' })])[0], ctx);
  const b = toCanonicalPubRow(explodeProviderPublicaciones([modern({ fecha_publicacion_portal: '2026-10-27', fecha_fijacion_impresa: '2026-02-12' })])[0], ctx);
  assertEquals(a.fecha_fijacion, b.fecha_fijacion);
  assertEquals(a.hash_fingerprint, b.hash_fingerprint);
  const adapterUnk = normalizePublicacionesResponse({ actuaciones: [modern({ fecha_publicacion_portal: '2026-10-20' })] }, { workItemId: wi, radicado: rad } as any)[0];
  assertEquals(adapterUnk.fecha_fijacion, '');
  assertEquals(adapterUnk.hash_fingerprint, unk.hash_fingerprint);
});

Deno.test('legacy payload without roles: resolver abstains and mapper output is unchanged', () => {
  const legacy = { fecha: '2026-10-21', estado: { article_id: '1', numero: '4', fecha_publicacion: '2026-10-21' } };
  assertEquals(resolvePPDateRoles(legacy, rad), null);
  const unit = explodeProviderPublicaciones([legacy])[0];
  assertEquals(toCanonicalPubRow(unit, ctx).fecha_fijacion?.slice(0, 10), '2026-10-21');
});

Deno.test('SAMAI ignores PP role fields', () => {
  const unit = { ...explodeProviderPublicaciones([modern({ fecha_publicacion_portal: '2026-10-20', fecha_fijacion_impresa: '2026-02-12' })])[0], _source_provider: 'samai_estados' };
  const row = toCanonicalPubRow(unit, ctx);
  assertEquals(row.fecha_fijacion, null);
  assertEquals(row.source, 'samai_estados');
});

const flagged = [true, { fuente: 'x' }, [], ['a'], 'revisar', {}];
const clean = [false, null, undefined, ''];

Deno.test('attribution warning: true/object/array/string rejected by both guards; false/null/absent keep semantics', () => {
  for (const f of flagged) {
    assertEquals(hasUnaccreditedAssociationFlag(f), true);
    const raw = modern({ fecha_publicacion_portal: '2026-10-20' }, { documento_atribucion: { radicado: rad, asociacion_no_acreditada: f } });
    const unit = explodeProviderPublicaciones([raw])[0];
    assertEquals(ppPublicationAttributionConflict(unit, rad), true);
  }
  for (const f of clean) {
    const raw = modern({ fecha_publicacion_portal: '2026-10-20' }, { documento_atribucion: { radicado: rad, ...(f === undefined ? {} : { asociacion_no_acreditada: f }) } });
    assertEquals(ppPublicationAttributionConflict(explodeProviderPublicaciones([raw])[0], rad), false);
  }
  // Different instance (…00 vs …01) and different radicado are rejected.
  const other = modern({}, { documento_atribucion: { radicado: rad.slice(0, 21) + '01' } });
  assertEquals(ppPublicationAttributionConflict(explodeProviderPublicaciones([other])[0], rad), true);
});

const runId = '5f2b1c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const partial = (rows: unknown[]) => ({ backend_run_id: runId, radicado: rad, consulta_completa: false,
  persistencia_completa: true, intento_observado_en: '2026-11-25T23:00:00Z', publicaciones: rows });
const prow = (a: Record<string, unknown>) => ({ estado: { article_id: '284836437' }, documento_atribucion: { radicado: rad, paginas_fuente: [1], ...a } });

Deno.test('matchingPartialHistory rejects flagged rows, keeps indices, never certifies completeness', () => {
  const rows = [prow({}), ...flagged.map(f => prow({ asociacion_no_acreditada: f })), prow({ asociacion_no_acreditada: false }), prow({ radicado: rad.slice(0, 21) + '01' })];
  const r = matchingPartialHistory(partial(rows), rad, runId)!;
  assertEquals(r.accepted, 2);
  assertEquals(r.rejected, [1, 2, 3, 4, 5, 6, 8]);
  assertEquals(r.body.backend_run_id, runId);
  assertEquals(r.body.consulta_completa, false);
  const all = matchingPartialHistory(partial(flagged.map(f => prow({ asociacion_no_acreditada: f }))), rad, runId)!;
  assertEquals(all.accepted, 0);
  assertEquals(all.rejected.length, flagged.length);
  assertEquals(all.body.consulta_completa, false);
});
