import type { NormalizedPublicacion } from './providerAdapters/types.ts';
import type { ProviderPubUnit } from './canonicalPublicacionMapper.ts';

/** Preserve every provider row up to the canonical mapper and RPC. Date and
 * the first characters of a title are not evidence that two publications
 * are the same. The RPC owns persistence/deduplication and its row outcomes.
 * raw_data keeps provider identity, all documents and act relationships. */
export function samaiEstadosToProviderUnits(publicaciones: NormalizedPublicacion[]): ProviderPubUnit[] {
  return publicaciones.map((np) => {
    const raw = np.raw_data ?? {};
    const date = np.fecha_fijacion || '';
    return {
      key: String(raw.source_act_id || raw.id || `samai_estado_${np.hash_fingerprint}`),
      tipo: np.tipo_publicacion || 'Estado',
      titulo: np.title || np.tipo_publicacion || 'Estado SAMAI',
      fecha_publicacion: date || null,
      fecha_estado_raw: typeof raw.fecha_estado_normalizada === 'string' ? raw.fecha_estado_normalizada : null,
      fecha_auto_raw: np.fecha_providencia || (typeof raw.fecha_providencia_normalizada === 'string' ? raw.fecha_providencia_normalizada : null),
      pdf_url: np.pdf_url,
      url: np.entry_url,
      tipo_evento: 'Estado Electrónico',
      asset_id: String(raw.source_act_id || raw.hash_documento || `samai_${np.hash_fingerprint}`),
      clasificacion: {
        categoria: 'Estado Electrónico',
        descripcion: String(raw['Anotación'] || raw.anotacion || raw['Docum. a notif.'] || np.tipo_publicacion),
        // This signals an announced URL only. It is not a PDF validation result.
        es_descargable: !!np.pdf_url,
      },
      raw_data: raw,
      _source_provider: 'samai_estados',
    };
  });
}

/** One preferred URL per announced document, retaining every document. Scalar
 * pdf/gcs/origin URLs are aliases for the primary document, not extra annexes. */
export function publicationDownloadUrls(pub: Pick<ProviderPubUnit, 'pdf_url' | 'raw_data'>): string[] {
  const urls = new Set<string>();
  if (typeof pub.pdf_url === 'string' && pub.pdf_url.startsWith('https://')) urls.add(pub.pdf_url);
  const raw = pub.raw_data ?? {};
  for (const field of ['documentos', 'anexos_documentos', 'documentos_pdf', 'attachments']) {
    const docs = raw[field];
    if (!Array.isArray(docs)) continue;
    for (const doc of docs) {
      const url = [doc?.gcs_url, doc?.pdf_url, doc?.urlDescarga, doc?.url_descarga, doc?.urlVer, doc?.url]
        .find((candidate) => typeof candidate === 'string' && candidate.startsWith('https://'));
      if (url) urls.add(url);
    }
  }
  return [...urls];
}
