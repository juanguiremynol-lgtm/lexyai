/** Current download observations are ordered independently of protected act text.
 * URL-only legacy descriptors keep their earlier additive merge behaviour. */
type Doc = Record<string, any>;
const fields = ['gcs', 'gcs_url', 'sha256', 'pdf_verificacion', 'archivo_verificacion', 'descarga_estado', 'descarga_error',
  'descarga_intentos', 'descarga_observado_en', 'recuperacion_cache', 'disponible', 'url', 'urlDescarga', 'urlVer'];
const attemptFields = ['descarga_estado', 'descarga_error', 'descarga_intentos', 'descarga_observado_en', 'recuperacion_cache'];
const invalid = ['stored_object_missing', 'stored_hash_mismatch', 'stored_pdf_invalid'];
function stable(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
export function documentObservationAt(value: any): number | null {
  // Older providers persist `intentos` as a counter, not a download log.
  // Only an actual log can supply a dated observation; do not invent one
  // from legacy counters or strings.
  const date = value?.descarga_observado_en || value?.observado_en || lastAttemptAt(value?.descarga_intentos) || lastAttemptAt(value?.intentos) || value?.pdf_verificacion?.verificado_en;
  const time = Date.parse(date);
  return Number.isFinite(time) ? time : null;
}
function lastAttemptAt(value: unknown): string | undefined {
  return Array.isArray(value) ? value.at(-1)?.observado_en : undefined;
}
export const hasArchiveReading = (doc: Doc) => doc.archivo_verificacion?.lectura_completa === true
  && doc.archivo_verificacion?.crc_comprobado === true && ['zip', 'xlsx'].includes(doc.archivo_verificacion?.formato);
const proof = (doc: Doc) => doc.descarga_estado === 'descargado_y_leido' && !!(doc.pdf_verificacion || hasArchiveReading(doc)) && !!(doc.gcs_url || doc.urlDescarga || doc.url);
function history(values: any[]): any[] {
  const out: any[] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const copy = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'metadata_variants'));
    if (!out.some(v => stable(v) === stable(copy))) out.push(copy);
  }
  return out;
}
function copyFields(target: Doc, source: Doc, keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key]; else delete target[key];
  }
}
function invalidates(previous: Doc, incoming: Doc): boolean {
  const cache = incoming.recuperacion_cache;
  const at = documentObservationAt(previous);
  const facts = [{ cacheIssue: cache?.cacheIssue, cachedObjectUrl: cache?.cachedObjectUrl,
    observedAt: cache?.cacheObservedAt || incoming.descarga_observado_en || lastAttemptAt(incoming.descarga_intentos) },
    ...(Array.isArray(cache?.knownInvalidCopies) ? cache.knownInvalidCopies : [])];
  return facts.some(f => invalid.includes(f.cacheIssue) && !!f.cachedObjectUrl &&
    [previous.gcs_url, previous.urlDescarga, previous.urlVer, previous.url].includes(f.cachedObjectUrl) &&
    (at == null || Number.isFinite(Date.parse(f.observedAt)) && Date.parse(f.observedAt) > at));
}

export function mergeDocumentObservation(previous: Doc, incoming: Doc, merged: Doc): Doc {
  const before = documentObservationAt(previous), at = documentObservationAt(incoming);
  if (before == null && at == null) return merged;
  let variants = history([...(previous.metadata_variants || []), ...(incoming.metadata_variants || [])]);
  if (at == null || before != null && at < before) {
    copyFields(merged, previous, fields);
    if (at != null) variants = history([...variants, incoming]);
  } else {
    copyFields(merged, incoming, attemptFields);
    if (proof(incoming)) {
      copyFields(merged, incoming, fields);
      merged.gcs = true;
      merged.gcs_url = incoming.gcs_url || incoming.urlDescarga || incoming.url;
      merged.url = merged.gcs_url;
      merged.urlDescarga = merged.gcs_url;
      merged.urlVer = incoming.urlVer || merged.gcs_url;
      merged.disponible = true;
      delete merged.descarga_error;
    } else if (proof(previous) && !invalidates(previous, incoming)) {
      copyFields(merged, previous, ['gcs', 'gcs_url', 'sha256', 'pdf_verificacion', 'archivo_verificacion', 'descarga_estado', 'disponible', 'url', 'urlDescarga', 'urlVer']);
    } else {
      merged.gcs = false;
      merged.gcs_url = null;
      delete merged.sha256;
      delete merged.pdf_verificacion;
      delete merged.archivo_verificacion;
      merged.url = incoming.url_origen || incoming.urlDescargaOriginal || incoming.urlDescarga || incoming.url || null;
      merged.urlDescarga = merged.url;
      merged.urlVer = incoming.urlVerOriginal || merged.url;
      merged.disponible = false;
    }
    if (fields.some(k => stable(previous[k]) !== stable(merged[k]))) variants = history([...variants, previous]);
  }
  if (variants.length) merged.metadata_variants = variants;
  return merged;
}

/** Replace only the dated detail observation. Source identity and annotation are
 * handled separately by origin checks and the existing enrichment policy. */
export function mergeAnexosObservation(existingRaw: Doc, incomingObservation: any): Doc {
  if (!incomingObservation || typeof incomingObservation !== 'object' || Array.isArray(incomingObservation)) return { ...existingRaw };
  const previous = existingRaw.anexos_observacion;
  const oldAt = documentObservationAt(previous), at = documentObservationAt(incomingObservation);
  const out = { ...existingRaw };
  const variants = [...(Array.isArray(existingRaw.anexos_observacion_historial) ? existingRaw.anexos_observacion_historial : [])];
  const add = (v: any) => { if (v && !variants.some(x => stable(x) === stable(v))) variants.push(v); };
  if (!previous || at != null && (oldAt == null || at > oldAt)) {
    if (previous && stable(previous) !== stable(incomingObservation)) add(previous);
    out.anexos_observacion = incomingObservation;
  } else if (stable(previous) !== stable(incomingObservation)) add(incomingObservation);
  if (variants.length) out.anexos_observacion_historial = variants;
  return out;
}
