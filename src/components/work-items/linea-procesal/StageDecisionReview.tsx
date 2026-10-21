import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { formatCivilDate } from '@/lib/civil-date';
import { getStageLabel, type WorkflowType } from '@/lib/workflow-constants';

export function StageDecisionReview({ workItemId, workflowType }: { workItemId: string; workflowType: WorkflowType }) {
  const { data, error } = useQuery({
    queryKey: ['stage-decision-review', workItemId],
    queryFn: async () => {
      const { data, error } = await supabase.from('stage_projection_reviews').select('*')
        .eq('work_item_id', workItemId).order('event_date', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
  if (error) return <p className="text-sm text-destructive">No se pudo cargar la decisión pendiente de revisar.</p>;
  if (!data) return null;
  return <section className="space-y-1 border-l-2 border-primary pl-3 text-sm" aria-label="Decisión registrada y etapa por confirmar">
    <p className="font-medium">Decisión registrada · {formatCivilDate(data.event_date)}</p>
    <p>{data.event_text}</p>
    <p className="text-muted-foreground">{data.reason}</p>
    {data.suggested_stage && <p>Etapa propuesta, no confirmada: <strong>{getStageLabel(workflowType, data.suggested_stage)}</strong></p>}
    <p className="text-xs text-muted-foreground">Fuente: {data.source_relation === 'ACTUACION' ? 'actuación' : 'publicación'} · {data.source_id}</p>
  </section>;
}