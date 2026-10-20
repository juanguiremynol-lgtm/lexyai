import { locateCaseInPackagePages, verifyDeclaredCasePages } from './publisherResolution.ts';
export interface EstadoQueueRow {
  id: string;
  publicacion_id: string;
  remote_url: string;
  filename: string | null;
  attempt_count: number; // incremented by the atomic queue claim
  max_attempts: number;
  storage_path: string | null;
  last_error: string | null;
  validation_evidence?: Record<string, unknown> | null;
}

export interface EstadoPdfReading {
  sha256: string;
  bytes: number;
  pages: number;
  pagesRead: number;
  textSha256: string;
  method: string;
  /** Per-page text, used in-memory only (never persisted in evidence). */
  pageTexts?: string[];
}

export interface EstadoRecoveryPorts {
  publication: () => Promise<EstadoPublication>;
  readStored: (path: string) => Promise<Uint8Array | null>;
  fetchOrigin: (url: string) => Promise<Uint8Array>;
  inspect: (bytes: Uint8Array, onlyPages?: number[]) => Promise<EstadoPdfReading>;
  upload: (path: string, bytes: Uint8Array) => Promise<void>;
  saveQueue: (patch: Record<string, unknown>) => Promise<void>;
  /** Implementations update only this publication's primary document. */
  setPrimaryAvailability: (available: boolean, path: string | null) => Promise<void>;
  now?: () => Date;
}

export interface EstadoPublication {
  pdf_url?: string | null;
  source?: string | null;
  source_radicado?: string | null;
  raw_data?: unknown;
}

/** The PP /pdf asset is the base64url encoding of the original GCS key
 * (publicaciones-procesales-api/main.py). Match the exact native descriptor,
 * document role and case. Processed sha256_auto/tabla do NOT hash these originals. */
export function publicPpDocumentCorrespondence(pub: EstadoPublication, url: string): Record<string, string> | null {
  if (pub.source !== 'publicaciones' || !/^\d{23}$/.test(pub.source_radicado || '')) return null;
  const match = /^https:\/\/publicaciones-procesales-api-11974381924\.us-central1\.run\.app\/pdf\/([A-Za-z0-9_-]+)$/.exec(url);
  if (!match) return null;
  let path: string;
  try { path = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(match[1].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))); } catch { return null; }
  if (path.split('/').some(p => !p || p === '.' || p === '..') || /[\\%?#]/.test(path)) return null;
  const sourceGcs = `https://storage.googleapis.com/andromeda-pp-documentos-2026/${path}`;
  let layer: any = pub.raw_data;
  for (let depth = 0; depth < 4 && layer && typeof layer === 'object'; depth++, layer = layer.raw_data) {
    const article = String(layer.estado?.article_id || layer.article_id || '');
    if (!/^\d+$/.test(article) || !Array.isArray(layer.documentos_pdf)) continue;
    for (const [kind, field, prefix] of [
      ['auto', 'gcs_url_pdf_actuacion', `${pub.source_radicado}/raw/actuaciones/`],
      ['estado', 'gcs_url_pdf_estado', `${pub.source_radicado}/raw/estados/`],
    ]) {
      // Earlier PP objects have no article directory. Their exact native key
      // must still be advertised by this source record; never match a title.
      const suffix = kind === 'auto' ? new RegExp(`^(?:${article}/)?[^/]+\\.pdf$`, 'i') : /^[^/]+\.pdf$/i;
      if (layer[field] !== sourceGcs || !path.startsWith(prefix) || !suffix.test(path.slice(prefix.length))) continue;
      if (!layer.documentos_pdf.some((d: any) => d?.tipo === kind && d?.pdf_url === url)) continue;
      return { method: 'public_source_document_path', case_radicado: pub.source_radicado!, article_id: article,
        document_kind: kind, source_gcs_url: sourceGcs, source_path: path, document_url: url };
    }
  }
  return null;
}

const documentUrlFields = ['pdf_url', 'gcs_url', 'url_descarga', 'urlDescarga', 'urlVer', 'url', 'url_origen'];

/** Only the SHA256 explicitly declared by the source for this particular URL
 * is correspondence evidence. A hash calculated by us is traceability only. */
export function declaredEstadoDocumentHash(pub: { pdf_url?: string | null; raw_data?: unknown }, url: string): string | null {
  let layer: any = pub.raw_data;
  for (let depth = 0; depth < 4 && layer && typeof layer === 'object'; depth++, layer = layer.raw_data) {
    const documents = ['documentos', 'anexos_documentos', 'documentos_pdf', 'attachments']
      .flatMap((key) => Array.isArray(layer[key]) ? layer[key] : []);
    for (const doc of [...documents, layer]) {
      // The publication's primary URL must not lend its association to a
      // nested descriptor for another document (or one with no URL evidence).
      const linked = documentUrlFields.some((key) => doc?.[key] === url);
      if (!linked || typeof doc?.hash_documento !== 'string') continue;
      const hash = doc.hash_documento.replace(/[\s|]/g, '').toLowerCase();
      if (/^[a-f0-9]{64}$/.test(hash)) return hash;
    }
  }
  return null;
}

/** Official-portal recovery evidence: a document located on the public
 * Publicaciones Procesales portal (article + despacho + date) whose anonymous
 * download SHA256 was recorded in raw_data.recuperacion_oficial. Only an exact
 * URL + SHA match counts; never a title, date or filename. */
export function officialPortalRecoveryHash(pub: { raw_data?: unknown }, url: string): Record<string, unknown> | null {
  const list = (pub.raw_data as any)?.recuperacion_oficial;
  if (!Array.isArray(list)) return null;
  for (const r of list) {
    if (r?.url !== url || typeof r?.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.sha256)) continue;
    if (!String(url).startsWith('https://publicacionesprocesales.ramajudicial.gov.co/c/document_library/get_file?')) continue;
    if (!r.article_id || !r.id_despacho || !r.fecha) continue;
    const out: Record<string, unknown> = { method: 'official_portal_recovery', expected_sha256: r.sha256, article_id: r.article_id, id_despacho: r.id_despacho, fecha: r.fecha };
    // Multi-providencia package from a central publisher: the case must be
    // located on the declared pages, never assumed for the whole package.
    const pk = r.paquete;
    if (pk) {
      if (!/^\d{23}$/.test(String(pk.radicado || '')) || typeof pk.despacho_autor_nombre !== 'string' || !Array.isArray(pk.paginas_caso)) return null;
      out.paquete = pk;
    }
    return out;
  }
  return null;
}

/** Recovery core. Storage/HTTP are injected so tests execute this exact state
 * machine without remote writes. Every completion must be confirmed by storage
 * read-back and a checked DB write; attempts are claimed, never refunded. */
export async function recoverEstadoAttachment(row: EstadoQueueRow, ports: EstadoRecoveryPorts): Promise<{ success: boolean; error?: string }> {
  const now = () => (ports.now?.() ?? new Date());
  let path = row.storage_path;
  let evidence: Record<string, unknown> = row.validation_evidence ?? {};
  try {
    const pub = await ports.publication();
    const official = officialPortalRecoveryHash(pub, row.remote_url);
    const expectedHash = declaredEstadoDocumentHash(pub, row.remote_url) ?? (official?.expected_sha256 as string | undefined) ?? null;
    const sourceIdentity = publicPpDocumentCorrespondence(pub, row.remote_url);
    const declaredPages: number[] | undefined = (official as any)?.paquete?.paginas_caso
      ?.flatMap(([a, b]: [number, number]) => Array.from({ length: Math.max(0, Math.min(b, a + 20) - a + 1) }, (_, i) => a + i));
    const inspectFirst = (b: Uint8Array) => ports.inspect(b, declaredPages);
    let bytes: Uint8Array | null = null;
    let reading: EstadoPdfReading | null = null;
    let source = 'origin';
    if (path) {
      let storageReadCompleted = false;
      try {
        bytes = await ports.readStored(path);
        storageReadCompleted = true;
        if (!bytes) throw new Error('stored_file_missing');
        reading = await inspectFirst(bytes);
        if (expectedHash && reading.sha256 !== expectedHash) throw new Error('stored_document_mismatch');
        if (!expectedHash && !(evidence.source_url === row.remote_url && evidence.queue_id === row.id
            && (evidence.reading as EstadoPdfReading | undefined)?.sha256 === reading.sha256)) {
          throw new Error('stored_document_association_unverified');
        }
        source = 'storage_revalidated';
      } catch (cacheError) {
        const reason = cacheError instanceof Error ? cacheError.message : String(cacheError);
        evidence = storageReadCompleted
          ? { ...evidence, state: 'invalid', cache_error: reason }
          : { ...evidence, cache_read_error: reason };
        bytes = null;
        reading = null;
        // Only the current primary association can be cleared. Other acts and
        // publications sharing identical bytes keep their own associations.
        // Network/access errors do not prove that an existing copy is invalid.
        if (storageReadCompleted) {
          path = null;
          await ports.setPrimaryAvailability(false, null);
        }
      }
    }
    if (!bytes || !reading) {
      bytes = await ports.fetchOrigin(row.remote_url);
      reading = await inspectFirst(bytes);
      if (expectedHash && reading.sha256 !== expectedHash) throw new Error('source_document_hash_mismatch');
      // Same filename never means the same document. Content address is scoped
      // to BOTH publication and queue identity; retries of identical bytes reuse it.
      const candidatePath = `${row.publicacion_id}/${row.id}/${reading.sha256}.pdf`;
      await ports.upload(candidatePath, bytes);
      const stored = await ports.readStored(candidatePath);
      if (!stored) throw new Error('stored_readback_missing');
      if (await sha256Hex(stored) !== reading.sha256) throw new Error('stored_readback_mismatch');
      path = candidatePath;
    }
    const associationPath = `${row.publicacion_id}/${row.id}/${reading.sha256}.pdf`;
    if (path !== associationPath) {
      // A validated legacy/shared path is copied into this association's
      // namespace; neither the original object nor other references are changed.
      await ports.upload(associationPath, bytes);
      const stored = await ports.readStored(associationPath);
      if (!stored || await sha256Hex(stored) !== reading.sha256) throw new Error('stored_readback_mismatch');
      path = associationPath;
    }
    let verified = !!expectedHash && reading.sha256 === expectedHash || !!sourceIdentity;
    let packageEvidence: Record<string, unknown> | null = null;
    const pk = (official as any)?.paquete;
    if (verified && pk) {
      const located = locateCaseInPackagePages(reading.pageTexts ?? [], pk.radicado, pk.despacho_autor_nombre,
        !!pk.publicador && pk.publicador === pk.despacho_autor && pk.publicador === String(pk.radicado).slice(0, 12));
      const ok = verifyDeclaredCasePages(located, pk.paginas_caso);
      packageEvidence = { radicado: pk.radicado, publicador: pk.publicador ?? null, despacho_autor: pk.despacho_autor ?? null, paginas_declaradas: pk.paginas_caso, paginas_localizadas: located, verificado: ok };
      if (!ok) verified = false;
    }
    const { pageTexts: _omit, ...readingEvidence } = reading;
    evidence = {
      ...evidence,
      state: verified ? 'verified' : 'obtained_pending_correspondence',
      reading: readingEvidence,
      ...(packageEvidence ? { paquete: packageEvidence } : {}),
      source_url: row.remote_url,
      queue_id: row.id,
      publicacion_id: row.publicacion_id,
      download_source: source,
      correspondence: official && expectedHash === official.expected_sha256 ? official
        : expectedHash ? { method: 'source_declared_sha256', expected_sha256: expectedHash }
        : sourceIdentity || { method: null, reason: 'specific_document_identity_not_verified' },
      checked_at: now().toISOString(),
      // Neither SHA equality nor full-page parsing asserts complete integrity,
      // signature authenticity, visual rendering or a procedural conclusion.
    };
    if (!verified) {
      await ports.setPrimaryAvailability(false, null);
      throw new Error('document_correspondence_unverified');
    }
    await ports.setPrimaryAvailability(true, path);
    await ports.saveQueue({ status: 'downloaded', storage_path: path, downloaded_at: now().toISOString(), last_error: null, validation_evidence: evidence, validation_checked_at: now().toISOString() });
    return { success: true };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const exhausted = row.attempt_count >= row.max_attempts;
    const backoffMinutes = Math.min(240, Math.pow(2, row.attempt_count) * 5);
    await ports.saveQueue({
      status: exhausted ? 'failed' : 'pending',
      storage_path: path,
      last_error: message,
      validation_evidence: { ...evidence, last_failure: message },
      validation_checked_at: now().toISOString(),
      next_retry_at: new Date(now().getTime() + backoffMinutes * 60_000).toISOString(),
    });
    return { success: false, error: message };
  }
}

/** Storage read-back only needs byte identity; the PDF was already parsed. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
