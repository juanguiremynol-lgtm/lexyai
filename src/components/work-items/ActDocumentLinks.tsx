import { useState } from 'react';
import { toast } from 'sonner';
import { actDocumentPresentation } from '@/lib/act-document-presentation';
import { downloadDocument } from '@/lib/download-document';

export function ActDocumentLinks({ document: doc }: { document: Record<string, any> }) {
  const state = actDocumentPresentation(doc);
  const [downloading, setDownloading] = useState(false);
  const name = doc.nombre || doc.descripcion || 'documento.pdf';
  return <div className="flex flex-col gap-1">
    <span className={`inline-flex self-start rounded-full px-2 py-0.5 text-xs font-medium ${state.href ? 'bg-muted text-foreground' : 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'}`}>{state.label}</span>
    {state.reason && <span className="text-xs text-muted-foreground">{state.reason}</span>}
    {state.href && <div className="flex flex-wrap items-center gap-3">
      <a href={state.href} target="_blank" rel="noopener noreferrer" className="text-primary underline"
        onClick={event => {
          if (!state.stored && !window.confirm('Este enlace pertenece al origen y puede haber vencido. No hay una copia propia disponible. ¿Deseas abrirlo?')) event.preventDefault();
        }}>{state.stored ? 'Abrir archivo almacenado' : 'Abrir enlace del origen'}</a>
      {state.stored && <button type="button" className="text-primary underline disabled:opacity-50" disabled={downloading}
        onClick={async () => {
          setDownloading(true);
          try { await downloadDocument(state.href!, name); }
          catch { toast.error('No se pudo descargar la copia almacenada. Inténtalo de nuevo más tarde.'); }
          finally { setDownloading(false); }
        }}>{downloading ? 'Descargando…' : 'Descargar'}</button>}
    </div>}
  </div>;
}
