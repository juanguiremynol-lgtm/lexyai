import { isAndromedaCopyUrl } from './act-attachments-inventory';

export function actDocumentPresentation(doc: Record<string, any>, now = Date.now()) {
  const candidates = [doc.gcs_url, doc.url, doc.urlDescarga, doc.urlVer].filter((s): s is string => typeof s === 'string' && /^https:\/\//i.test(s));
  const own = candidates.find(isAndromedaCopyUrl) ?? null;
  const failedReading = doc.descarga_estado !== 'descargado_y_leido' &&
    (doc.descarga_error?.kind === 'validation' || doc.recuperacion_cache?.originalNoValidado?.lectura_validada === false
      || String(doc.estado).toUpperCase() === 'INVALIDO');
  if (failedReading) return { href: null, stored: false, label: 'Lectura fallida – sin copia disponible', reason: 'El archivo no superó la comprobación de lectura. No se ofrece el enlace externo como sustituto.' };
  if (own) return { href: own, stored: true, label: 'Archivo almacenado', reason: null };
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
