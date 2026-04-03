/**
 * WorkItemMonitoringToggle
 *
 * Allows users to enable/disable monitoring for a work item.
 * When auto-demonitored by Atenia AI, shows the reason and allows one-click reactivation.
 */

import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { syncCpnuPausar, syncCpnuReactivar } from '@/lib/services/cpnu-sync-service';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { AlertTriangle, Bot, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  workItemId: string;
  workflowType?: string;
  monitoringEnabled: boolean;
  monitoringDisabledReason?: string | null;
  monitoringDisabledBy?: string | null;
  monitoringDisabledAt?: string | null;
  monitoringDisabledMeta?: Record<string, unknown> | null;
  onChanged?: () => void;
}

export function WorkItemMonitoringToggle({
  workItemId,
  monitoringEnabled,
  monitoringDisabledReason,
  monitoringDisabledBy,
  monitoringDisabledAt,
  monitoringDisabledMeta,
  onChanged,
}: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const isAutoDemonitored = monitoringDisabledBy === 'ATENIA';

  async function disable() {
    setSaving(true);
    const { error } = await (supabase.from('work_items') as any).update({
      monitoring_enabled: false,
      monitoring_disabled_reason: reason || 'USER_DEMONITOR',
      monitoring_disabled_by: 'USER',
      monitoring_disabled_at: new Date().toISOString(),
      monitoring_disabled_meta: { note: reason || null },
    }).eq('id', workItemId);

    setSaving(false);
    setOpen(false);

    if (error) {
      toast.error('Error al suspender monitoreo');
      return;
    }
    toast.success('Monitoreo suspendido');
    onChanged?.();
  }

  async function enable() {
    setSaving(true);
    const { error } = await (supabase.from('work_items') as any).update({
      monitoring_enabled: true,
      monitoring_disabled_reason: null,
      monitoring_disabled_by: null,
      monitoring_disabled_at: null,
      monitoring_disabled_meta: null,
    }).eq('id', workItemId);

    setSaving(false);

    if (error) {
      toast.error('Error al reactivar monitoreo');
      return;
    }
    toast.success('Monitoreo reactivado');
    onChanged?.();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Switch
          checked={monitoringEnabled}
          onCheckedChange={(v) => {
            if (v) enable();
            else setOpen(true);
          }}
          disabled={saving}
        />
        <span className="text-sm font-medium">
          {monitoringEnabled ? 'Monitoreo activo' : 'Monitoreo suspendido'}
        </span>
      </div>

      {/* Auto-demonitor banner */}
      {!monitoringEnabled && isAutoDemonitored && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
            <Bot className="h-4 w-4" />
            Suspendido automáticamente por Andro IA
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {monitoringDisabledReason === 'AUTO_DEMONITOR_NOT_FOUND'
              ? `Tras ${(monitoringDisabledMeta as any)?.consecutive_not_found ?? 'múltiples'} intentos consecutivos, el radicado no fue encontrado en el proveedor. Esto evita reintentos innecesarios.`
              : monitoringDisabledReason || 'Razón no especificada.'}
          </p>
          {monitoringDisabledAt && (
            <p className="text-[10px] text-amber-600 dark:text-amber-500">
              Suspendido el {new Date(monitoringDisabledAt).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={enable}
            disabled={saving}
            className="gap-1.5 text-xs mt-1"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reactivar monitoreo
          </Button>
        </div>
      )}

      {/* Manual demonitor reason */}
      {!monitoringEnabled && !isAutoDemonitored && monitoringDisabledReason && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>Razón: {monitoringDisabledReason}</span>
        </div>
      )}

      {/* Disable dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspender monitoreo</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Esto evita reintentos y alertas para este asunto. Puede reactivarlo en cualquier momento.
          </p>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Razón (ej. 'No existe en CPNU/SAMAI', 'Radicado mal digitado', etc.)"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={disable} disabled={saving}>
              Suspender
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
