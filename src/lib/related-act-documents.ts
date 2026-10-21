import { actDocumentPresentation } from './act-document-presentation';

interface RelatedAct {
  id: string;
  work_item_id: string;
  act_date: string | null;
  description: string;
  documentos?: unknown;
  raw_data?: Record<string, unknown> | null;
}

/** Resolve a communication's explicitly cited certificate against a fully read
 * document in this same work item. This is a related providencia, not the
 * communication's original attachment; native descriptors remain untouched. */
export function relatedActDocuments(act: RelatedAct, candidates: RelatedAct[]) {
  const annotation = String(act.raw_data?.anotacion ?? act.description);
  if (!/Env[ií]o de Comunicaci[oó]n/i.test(act.description)) return [];
  const communicated = annotation.match(/Se comunica:\s*(.+?)\s+de fecha\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  const certificates = annotation.match(/Certificados adjuntos:([A-Fa-f0-9,\s]+)/i)?.[1]
    .match(/\b[a-f0-9]{64}\b/gi)?.map(hash => hash.toLowerCase()) ?? [];
  if (!communicated || !certificates.length) return [];
  const date = `${communicated[4]}-${communicated[3]}-${communicated[2]}`;
  const title = communicated[1].trim().toLocaleLowerCase('es');
  const seen = new Set<string>();
  return candidates.flatMap(candidate => {
    if (candidate.id === act.id || candidate.work_item_id !== act.work_item_id
      || candidate.act_date !== date || candidate.description.split(' - ')[0].trim().toLocaleLowerCase('es') !== title) return [];
    const docs = Array.isArray(candidate.documentos) ? candidate.documentos : [];
    return docs.flatMap(value => {
      if (!value || typeof value !== 'object') return [];
      const doc = value as Record<string, any>;
      const hash = String(doc.pdf_verificacion?.sha256 ?? '').toLowerCase();
      if (!certificates.includes(hash) || seen.has(hash) || !actDocumentPresentation(doc).stored
        || doc.descarga_estado !== 'descargado_y_leido'
        || doc.pdf_verificacion?.pertenencia?.work_item_id !== act.work_item_id
        || doc.pdf_verificacion?.pertenencia?.act_id !== candidate.id) return [];
      seen.add(hash);
      return [{ document: doc, actId: candidate.id, date, title: candidate.description.split(' - ')[0] }];
    });
  });
}