import { describe, it, expect } from 'vitest';
import { estadoDocumentStatus } from '@/lib/estado-document-status';
const sha = 'e8456b0bebb4e7eb2a36665e6dc49845cfbf9711113b8e0c859b815d085edbb5';
const base = (reading: any, verificado = true) => ({ id: 'q', publicacion_id: 'p', status: 'downloaded', storage_path: 'x.pdf',
  validation_evidence: { state: 'verified', paquete: { verificado }, correspondence: { expected_sha256: sha }, reading: { sha256: sha, ...reading } } });
describe('estado package copies', () => {
  it('verified package read on its declared case pages is available as original package', () => {
    const s = estadoDocumentStatus(base({ pages: 68, pagesRead: 3, method: 'pdfjs-4.10.38-text-and-operators-declared-pages:5,60,61; x' }));
    expect(s.available).toBe(true);
    expect(s.label).toBe('Disponible (paquete original)');
  });
  it('partial read without declared pages stays pending', () => {
    expect(estadoDocumentStatus(base({ pages: 68, pagesRead: 3, method: 'every-page' })).available).toBe(false);
  });
  it('declared-page read without verified package stays pending', () => {
    expect(estadoDocumentStatus(base({ pages: 68, pagesRead: 3, method: 'declared-pages:5,60,61' }, false)).available).toBe(false);
  });
  it('fewer pages read than declared stays pending', () => {
    expect(estadoDocumentStatus(base({ pages: 68, pagesRead: 2, method: 'declared-pages:5,60,61' })).available).toBe(false);
  });
});
