import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { declaredEstadoDocumentHash, publicPpDocumentCorrespondence, recoverEstadoAttachment, type EstadoQueueRow, type EstadoRecoveryPorts } from '../../supabase/functions/_shared/estadoAttachmentRecovery.ts';
import { estadoDocumentStatus } from '../lib/estado-document-status';
import { downloadEstadoDocument, estadoDocumentAccess } from '../../supabase/functions/_shared/estadoDocumentAccess.ts';

const bytes = new TextEncoder().encode('synthetic readable PDF bytes; reader is mocked in these state-machine tests');
const digest = createHash('sha256').update(bytes).digest('hex');
const base: EstadoQueueRow = { id: 'queue-1', publicacion_id: 'pub-1', remote_url: 'https://example.invalid/document.pdf', filename: 'same-name.pdf', attempt_count: 1, max_attempts: 5, storage_path: null, last_error: null };

function harness(row = base, sourceHash: string | null = digest) {
  const stored = new Map<string, Uint8Array>();
  const patches: Record<string, unknown>[] = [];
  const availability: Array<{ available: boolean; path: string | null }> = [];
  let originCalls = 0;
  const ports: EstadoRecoveryPorts = {
    publication: async () => ({ pdf_url: row.remote_url, raw_data: { raw_data: { hash_documento: sourceHash, pdf_url: row.remote_url } } }),
    readStored: async (path) => stored.get(path) ?? null,
    fetchOrigin: async () => { originCalls++; return bytes; },
    inspect: async (input) => {
      if (new TextDecoder().decode(input) === 'corrupt') throw new Error('pdf_parse_failed');
      return { sha256: createHash('sha256').update(input).digest('hex'), bytes: input.length, pages: 2, pagesRead: 2, textSha256: 'mocked-text-hash', method: 'MOCK_READER; real PDF.js is tested separately in Deno' };
    },
    upload: async (path, input) => { stored.set(path, input); },
    saveQueue: async (patch) => { patches.push(patch); },
    setPrimaryAvailability: async (available, path) => { availability.push({ available, path }); },
    now: () => new Date('2026-10-19T12:00:00Z'),
  };
  return { ports, stored, patches, availability, originCalls: () => originCalls };
}

const ppCase = '05001311000220260018500';
function ppFixture(kind = 'auto', article = '272358311') {
  const path = kind === 'auto' ? `${ppCase}/raw/actuaciones/${article}/Auto.pdf` : `${ppCase}/raw/estados/Planilla.pdf`;
  const url = `https://publicaciones-procesales-api-11974381924.us-central1.run.app/pdf/${Buffer.from(path).toString('base64url')}`;
  return { url, pub: { source: 'publicaciones', source_radicado: ppCase, pdf_url: url, raw_data: { raw_data: {
    estado: { article_id: article }, documentos_pdf: [{ tipo: kind, pdf_url: url }],
    [kind === 'auto' ? 'gcs_url_pdf_actuacion' : 'gcs_url_pdf_estado']: `https://storage.googleapis.com/andromeda-pp-documentos-2026/${path}`,
    sha256_auto: 'a'.repeat(64), sha256_tabla: 'b'.repeat(64),
  } } } };
}

describe('original public PP document correspondence', () => {
  it('accepts an explicitly advertised legacy native key without an article directory', () => {
    const { pub } = ppFixture();
    const path = `${ppCase}/raw/actuaciones/Auto.pdf`;
    const url = `https://publicaciones-procesales-api-11974381924.us-central1.run.app/pdf/${Buffer.from(path).toString('base64url')}`;
    const raw = pub.raw_data.raw_data;
    raw.documentos_pdf[0].pdf_url = url;
    raw.gcs_url_pdf_actuacion = `https://storage.googleapis.com/andromeda-pp-documentos-2026/${path}`;
    expect(publicPpDocumentCorrespondence(pub, url)).toMatchObject({ source_path: path, article_id: '272358311' });
    delete raw.gcs_url_pdf_actuacion;
    expect(publicPpDocumentCorrespondence(pub, url)).toBeNull();
  });
  it.each(['auto', 'estado'])('binds %s to its native original path without borrowing a processed hash', async kind => {
    const { url, pub } = ppFixture(kind);
    expect(declaredEstadoDocumentHash(pub, url)).toBeNull();
    expect(publicPpDocumentCorrespondence(pub, url)).toMatchObject({ method: 'public_source_document_path', document_kind: kind, case_radicado: ppCase });
    const row = { ...base, remote_url: url }, h = harness(row, null);
    h.ports.publication = async () => pub;
    expect((await recoverEstadoAttachment(row, h.ports)).success).toBe(true);
    const saved = h.patches[0];
    expect(saved).toMatchObject({ status: 'downloaded', validation_evidence: { state: 'verified', correspondence: { document_kind: kind } } });
    expect((saved.validation_evidence as any).correspondence.expected_sha256).toBeUndefined();
    expect(estadoDocumentStatus({ ...row, ...saved } as any).available).toBe(true);
  });
  it('rejects different cases, native articles, document roles and arbitrary paths', () => {
    const { url, pub } = ppFixture();
    expect(publicPpDocumentCorrespondence({ ...pub, source_radicado: '1'.repeat(23) }, url)).toBeNull();
    expect(publicPpDocumentCorrespondence(pub, ppFixture('auto', '999').url)).toBeNull();
    expect(publicPpDocumentCorrespondence(pub, ppFixture('estado').url)).toBeNull();
    expect(publicPpDocumentCorrespondence({ ...pub, source: 'samai_estados' }, url)).toBeNull();
    expect(publicPpDocumentCorrespondence(pub, url + '?other=1')).toBeNull();
  });
  it('reuses the retained original on retry and repairs changed stored bytes from the same public source', async () => {
    const { url, pub } = ppFixture(), row = { ...base, remote_url: url }, h = harness(row, null);
    h.ports.publication = async () => pub;
    await recoverEstadoAttachment(row, h.ports);
    const retry = { ...row, attempt_count: 2, storage_path: h.patches[0].storage_path as string, validation_evidence: h.patches[0].validation_evidence as Record<string, unknown> };
    expect((await recoverEstadoAttachment(retry, h.ports)).success).toBe(true);
    expect(h.originCalls()).toBe(1);
    h.stored.set(retry.storage_path, new TextEncoder().encode('different readable PDF'));
    expect((await recoverEstadoAttachment({ ...retry, attempt_count: 3 }, h.ports)).success).toBe(true);
    expect(h.originCalls()).toBe(2);
    expect(h.patches[2].storage_path).toBe(retry.storage_path);
  });
});

describe('recuperación acotada de documentos de ESTADOS (HTTP/storage/lector simulados)', () => {
  it.each(['missing', 'corrupt', 'wrong-document'])('repara copia %s desde origen y verifica la copia guardada', async (failure) => {
    const row = { ...base, storage_path: 'old-shared-path.pdf' };
    const h = harness(row);
    if (failure !== 'missing') h.stored.set(row.storage_path, new TextEncoder().encode(failure === 'corrupt' ? 'corrupt' : 'different valid PDF'));
    h.stored.set('another-publication/own-copy.pdf', bytes);
    expect(await recoverEstadoAttachment(row, h.ports)).toEqual({ success: true });
    expect(h.originCalls()).toBe(1);
    const saved = h.patches[0];
    expect(saved.status).toBe('downloaded');
    expect(saved.storage_path).toBe(`pub-1/queue-1/${digest}.pdf`);
    expect((saved.validation_evidence as any).correspondence).toEqual({ method: 'source_declared_sha256', expected_sha256: digest });
    expect(h.stored.get('another-publication/own-copy.pdf')).toBe(bytes);
  });

  it('dos documentos con igual nombre conservan rutas y asociaciones separadas', async () => {
    const h1 = harness(base), row2 = { ...base, id: 'queue-2' }, h2 = harness(row2);
    await recoverEstadoAttachment(base, h1.ports);
    await recoverEstadoAttachment(row2, h2.ports);
    expect(h1.patches[0].storage_path).not.toBe(h2.patches[0].storage_path);
  });

  it('una copia legacy válida se conserva y recibe referencia propia sin descargarla otra vez', async () => {
    const row = { ...base, storage_path: 'legacy-shared.pdf' }, h = harness(row);
    h.stored.set(row.storage_path, bytes);
    expect((await recoverEstadoAttachment(row, h.ports)).success).toBe(true);
    expect(h.originCalls()).toBe(0);
    expect(h.stored.get('legacy-shared.pdf')).toBe(bytes);
    expect(h.patches[0].storage_path).toBe(`pub-1/queue-1/${digest}.pdf`);
  });

  it('sin correspondencia específica conserva copia pendiente y agota el presupuesto sin inventar disponibilidad', async () => {
    const h = harness(base, null);
    expect((await recoverEstadoAttachment(base, h.ports)).success).toBe(false);
    expect(h.patches[0]).toMatchObject({ status: 'pending', last_error: 'document_correspondence_unverified' });
    const retry = { ...base, attempt_count: 5, storage_path: h.patches[0].storage_path as string, validation_evidence: h.patches[0].validation_evidence as Record<string, unknown> };
    expect((await recoverEstadoAttachment(retry, h.ports)).success).toBe(false);
    expect(h.patches[1].status).toBe('failed');
    expect(h.originCalls()).toBe(1); // valid retained copy is re-read, not downloaded forever
    expect(h.availability.some((change) => change.available)).toBe(false);
  });

  it('un hash distinto declarado por origen impide asociar otro PDF', async () => {
    const h = harness(base, 'a'.repeat(64));
    expect(await recoverEstadoAttachment(base, h.ports)).toEqual({ success: false, error: 'source_document_hash_mismatch' });
    expect(h.stored.size).toBe(0);
    expect(h.patches[0].status).toBe('pending');
  });

  it('fallo transitorio se reintenta sin devolver presupuesto; el último intento queda failed', async () => {
    const row = { ...base, attempt_count: 5 }, h = harness(row);
    h.ports.fetchOrigin = async () => { throw new Error('origin_http_503'); };
    await recoverEstadoAttachment(row, h.ports);
    expect(h.patches[0]).toMatchObject({ status: 'failed', last_error: 'origin_http_503' });
    expect(h.patches[0]).not.toHaveProperty('attempt_count');
  });

  it('no confirma una descarga si no puede leer lo almacenado', async () => {
    const h = harness();
    h.ports.readStored = async () => null;
    expect((await recoverEstadoAttachment(base, h.ports)).error).toBe('stored_readback_missing');
    expect(h.availability.some((change) => change.available)).toBe(false);
  });

  it('un hash calculado por Andrómeda o un hash de otro anexo no acredita correspondencia', () => {
    expect(declaredEstadoDocumentHash({ pdf_url: base.remote_url, raw_data: { sha256: digest } }, base.remote_url)).toBeNull();
    expect(declaredEstadoDocumentHash({ raw_data: { documentos: [{ url: 'https://example.invalid/other.pdf', hash_documento: digest }] } }, base.remote_url)).toBeNull();
  });

  it('la URL primaria de publicación no atribuye un hash de descriptor contradictorio o sin enlace', () => {
    const primary = 'https://example.invalid/first.pdf';
    expect(declaredEstadoDocumentHash({ pdf_url: primary, raw_data: { raw_data: { pdf_url: 'https://example.invalid/second.pdf', hash_documento: digest } } }, primary)).toBeNull();
    expect(declaredEstadoDocumentHash({ pdf_url: primary, raw_data: { raw_data: { hash_documento: digest } } }, primary)).toBeNull();
    expect(declaredEstadoDocumentHash({ pdf_url: primary, raw_data: { raw_data: { pdf_url: primary, hash_documento: digest } } }, primary)).toBe(digest);
  });

  it('la interfaz diferencia copia verificada, enlace anunciado y copia sin atribución', () => {
    expect(estadoDocumentStatus({ ...base, status: 'downloaded' }).available).toBe(false);
    expect(estadoDocumentStatus({ ...base, status: 'pending', validation_evidence: { state: 'obtained_pending_correspondence' } }).label).toBe('Correspondencia pendiente');
    expect(estadoDocumentStatus({ ...base, status: 'downloaded', storage_path: 'own-copy.pdf', validation_evidence: { state: 'verified', reading: { pages: 2, pagesRead: 2, sha256: digest }, correspondence: { expected_sha256: digest } } }).available).toBe(true);
  });

  it('error de lectura de publicación no invalida una copia previamente verificada', async () => {
    const row = { ...base, storage_path: 'previous-copy.pdf', validation_evidence: { state: 'verified' } };
    const h = harness(row);
    h.ports.publication = async () => { throw new Error('database_timeout'); };
    await recoverEstadoAttachment(row, h.ports);
    expect(h.availability).toEqual([]);
    expect(h.patches[0].storage_path).toBe('previous-copy.pdf');
  });

  it.each(['timeout', '403'])('fallo de lectura storage %s y origen temporal conserva referencia previa sin refutarla', async (failure) => {
    const row = { ...base, storage_path: 'previous-copy.pdf', validation_evidence: { state: 'verified', queue_id: base.id, publicacion_id: base.publicacion_id, source_url: base.remote_url } };
    const h = harness(row);
    h.ports.readStored = async () => { throw new Error(`stored_read_failed_${failure}`); };
    h.ports.fetchOrigin = async () => { throw new Error('origin_http_503'); };
    await recoverEstadoAttachment(row, h.ports);
    expect(h.availability).toEqual([]);
    expect(h.patches[0].storage_path).toBe('previous-copy.pdf');
    expect((h.patches[0].validation_evidence as any).state).toBe('verified');
    expect((h.patches[0].validation_evidence as any).cache_read_error).toContain(failure);
  });

  it('las claves se envían solo al servicio exacto y no siguen redirecciones externas', async () => {
    const env = (key: string) => key === 'SAMAI_ESTADOS_API_KEY' ? 'test-key' : undefined;
    expect(() => estadoDocumentAccess('https://samai-estados-api-other-project.us-central1.run.app/pdf/a', env)).toThrow('document_origin_not_authorized');
    const calls: Array<{ url: string; key: string | null }> = [];
    const fetcher: typeof fetch = async (input, options) => {
      calls.push({ url: String(input), key: new Headers(options?.headers).get('X-API-Key') });
      return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://storage.googleapis.com/andromeda-samai-documentos-2026/document.pdf' } }) : new Response(bytes);
    };
    await downloadEstadoDocument('https://samai-estados-api-11974381924.us-central1.run.app/pdf/a', env, fetcher);
    expect(calls.map((call) => call.key)).toEqual(['test-key', null]);
    const malicious: typeof fetch = async () => new Response(null, { status: 302, headers: { location: 'https://example.invalid/steal' } });
    await expect(downloadEstadoDocument('https://samai-estados-api-11974381924.us-central1.run.app/pdf/a', env, malicious)).rejects.toThrow('document_origin_not_authorized');
  });
});
