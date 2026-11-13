import { describe, expect, it } from 'vitest';
import { publicationHeaderDocument } from '../lib/estado-document-status';

const state = 'https://example.test/estado.pdf';
const order = 'https://example.test/auto.pdf';
const pub = {
  id: 'pub', source: 'publicaciones', tipo_publicacion: 'Estado Electrónico', pdf_url: order,
  pdf_storage_path: 'pub/auto.pdf',
  raw_data: { raw_data: { documentos_pdf: [{ tipo: 'auto', pdf_url: order }, { tipo: 'estado', pdf_url: state }] } },
};
function recovered(id: string, url: string, role: string) {
  return {
    id, publicacion_id: 'pub', storage_path: 'pub/' + id + '.pdf', status: 'downloaded', remote_url: url,
    validation_evidence: { queue_id: id, publicacion_id: 'pub', state: 'verified', source_url: url,
      reading: { pages: 1, pagesRead: 1, sha256: 'a'.repeat(64) },
      correspondence: { method: 'source_declared_sha256', expected_sha256: 'a'.repeat(64), document_kind: role } },
  };
}
describe('document behind a publication header', () => {
  const auto = recovered('auto', order, 'auto');
  const estado = recovered('estado', state, 'estado');
  it('keeps the declared estado separate from the historically mislabelled auto', () => {
    for (const copies of [[auto, estado], [estado, auto]]) {
      expect(publicationHeaderDocument(pub, copies)).toEqual({ copy: estado, sourceUrl: state });
    }
    expect(publicationHeaderDocument({ ...pub, tipo_publicacion: 'Providencia' }, [estado, auto]).copy).toBe(auto);
  });
  it('does not promote an opposite-role, unverified, other-publication or distinct ambiguous copy', () => {
    for (const copies of [[auto], [{ ...estado, validation_evidence: undefined }],
      [{ ...estado, publicacion_id: 'other' }], [estado, recovered('second', state, 'estado')],
      [recovered('wrong-evidence', state, 'auto')]]) {
      expect(publicationHeaderDocument(pub, copies).copy).toBeUndefined();
    }
    expect(publicationHeaderDocument(pub, [estado, { ...estado }]).copy).toBe(estado);
  });
  it('does not infer the primary PDF from an unclassified URL, a default storage path or mixed role', () => {
    const mixed = { documentos_pdf: [{ tipo: 'auto', pdf_url: state }, { tipo: 'estado', pdf_url: state }] };
    for (const publication of [{ ...pub, raw_data: mixed }, { ...pub, tipo_publicacion: null },
      { ...pub, raw_data: {} }, { ...pub, raw_data: { documentos_pdf: [
        { tipo: 'estado', pdf_url: state }, { tipo: 'estado', pdf_url: state + '2' }] } }]) {
      expect(publicationHeaderDocument(publication, [auto, estado])).toEqual({ copy: undefined, sourceUrl: null });
    }
  });
  it('recognizes the verified official estado archived under its own row and article', () => {
    const proof = { ...estado, validation_evidence: { ...estado.validation_evidence,
      correspondence: { method: 'official_portal_recovery', article_id: '42', expected_sha256: 'a'.repeat(64) } } };
    const official = { ...pub, pdf_url: state, pdf_storage_path: estado.storage_path, raw_data: {
      recuperacion_oficial: [{ article_id: '42', url: state, sha256: 'a'.repeat(64) }] } };
    expect(publicationHeaderDocument(official, [proof]).copy).toBe(proof);
    expect(publicationHeaderDocument({ ...official, pdf_storage_path: 'different' }, [proof]).copy).toBeUndefined();
  });
});
