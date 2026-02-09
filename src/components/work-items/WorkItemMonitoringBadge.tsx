/**
 * WorkItemMonitoringBadge — Shows monitoring status and allows suspend/resume
 * 
 * States:
 * 1. monitoring_enabled=true, provider_reachable=true → Green "Monitoreado"
 * 2. monitoring_enabled=true, provider_reachable=false → Yellow "Sin respuesta"
 * 3. monitoring_enabled=false, demonitor_reason set → Orange "Suspendido por Atenia AI"
 * 4. monitoring_enabled=false, no reason → Gray "Monitoreo inactivo"
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Activity,
  AlertTriangle,
  Pause,
  Play,
  Bot,
} from "lucide-react";
import { toast } from "sonner";
import { suspendMonitoring, reactivateMonitoring } from "@/lib/services/atenia-ai-engine";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface WorkItemMonitoringProps {
  workItem: {
    id: string;
    organization_id?: string;
    monitoring_enabled: boolean;
    demonitor_reason?: string | null;
    demonitor_at?: string | null;
    consecutive_404_count?: number;
    provider_reachable?: boolean;
    scrape_status?: string;
  };
  onUpdate?: () => void;
}

export function WorkItemMonitoringBadge({ workItem, onUpdate }: WorkItemMonitoringProps) {
  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const isAIDemonitored = !workItem.monitoring_enabled && !!workItem.demonitor_reason?.startsWith('Atenia AI');
  const isManuallyDisabled = !workItem.monitoring_enabled && !isAIDemonitored;
  const isUnreachable = workItem.monitoring_enabled && workItem.provider_reachable === false;
  const isHealthy = workItem.monitoring_enabled && workItem.provider_reachable !== false;

  const handleSuspend = async () => {
    if (!workItem.organization_id) return;
    setIsLoading(true);
    try {
      await suspendMonitoring(workItem.id, workItem.organization_id, 'Suspendido manualmente por el usuario');
      toast.info('Monitoreo suspendido para este asunto');
      onUpdate?.();
    } catch {
      toast.error('Error al suspender el monitoreo');
    } finally {
      setIsLoading(false);
      setShowSuspendDialog(false);
    }
  };

  const handleReactivate = async () => {
    if (!workItem.organization_id) return;
    setIsLoading(true);
    try {
      await reactivateMonitoring(workItem.id, workItem.organization_id);
      toast.success('Monitoreo reactivado');
      onUpdate?.();
    } catch {
      toast.error('Error al reactivar el monitoreo');
    } finally {
      setIsLoading(false);
    }
  };

  // Compact badge for header
  if (isHealthy) {
    return (
      <div className="flex items-center gap-1">
        <Badge variant="outline" className="gap-1 border-emerald-500/50 text-emerald-600">
          <Activity className="h-3 w-3" />
          Monitoreado
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setShowSuspendDialog(true)}
          title="Suspender monitoreo"
        >
          <Pause className="h-3 w-3" />
        </Button>

        <AlertDialog open={showSuspendDialog} onOpenChange={setShowSuspendDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Suspender monitoreo?</AlertDialogTitle>
              <AlertDialogDescription>
                Se dejará de sincronizar automáticamente este asunto con los sistemas judiciales.
                Podrás reactivarlo en cualquier momento.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleSuspend} disabled={isLoading}>
                Suspender
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  if (isUnreachable) {
    return (
      <Badge variant="outline" className="gap-1 border-yellow-500/50 text-yellow-600">
        <AlertTriangle className="h-3 w-3" />
        Sin respuesta ({workItem.consecutive_404_count || 0})
      </Badge>
    );
  }

  // Demonitored — show expanded card with reason
  if (isAIDemonitored) {
    return (
      <Card className="border-orange-200 bg-orange-50 dark:border-orange-900/50 dark:bg-orange-950/20">
        <CardContent className="py-3 px-4 space-y-2">
          <div className="flex items-start gap-2">
            <Bot className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
            <div className="space-y-1 flex-1">
              <p className="text-sm font-medium text-orange-700 dark:text-orange-400">
                Monitoreo Suspendido por Atenia AI
              </p>
              {workItem.demonitor_at && (
                <p className="text-xs text-muted-foreground">
                  {format(new Date(workItem.demonitor_at), "d 'de' MMMM 'de' yyyy", { locale: es })}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {workItem.demonitor_reason}
              </p>
              <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                <p>Esto puede significar:</p>
                <ul className="list-disc list-inside ml-1">
                  <li>El radicado fue digitado incorrectamente</li>
                  <li>El proceso aún no está registrado en el sistema judicial electrónico</li>
                  <li>El proceso fue archivado o migrado</li>
                </ul>
              </div>
            </div>
          </div>
          <div className="flex gap-2 ml-6">
            <Button
              size="sm"
              variant="outline"
              onClick={handleReactivate}
              disabled={isLoading}
              className="gap-1"
            >
              <Play className="h-3 w-3" />
              Reactivar Monitoreo
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Manually disabled
  if (isManuallyDisabled) {
    return (
      <div className="flex items-center gap-1">
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <Pause className="h-3 w-3" />
          Monitoreo inactivo
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleReactivate}
          disabled={isLoading}
          title="Reactivar monitoreo"
        >
          <Play className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return null;
}
