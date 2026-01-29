/**
 * Sync Settings Toggle
 * Allows users to enable/disable automatic sync for a work item
 */

import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SyncSettingsToggleProps {
  workItemId: string;
  monitoringEnabled: boolean;
  className?: string;
  showLabel?: boolean;
}

export function SyncSettingsToggle({
  workItemId,
  monitoringEnabled,
  className,
  showLabel = true
}: SyncSettingsToggleProps) {
  const queryClient = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase
        .from('work_items')
        .update({ monitoring_enabled: enabled })
        .eq('id', workItemId);

      if (error) throw error;
      return enabled;
    },
    onSuccess: (enabled) => {
      queryClient.invalidateQueries({ queryKey: ['work-item', workItemId] });
      queryClient.invalidateQueries({ queryKey: ['work-items'] });
      toast({
        title: enabled ? 'Sincronización activada' : 'Sincronización desactivada',
        description: enabled
          ? 'Este proceso se actualizará automáticamente'
          : 'Este proceso no se actualizará automáticamente',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'No se pudo cambiar la configuración',
        variant: 'destructive',
      });
    }
  });

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Switch
        id={`sync-toggle-${workItemId}`}
        checked={monitoringEnabled}
        onCheckedChange={(checked) => toggleMutation.mutate(checked)}
        disabled={toggleMutation.isPending}
      />
      {showLabel && (
        <Label
          htmlFor={`sync-toggle-${workItemId}`}
          className="flex items-center gap-1.5 text-sm cursor-pointer"
        >
          <RefreshCw className={cn(
            "h-3.5 w-3.5",
            toggleMutation.isPending && "animate-spin"
          )} />
          Sincronización automática
        </Label>
      )}
    </div>
  );
}
