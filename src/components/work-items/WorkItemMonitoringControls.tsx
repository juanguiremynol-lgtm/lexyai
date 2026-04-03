/**
 * WorkItemMonitoringControls — Suspend/reactivate monitoring for a work item
 *
 * Shows monitoring status badge and provides controls for admins to:
 * - Suspend monitoring (with reason)
 * - Reactivate monitoring (resets failure counters)
 * - View last error details
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { syncCpnuPausar, syncCpnuReactivar } from "@/lib/services/cpnu-sync-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, RotateCcw, Zap, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface WorkItemMonitoringControlsProps {
  workItem: {
    id: string;
    radicado?: string;
    workflow_type?: string;
    monitoring_enabled: boolean;
    monitoring_suspended_at?: string | null;
    monitoring_suspended_reason?: string | null;
    consecutive_failures?: number;
    consecutive_not_found?: number;
    last_error_code?: string | null;
    last_attempted_sync_at?: string | null;
  };
  onUpdate: () => void;
}

const SUSPENSION_REASONS: Record<string, string> = {
  USER_SUSPENDED: "Suspendido manualmente por usuario",
  AUTO_NOT_DIGITIZED: "Posiblemente no digitalizado (consultas vacías)",
  AUTO_PROVIDER_NOT_FOUND: "Proveedor no encontró el radicado",
  AUTO_CONSECUTIVE_FAILURES: "Demasiados errores consecutivos",
};

export function WorkItemMonitoringControls({ workItem, onUpdate }: WorkItemMonitoringControlsProps) {
  const queryClient = useQueryClient();

  const suspendMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("work_items")
        .update({
          monitoring_enabled: false,
          monitoring_suspended_at: new Date().toISOString(),
          monitoring_suspended_reason: "USER_SUSPENDED",
          updated_at: new Date().toISOString(),
        })
        .eq("id", workItem.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Monitoreo suspendido");
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
      onUpdate();
    },
    onError: (err: any) => {
      toast.error(`Error: ${err.message}`);
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("work_items")
        .update({
          monitoring_enabled: true,
          monitoring_suspended_at: null,
          monitoring_suspended_reason: null,
          consecutive_failures: 0,
          consecutive_not_found: 0,
          last_error_code: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", workItem.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Monitoreo reactivado");
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
      onUpdate();
    },
    onError: (err: any) => {
      toast.error(`Error: ${err.message}`);
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4" />
          Control de Monitoreo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Estado actual:</span>
          <Badge variant={workItem.monitoring_enabled ? "default" : "destructive"}>
            {workItem.monitoring_enabled
              ? "🟢 Monitoreo activo"
              : `⏸️ Suspendido`}
          </Badge>
        </div>

        {/* Suspension reason if applicable */}
        {!workItem.monitoring_enabled && workItem.monitoring_suspended_reason && (
          <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Razón de la suspensión:</span>
            </div>
            <p className="text-foreground">
              {SUSPENSION_REASONS[workItem.monitoring_suspended_reason] || workItem.monitoring_suspended_reason}
            </p>
            {workItem.monitoring_suspended_at && (
              <p className="text-xs text-muted-foreground">
                {format(new Date(workItem.monitoring_suspended_at), "d MMM yyyy, HH:mm", { locale: es })}
              </p>
            )}
          </div>
        )}

        {/* Failure metrics if monitoring is enabled */}
        {workItem.monitoring_enabled && (workItem.consecutive_failures || 0) > 0 && (
          <div className="rounded-lg bg-warning/10 p-3 text-sm space-y-1">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-warning" />
              <span className="font-medium">Fallos consecutivos:</span>
            </div>
            <p className="text-foreground">
              {workItem.consecutive_failures} fallos
              {workItem.last_error_code && ` — ${workItem.last_error_code}`}
            </p>
            {workItem.last_attempted_sync_at && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Último intento: {format(new Date(workItem.last_attempted_sync_at), "d MMM yyyy, HH:mm", { locale: es })}
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          {workItem.monitoring_enabled ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => suspendMutation.mutate()}
              disabled={suspendMutation.isPending}
            >
              {suspendMutation.isPending ? "Suspendiendo..." : "Suspender monitoreo"}
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={() => reactivateMutation.mutate()}
              disabled={reactivateMutation.isPending}
            >
              {reactivateMutation.isPending ? (
                "Reactivando..."
              ) : (
                <>
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Reactivar monitoreo
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
