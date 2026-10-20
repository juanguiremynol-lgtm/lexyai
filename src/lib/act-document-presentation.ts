import { isAndromedaCopyUrl } from './act-attachments-inventory';

/** A storage URL and the old `disponible` flag are not reading evidence. */
function readCopyEvidence(doc: Record<string, any>): boolean {
  if (doc.descarga_estado !== 'descargado_y_leido') return false;
  const pdf = doc.pdf_verificacion;
  const archive = doc.archivo_verificacion;
  const hash = pdf?.sha256;
  if (pdf && Number.isSafeInteger(pdf.paginas) && pdf.paginas > 0
    && pdf.paginas_leidas === pdf.paginas && Number.isFinite(pdf.bytes) && pdf.bytes > 5
    && typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash)
    && (!doc.sha256 || doc.sha256 === hash)) return true;
  return archive?.lectura_completa === true && archive.crc_comprobado === true
    && ['zip', 'xlsx'].includes(archive.formato);
}

function hasDatedObservation(doc: Record<string, any>): boolean {
  const attempts = Array.isArray(doc.descarga_intentos) ? doc.descarga_intentos
    : Array.isArray(doc.intentos) ? doc.intentos : [];
  return Number.isFinite(Date.parse(doc.descarga_observado_en || doc.observado_en
    || attempts[attempts.length - 1]?.observado_en || doc.pdf_verificacion?.verificado_en));
}

export function actDocumentPresentation(doc: Record<string, any>, now = Date.now()) {
  const candidates = [doc.gcs_url, doc.url, doc.urlDescarga, doc.urlVer].filter((s): s is string => typeof s === 'string' && /^https:\/\//i.test(s));
  const own = candidates.find(isAndromedaCopyUrl) ?? null;
  const readCopy = !!own && readCopyEvidence(doc);
  const legacyFailure = ['FALLIDO', 'FAILED', 'ERROR', 'ERROR_DESCARGA', 'INVALIDO']
    .includes(String(doc.estado || doc.resultado || doc.status || '').trim().toUpperCase());
  const failedDownload = legacyFailure && !(readCopy && hasDatedObservation(doc));
  const failedReading = !readCopy &&
    (doc.descarga_error?.kind === 'validation' || doc.recuperacion_cache?.originalNoValidado?.lectura_validada === false
      || String(doc.estado).toUpperCase() === 'INVALIDO');
  if (failedReading) return { href: null, stored: false, label: 'Lectura fallida – sin copia disponible', reason: 'El archivo no superó la comprobación de lectura. No se ofrece el enlace externo como sustituto.' };
  if (failedDownload) return { href: null, stored: false, label: 'Descarga fallida – sin copia disponible', reason: 'La descarga registrada falló. La URL conservada es una referencia del origen, no un archivo disponible.' };
  if (readCopy) return { href: own, stored: true, label: 'Archivo almacenado; lectura registrada', reason: null };
  // Legacy own copies written before the reading observer existed carry no
  // descarga_estado at all. Hiding them would permanently conceal valid files,
  // so they stay openable but are labelled as not yet read.
  if (own && !doc.descarga_estado) {
    return { href: own, stored: true, label: 'Archivo almacenado; lectura no registrada', reason: 'Copia propia anterior al control de lectura; su contenido no se ha comprobado.' };
  }
  if (own || doc.descarga_estado) {
    return { href: null, stored: false, label: 'Pendiente de recuperación automática', reason: 'El enlace por sí solo no acredita un archivo almacenado y leído.' };
  }
  const href = candidates[0] ?? null;
  let expired = doc.descarga_error?.kind === 'token_expired';
  if (href) {
    try {
      const u = new URL(href);
      const token = [...u.searchParams.entries()].find(([key]) => key.toLowerCase() === 'tokendoc')?.[1];
      const payload = token?.split(/[.,]/)[1];
      if (payload) {
        const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
        if (typeof data.exp === 'number' && data.exp * 1000 <= now) expired = true;
      }
    } catch { /* Unknown token format is not evidence of validity. */ }
  }
  if (expired) return { href: null, stored: false, label: 'Enlace vencido – sin copia disponible', reason: 'El enlace registrado caducó. No hay una copia propia disponible.' };
  return { href, stored: false, label: href ? 'Enlace registrado, sin copia propia' : 'Sin copia ni enlace disponible',
    reason: href ? 'La copia propia sigue pendiente; la disponibilidad actual del enlace no está comprobada.' : null };
}
