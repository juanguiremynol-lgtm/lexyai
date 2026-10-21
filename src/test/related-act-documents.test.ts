import { describe, it, expect } from 'vitest';
import { relatedActDocuments } from '@/lib/related-act-documents';

const hash = 'a'.repeat(64);
const communication = { id: 'communication', work_item_id: 'case-a', act_date: '2026-10-13', description: 'Envío de Comunicación', raw_data: { anotacion: `Se comunica:Auto inadmitiendo la demanda de fecha 09/10/2026 enviado a persona Total adjuntos:1Certificados adjuntos:${hash},` } };
const original = { id: 'auto', work_item_id: 'case-a', act_date: '2026-10-09', description: 'Auto inadmitiendo la demanda - detail', documentos: [{ gcs_url: 'https://storage.googleapis.com/andromeda-samai-documentos-2026/samai/case/file.pdf', descarga_estado: 'descargado_y_leido', pdf_verificacion: { sha256: hash, bytes: 164460, paginas: 3, paginas_leidas: 3, pertenencia: { work_item_id: 'case-a', act_id: 'auto' } } }] };
describe('Related communication providencia', () => {
  it('requires same work item, explicit communicated title/date and fully read attributed certificate', () => {
    expect(relatedActDocuments(communication, [original])).toHaveLength(1);
    expect(relatedActDocuments(communication, [{ ...original, work_item_id: 'case-b' }])).toHaveLength(0);
    expect(relatedActDocuments({ ...communication, raw_data: { anotacion: hash } }, [original])).toHaveLength(0);
    expect(relatedActDocuments(communication, [{ ...original, act_date: '2026-10-10' }])).toHaveLength(0);
  });
  it('never promotes a hash or URL alone and never counts duplicate descriptors twice', () => {
    expect(relatedActDocuments(communication, [{ ...original, documentos: [{ gcs_url: 'https://storage.googleapis.com/andromeda-samai-documentos-2026/samai/case/file.pdf', sha256: hash }] }])).toHaveLength(0);
    expect(relatedActDocuments(communication, [{ ...original, documentos: [...original.documentos, ...original.documentos] }])).toHaveLength(1);
  });
});