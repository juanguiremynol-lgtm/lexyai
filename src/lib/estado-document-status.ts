export interface EstadoDocumentRecovery {
  id: string;
  publicacion_id: string;
  filename?: string | null;
  status: string;
  last_error?: string | null;
  storage_path?: string | null;
  validation_evidence?: any;
}

export function estadoDocumentStatus(document: EstadoDocumentRecovery): { available: boolean; label: string; reason: string } {
  const evidence = document.validation_evidence;
  const reading = evidence?.reading;
  const correspondence = evidence?.correspondence;
  const boundPublicPath = correspondence?.method === 'public_source_document_path'
    && correspondence.document_url === evidence?.source_url
    && /^\d{23}$/.test(correspondence.case_radicado || '')
    && ['auto', 'estado'].includes(correspondence.document_kind)
    && correspondence.source_gcs_url === `https://storage.googleapis.com/andromeda-pp-documentos-2026/${correspondence.source_path}`
    && evidence?.queue_id === document.id && evidence?.publicacion_id === document.publicacion_id;
  const available = document.status === 'downloaded' && !!document.storage_path
    && evidence?.state === 'verified' && reading?.pages > 0 && reading.pagesRead === reading.pages
    && ((!!correspondence?.expected_sha256 && correspondence.expected_sha256 === reading.sha256) || boundPublicPath);
  if (available) return { available: true, label: 'Disponible', reason: 'Copia obtenida, leída y vinculada a este documento.' };
  const error = document.last_error || '';
  if (evidence?.state === 'obtained_pending_correspondence' || error.includes('correspondence_unverified')) {
    return { available: false, label: 'Correspondencia pendiente', reason: 'Se obtuvo una copia; falta confirmar que corresponda a este documento.' };
  }
  if (/http[_ ]?(401|403)/i.test(error)) return { available: false, label: 'Acceso pendiente', reason: 'El origen denegó esta descarga; la copia sigue pendiente.' };
  const suffix = document.status === 'failed' ? ' Se agotaron los reintentos automáticos.' : ' El sistema volverá a intentarlo.';
  if (/hash_mismatch|document_mismatch/.test(error)) return { available: false, label: 'Documento pendiente', reason: 'La copia recibida no coincide con el documento anunciado.' + suffix };
  if (/pdf_|stored_/.test(error)) return { available: false, label: 'Lectura pendiente', reason: 'No se pudo comprobar la lectura de la copia.' + suffix };
  if (error) return { available: false, label: 'Recuperación pendiente', reason: 'No se completó la descarga o su almacenamiento.' + suffix };
  return { available: false, label: 'Verificación pendiente', reason: 'El enlace anunciado todavía no acredita una copia disponible.' };
}
