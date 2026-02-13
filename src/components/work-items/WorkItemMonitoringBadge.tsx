/**
 * WorkItemMonitoringBadge — Shows monitoring status and allows suspend/resume/correct radicado
 * 
 * States:
 * 1. monitoring_enabled=true, provider_reachable=true → Green "Monitoreado"
 * 1b. scrape_status='SCRAPING' or transient error → Blue "Scraping en progreso"
 * 2. monitoring_enabled=true, provider_reachable=false → Yellow "Sin respuesta"
 * 3. monitoring_enabled=false, demonitor_reason set → Orange "Suspendido" (AI or user)
 * 4. monitoring_enabled=false, no reason → Gray "Monitoreo inactivo"
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Pencil,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { suspendMonitoring, reactivateMonitoring } from "@/lib/services/atenia-ai-engine";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const TRANSIENT_SCRAPE_STATUSES = ['SCRAPING', 'SCRAPING_PENDING'];
const TRANSIENT_ERROR_CODES = ['SCRAPING_TIMEOUT', 'SCRAPING_PENDING', 'SCRAPING_TIMEOUT_RETRY_SCHEDULED'];

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
    last_error_code?: string | null;
    radicado?: string | null;
  };
  onUpdate?: () => void;
}

export function WorkItemMonitoringBadge({ workItem, onUpdate }: WorkItemMonitoringProps) {
  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [editingRadicado, setEditingRadicado] = useState(false);
  const [newRadicado, setNewRadicado] = useState(workItem.radicado || "");

  const isAIDemonitored = !workItem.monitoring_enabled && !!workItem.demonitor_reason?.startsWith('Atenia AI');
  const isUserDemonitored = !workItem.monitoring_enabled && !!workItem.demonitor_reason && !isAIDemonitored;
  const isManuallyDisabled = !workItem.monitoring_enabled && !workItem.demonitor_reason;
  const isEmptyResult = workItem.monitoring_enabled && workItem.last_error_code === 'PROVIDER_EMPTY_RESULT';
  const isScrapingInProgress = workItem.monitoring_enabled && !isEmptyResult && (
    TRANSIENT_SCRAPE_STATUSES.includes(workItem.scrape_status || '') ||
    TRANSIENT_ERROR_CODES.includes(workItem.last_error_code || '')
  );
  const isUnreachable = workItem.monitoring_enabled && !isScrapingInProgress && !isEmptyResult && workItem.provider_reachable === false;
  const isHealthy = workItem.monitoring_enabled && !isScrapingInProgress && !isEmptyResult && workItem.provider_reachable !== false;

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
      toast.success('Monitoreo reactivado. Se buscará información en la próxima sincronización.');
      onUpdate?.();
    } catch {
      toast.error('Error al reactivar el monitoreo');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRadicadoUpdate = async () => {
    // Normalize: strip underscores, dashes, spaces, dots, tabs, non-digits
    const cleaned = newRadicado.replace(/[^0-9]/g, '');
    if (cleaned.length !== 23) {
      toast.error('El radicado debe tener exactamente 23 dígitos después de normalizar');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase
        .from('work_items')
        .update({
          radicado: cleaned,
          radicado_verified: false,
          monitoring_enabled: true,
          demonitor_reason: null,
          demonitor_at: null,
          consecutive_404_count: 0,
          provider_reachable: true,
          scrape_status: 'NOT_ATTEMPTED',
          updated_at: new Date().toISOString(),
        })
        .eq('id', workItem.id);

      if (error) throw error;

      toast.success('Radicado actualizado. Se sincronizará automáticamente en el próximo ciclo programado.');
      setEditingRadicado(false);
      onUpdate?.();

      // NOTE: User-triggered sync removed. Daily cron / Atenia AI will hydrate automatically.
    } catch {
      toast.error('Error al actualizar el radicado');
    } finally {
      setIsLoading(false);
    }
  };

  // Inline radicado editor
  const radicadoEditor = editingRadicado && (
    <div className="flex items-center gap-2 mt-2 ml-6">
      <Input
        value={newRadicado}
        onChange={(e) => setNewRadicado(e.target.value)}
        placeholder="23 dígitos del radicado"
        className="h-8 text-sm font-mono max-w-[260px]"
      />
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={handleRadicadoUpdate}
        disabled={isLoading}
      >
        <Check className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={() => { setEditingRadicado(false); setNewRadicado(workItem.radicado || ""); }}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );

  // State 1c: Provider returned empty — not a bug, case may not be digitized yet
  if (isEmptyResult) {
    return (
      <div className="flex items-center gap-1">
        <Badge variant="outline" className="gap-1 border-slate-400/50 text-muted-foreground">
          <Activity className="h-3 w-3" />
          Sin eventos digitales
        </Badge>
        <span className="text-[10px] text-muted-foreground max-w-[220px]">
          El portal judicial no registra eventos digitales para este radicado aún. Se verificará periódicamente.
        </span>
      </div>
    );
  }

  // State 1b: Scraping in progress (transient state, retry scheduled)
  if (isScrapingInProgress) {
    return (
      <div className="flex items-center gap-1">
        <Badge variant="outline" className="gap-1 border-blue-500/50 text-blue-600">
          <Loader2 className="h-3 w-3 animate-spin" />
          Sincronizando — reintento programado
        </Badge>
      </div>
    );
  }

  // State 1: Healthy
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
              <AlertDialogTitle>¿Suspender monitoreo de este asunto?</AlertDialogTitle>
              <AlertDialogDescription>
                ATENIA dejará de buscar actuaciones y publicaciones nuevas para este radicado
                en las sincronizaciones automáticas. Puedes reactivar el monitoreo en cualquier momento.
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

  // State 2: Unreachable (monitoring active but provider not finding data)
  if (isUnreachable) {
    return (
      <div className="flex items-center gap-1">
        <Badge variant="outline" className="gap-1 border-yellow-500/50 text-yellow-600">
          <AlertTriangle className="h-3 w-3" />
          Sin datos en las últimas {workItem.consecutive_404_count || 0} consultas
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
              <AlertDialogTitle>¿Suspender monitoreo de este asunto?</AlertDialogTitle>
              <AlertDialogDescription>
                El radicado no ha sido encontrado en los sistemas judiciales recientemente.
                ATENIA dejará de buscar actuaciones y publicaciones nuevas.
                Puedes reactivar el monitoreo en cualquier momento.
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

  // State 3: Suspended (by AI or user) — expanded card with reason + actions
  if (isAIDemonitored || isUserDemonitored) {
    const suspendedByAI = isAIDemonitored;
    return (
      <>
        <Card className="border-orange-200 bg-orange-50 dark:border-orange-900/50 dark:bg-orange-950/20">
          <CardContent className="py-3 px-4 space-y-2">
            <div className="flex items-start gap-2">
              {suspendedByAI ? (
                <Bot className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
              ) : (
                <Pause className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
              )}
              <div className="space-y-1 flex-1">
                <p className="text-sm font-medium text-orange-700 dark:text-orange-400">
                  Monitoreo Suspendido
                </p>
                <p className="text-xs text-muted-foreground">
                  Este asunto no está siendo sincronizado automáticamente.
                </p>
                {workItem.demonitor_reason && (
                  <p className="text-xs text-muted-foreground">
                    Razón: {workItem.demonitor_reason}
                  </p>
                )}
                {workItem.demonitor_at && (
                  <p className="text-xs text-muted-foreground">
                    Suspendido: {format(new Date(workItem.demonitor_at), "d 'de' MMMM 'de' yyyy", { locale: es })}
                  </p>
                )}
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
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setEditingRadicado(true); setNewRadicado(workItem.radicado || ""); }}
                disabled={isLoading}
                className="gap-1"
              >
                <Pencil className="h-3 w-3" />
                Corregir Radicado
              </Button>
            </div>
            {radicadoEditor}
          </CardContent>
        </Card>
      </>
    );
  }

  // State 4: Manually disabled (no reason)
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
