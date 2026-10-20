import { describe, expect, it } from 'vitest';
import { withRetainedOfficialPublicationUrls } from '../../supabase/functions/_shared/publicationRecoveryUrls.ts';

const url = 'https://publicacionesprocesales.ramajudicial.gov.co/c/document_library/get_file?uuid=planilla-070&groupId=1';
const evidence = { url, sha256: 'a'.repeat(64), article_id: 'estado-070', id_despacho: '110013110013', fecha: '2026-10-02' };

describe('persisted official publication recovery URLs', () => {
  it('queues the retained exact official URL when an old provider response has no PDF', () => {
    expect(withRetainedOfficialPublicationUrls([], { raw_data: { recuperacion_oficial: [evidence] } })).toEqual([url]);
  });
  it('keeps upstream annexes and deduplicates a repeated recovered URL', () => {
    const annex = 'https://example.test/another-document.pdf';
    expect(withRetainedOfficialPublicationUrls([annex, url], { raw_data: { recuperacion_oficial: [evidence, evidence] } })).toEqual([annex, url]);
  });
  it.each([
    { ...evidence, sha256: '' },
    { ...evidence, article_id: null },
    { ...evidence, id_despacho: null },
    { ...evidence, fecha: null },
    { ...evidence, url: 'https://example.test/other.pdf' },
  ])('does not invent source bindings from incomplete or foreign evidence', (item) => {
    expect(withRetainedOfficialPublicationUrls([], { raw_data: { recuperacion_oficial: [item] } })).toEqual([]);
  });
  it('does not use general hashes or nested metadata as attestation', () => {
    expect(withRetainedOfficialPublicationUrls([], { raw_data: { pdf_url: url, sha256: evidence.sha256 } })).toEqual([]);
    expect(withRetainedOfficialPublicationUrls([], { raw_data: { raw_data: { recuperacion_oficial: [evidence] } } })).toEqual([]);
  });
});
