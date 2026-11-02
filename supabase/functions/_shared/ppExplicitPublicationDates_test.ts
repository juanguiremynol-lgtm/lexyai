import { assertEquals } from 'jsr:@std/assert@1';
import { explodeProviderPublicaciones, toCanonicalPubRow } from './canonicalPublicacionMapper.ts';
import { ppExplicitPublicationDates, conflictingPPNativeRows } from './ppExplicitPublicationDates.ts';
import { publicationDownloadUrls } from './samaiEstadosIngestion.ts';

const ctx = { work_item_id: '11111111-1111-4111-8111-111111111111', organization_id: null, source: 'publicaciones' };
const legacy = {
  fecha: '2026-10-21', fecha_auto: '2026-10-21',
  estado: { article_id: '123456', numero: '42', fecha_publicacion: '2026-10-21',
    pdf_nombre: 'Estado 42.pdf', pdf_url: 'https://example.test/package.pdf' },
  documentos_pdf: [{ tipo: 'estado', titulo: 'Estado 42.pdf', fecha: '2026-10-21', pdf_url: 'https://example.test/package.pdf' }],
};

Deno.test('PP preserves portal 21, printed fixation 22 and printed order 20 separately; contexts are not annexes', () => {
  const raw = { ...legacy, fecha_providencia_impresa: '2026-10-20',
    estado: { ...legacy.estado, fecha_publicacion_portal: '2026-10-21', fecha_fijacion_impresa: '2026-10-22' },
    documento_atribucion: { contextos_publicacion: [{ pdf_url: 'https://example.test/context.pdf', atribuida: false }] },
  };
  const unit = explodeProviderPublicaciones({ actuaciones: [raw] })[0];
  const row = ppExplicitPublicationDates(unit, ctx);
  assertEquals(row.published_at?.slice(0, 10), '2026-10-21');
  assertEquals(row.fecha_fijacion?.slice(0, 10), '2026-10-22');
  assertEquals(row.fecha_providencia?.slice(0, 10), '2026-10-20');
  assertEquals((row.raw_data as typeof unit).raw_data, raw);
  assertEquals(publicationDownloadUrls(unit), ['https://example.test/package.pdf']);
  const old = toCanonicalPubRow(unit, ctx);
  assertEquals(conflictingPPNativeRows(row, [{ id: 'old-reference', raw_data: old.raw_data,
    tipo_publicacion: old.tipo_publicacion, hash_fingerprint: old.hash_fingerprint }]), ['old-reference']);
  assertEquals(conflictingPPNativeRows(row, [{ id: 'same', raw_data: row.raw_data,
    tipo_publicacion: row.tipo_publicacion, hash_fingerprint: row.hash_fingerprint }]), []);
});

Deno.test('legacy PP rows and fingerprints remain identical; SAMAI ignores PP explicit fields', () => {
  const unit = explodeProviderPublicaciones({ actuaciones: [legacy] })[0];
  assertEquals(ppExplicitPublicationDates(unit, ctx), toCanonicalPubRow(unit, ctx));
  const samai = { ...unit, _source_provider: 'samai_estados', raw_data: {
    ...legacy, fecha_providencia_impresa: '2026-10-20', estado: {
      ...legacy.estado, fecha_publicacion_portal: '2026-10-21', fecha_fijacion_impresa: '2026-10-22',
    },
  } };
  assertEquals(ppExplicitPublicationDates(samai, ctx), toCanonicalPubRow(samai, ctx));
});