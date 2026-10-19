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
}

export interface EstadoRecoveryPorts {
  publication: () => Promise<{ pdf_url?: string | null; raw_data?: unknown }>;
  readStored: (path: string) => Promise<Uint8Array | null>;
  fetchOrigin: (url: string) => Promise<Uint8Array>;
  inspect: (bytes: Uint8Array) => Promise<EstadoPdfReading>;
  upload: (path: string, bytes: Uint8Array) => Promise<void>;
  saveQueue: (patch: Record<string, unknown>) => Promise<void>;
  /** Implementations update only this publication's primary document. */
  setPrimaryAvailability: (available: boolean, path: string | null) => Promise<void>;
  now?: () => Date;
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

/** Recovery core. Storage/HTTP are injected so tests execute this exact state
 * machine without remote writes. Every completion must be confirmed by storage
 * read-back and a checked DB write; attempts are claimed, never refunded. */
export async function recoverEstadoAttachment(row: EstadoQueueRow, ports: EstadoRecoveryPorts): Promise<{ success: boolean; error?: string }> {
  const now = () => (ports.now?.() ?? new Date());
  let path = row.storage_path;
  let evidence: Record<string, unknown> = row.validation_evidence ?? {};
  try {
    const pub = await ports.publication();
    const expectedHash = declaredEstadoDocumentHash(pub, row.remote_url);
    let bytes: Uint8Array | null = null;
    let reading: EstadoPdfReading | null = null;
    let source = 'origin';
    if (path) {
      let storageReadCompleted = false;
      try {
        bytes = await ports.readStored(path);
        storageReadCompleted = true;
        if (!bytes) throw new Error('stored_file_missing');
        reading = await ports.inspect(bytes);
        if (expectedHash && reading.sha256 !== expectedHash) throw new Error('stored_document_mismatch');
        if (!expectedHash && !(evidence.source_url === row.remote_url && evidence.queue_id === row.id)) {
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
      reading = await ports.inspect(bytes);
      if (expectedHash && reading.sha256 !== expectedHash) throw new Error('source_document_hash_mismatch');
      // Same filename never means the same document. Content address is scoped
      // to BOTH publication and queue identity; retries of identical bytes reuse it.
      const candidatePath = `${row.publicacion_id}/${row.id}/${reading.sha256}.pdf`;
      await ports.upload(candidatePath, bytes);
      const stored = await ports.readStored(candidatePath);
      if (!stored) throw new Error('stored_readback_missing');
      const checked = await ports.inspect(stored);
      if (checked.sha256 !== reading.sha256) throw new Error('stored_readback_mismatch');
      path = candidatePath;
    }
    const associationPath = `${row.publicacion_id}/${row.id}/${reading.sha256}.pdf`;
    if (path !== associationPath) {
      // A validated legacy/shared path is copied into this association's
      // namespace; neither the original object nor other references are changed.
      await ports.upload(associationPath, bytes);
      const stored = await ports.readStored(associationPath);
      if (!stored || (await ports.inspect(stored)).sha256 !== reading.sha256) throw new Error('stored_readback_mismatch');
      path = associationPath;
    }
    const verified = !!expectedHash && reading.sha256 === expectedHash;
    evidence = {
      ...evidence,
      state: verified ? 'verified' : 'obtained_pending_correspondence',
      reading,
      source_url: row.remote_url,
      queue_id: row.id,
      publicacion_id: row.publicacion_id,
      download_source: source,
      correspondence: verified ? { method: 'source_declared_sha256', expected_sha256: expectedHash } : { method: null, reason: 'specific_document_identity_not_verified' },
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
