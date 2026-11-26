import { assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { explodeProviderPublicaciones, canonicalPubIdentityFromRow } from '../_shared/canonicalPublicacionMapper.ts';
import { ppExplicitPublicationDates } from '../_shared/ppExplicitPublicationDates.ts';
import { normalizePublicacionesResponse } from '../_shared/providerAdapters/publicacionesAdapter.ts';
import { groupProviderRows, legalIdentity } from './identity.ts';

const rad = '05001310302120250021100';
const wi = '11111111-1111-4111-8111-111111111111';
const ctx = { work_item_id: wi, organization_id: null, source: 'publicaciones', source_radicado: rad };
const modern = (portal: string, fij?: string) => ({
  fecha: portal, fecha_auto: portal, fecha_providencia_impresa: '2026-02-10',
  estado: { article_id: 'A' + portal, numero: '154', fecha_publicacion: portal, fecha_publicacion_portal: portal,
    ...(fij ? { fecha_fijacion_impresa: fij } : {}), pdf_nombre: 'Estado 154.pdf', pdf_url: 'https://example.test/e.pdf' },
  documentos_pdf: [{ tipo: 'estado', titulo: 'Estado 154.pdf', fecha: portal, pdf_url: 'https://example.test/e.pdf' }],
  documento_atribucion: { radicado: rad },
});
const pair = (raw: Record<string, unknown>) => {
  const payload = { actuaciones: [raw] };
  return {
    writer: ppExplicitPublicationDates(explodeProviderPublicaciones(payload)[0], ctx),
    adapter: normalizePublicacionesResponse(payload, { workItemId: wi, radicado: rad } as any)[0] as any,
  };
};

for (const [label, fij] of [['known', '2026-02-12'], ['unknown', undefined]] as const) {
  Deno.test(`bridge identity from ADAPTER row equals writer fingerprint (fijación ${label})`, () => {
    const { writer, adapter } = pair(modern('2026-10-20', fij));
    assertEquals(adapter.fecha_fijacion, fij ?? '');
    assertEquals(canonicalPubIdentityFromRow(adapter, wi), writer.hash_fingerprint);
    assertEquals(legalIdentity('PUB', adapter, wi), writer.hash_fingerprint);
  });
}

Deno.test('unknown fijación never filled from portal date', () => {
  const { writer, adapter } = pair(modern('2026-10-20'));
  assertEquals(writer.fecha_fijacion, null);
  assertEquals(adapter.fecha_fijacion, '');
  assertEquals(String(adapter.published_at).slice(0, 10), '2026-10-20');
});

Deno.test('same title, unknown fijación, distinct portal dates: two identities survive real grouping', () => {
  const a = pair(modern('2026-10-20')).adapter;
  const b = pair(modern('2026-10-27')).adapter;
  assertEquals(a.title, b.title);
  assertNotEquals(a.hash_fingerprint, b.hash_fingerprint);
  // Strip transported ids so grouping relies on the recomputed legal identity.
  const strip = (r: any) => ({ ...r, asset_id: undefined, key: undefined });
  assertEquals(groupProviderRows('PUB', [strip(a), strip(b)], wi).size, 2);
  // Exact repetition still dedupes.
  assertEquals(groupProviderRows('PUB', [strip(a), strip(a)], wi).size, 1);
});
