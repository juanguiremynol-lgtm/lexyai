import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { providerRunInstant, providerRunPresentation, type ProviderRun } from '@/lib/provider-run-presentation';

export function ProviderRunSummary({ workItemId, source }: { workItemId: string; source: string }) {
  const { data = [] } = useQuery({
    queryKey: ['provider-run-summary', workItemId, source],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_item_sync_timeline').select('provider,status,finished_at,error_code,records_inserted,records_skipped')
        .eq('work_item_id', workItemId).eq('provider', source).eq('operation', 'acts').order('finished_at', { ascending: false }).limit(20);
      if (error) throw error;
      return (data ?? []) as ProviderRun[];
    },
  });
  const { latest, success, accounted } = providerRunPresentation(data, source);
  if (!latest) return null;
  return <div className="space-y-1 border-t border-border pt-2 text-xs" aria-label={`Ejecución de ingesta ${source}`}>
    <p>Último intento de ingesta: <strong>{latest.status}</strong> · {providerRunInstant(latest.finished_at)} (Bogotá){latest.error_code ? ` · ${latest.error_code}` : ''}</p>
    {success && <p>Última ingesta confirmada: {providerRunInstant(success.finished_at)} (Bogotá) · {accounted} registros procesados, incluidos los ya existentes.</p>}
  </div>;
}