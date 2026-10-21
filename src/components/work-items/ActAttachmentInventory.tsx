import { Link } from 'react-router-dom';
import { ActDocumentLinks } from './ActDocumentLinks';
import { extractActDocumentos, actDocumentoLabel } from '@/lib/act-documentos';
import { summarizeActAttachments, knownDocumentPendingCause } from '@/lib/act-attachments-inventory';
import { externalDisplayModeFor } from '@/lib/externalSyncDisplay';

export interface ActAttachmentInventoryProps {
  act: {
    id: string;
    work_item_id: string;
    radicado?: string;
    workflow_type?: string | null;
    source?: string;
    description?: string | null;
    documentos?: unknown;
    documentos_observados_en?: string | null;
    raw_data?: Record<string, unknown> | null;
  };
}

/** The global acts view shares document actions with the canonical act card.
 * A linked public publication remains a publication, never a second act. */
export function ActAttachmentInventory({ act }: ActAttachmentInventoryProps) {
  const raw = (act.raw_data || {}) as Record<string, unknown>;
  const descriptors = [
    ...extractActDocumentos(act.documentos),
    ...(act.source?.toLowerCase().includes('samai') ? extractActDocumentos(raw.anexos_documentos) : []),
  ];
  const seen = new Set<string>();
  const documents = descriptors.filter((doc, index) => {
    const d = doc as Record<string, unknown>;
    // Include request identity: two origins sharing stored bytes stay separate.
    const native = d.id || d.id_documento || d.tokenDocumento;
    const link = d.url_origen || d.urlDescargaOriginal || d.urlDescarga || d.url || d.gcs_url || d.urlVer;
    const key = native || link ? JSON.stringify([d.solicitud || '', native || link]) : `unlinked:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const inventory = summarizeActAttachments({ ...act, documentos: documents } as any);
  const backups = Array.isArray(raw.documentos_respaldo_publico)
    ? (raw.documentos_respaldo_publico as unknown[]).filter((d): d is Record<string, unknown> => !!d && typeof d === 'object'
      && typeof (d as any).publicacion_id === 'string' && /^[a-f\d-]{36}$/i.test((d as any).publicacion_id)) : [];
  if (!documents.length && inventory.anunciados === null && !act.documentos_observados_en && !backups.length) return null;
  const detail = act.radicado ? `/app/radicados/${encodeURIComponent(act.radicado)}` : `/app/work-items/${act.work_item_id}`;
  const tab = externalDisplayModeFor(act.workflow_type);
  return <section className="space-y-2 rounded-md border p-3 text-xs" aria-label="Documentos de la actuación">
    <p className="font-medium">{inventory.anunciados === null ? 'Documentos de la actuación' : `${inventory.anunciados} anexo(s) anunciado(s)`}</p>
    <p className="text-muted-foreground">{inventory.causa}</p>
    {documents.map((doc, index) => {
      const pending = knownDocumentPendingCause(doc);
      return <div key={index} className="space-y-1 border-l border-border pl-2">
        <p className="font-medium">{actDocumentoLabel(doc, index)}</p>
        <ActDocumentLinks document={doc as Record<string, any>} />
        {pending && <p className="text-muted-foreground">{pending}</p>}
      </div>;
    })}
    {backups.map(backup => {
      const pages = Array.isArray(backup.paginas) ? backup.paginas.filter((n): n is number => Number.isSafeInteger(n) && (n as number) > 0) : [];
      return <div key={String(backup.publicacion_id)} className="space-y-1 border-l border-border pl-2">
        <p>Paquete público vinculado{pages.length ? `; páginas ${pages.join(', ')}` : ''}. La publicación conserva su categoría y el paquete contiene otros procesos.</p>
        <Link className="text-primary underline" to={`${detail}${tab !== 'none' ? `?tab=${tab}` : ''}`}>Ver publicación vinculada en el proceso</Link>
      </div>;
    })}
  </section>;
}
