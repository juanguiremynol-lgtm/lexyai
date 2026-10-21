import { ActDocumentLinks } from './ActDocumentLinks';
import { relatedActDocuments } from '@/lib/related-act-documents';
import { formatCivilDate } from '@/lib/civil-date';
import type { WorkItemAct } from '@/pages/WorkItemDetail/tabs/WorkItemActCard';

export function RelatedActDocuments({ act, acts }: { act: WorkItemAct; acts: WorkItemAct[] }) {
  const related = relatedActDocuments(act, acts);
  if (!related.length) return null;
  return <section aria-label="Providencia relacionada con la comunicación" className="mt-2 space-y-2 border-t border-border pt-2 text-xs">
    {related.map(item => <div key={item.actId} className="space-y-1">
      <p className="font-medium">Providencia relacionada: {item.title} · {formatCivilDate(item.date)}</p>
      <p className="text-muted-foreground">Copia de la providencia citada por la comunicación; no es su anexo original.</p>
      <ActDocumentLinks document={item.document} />
    </div>)}
  </section>;
}