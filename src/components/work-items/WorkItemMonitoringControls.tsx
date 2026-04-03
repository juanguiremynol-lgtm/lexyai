/**
 * WorkItemMonitoringControls — Full management panel for work item monitoring
 *
 * Four actions:
 *  1. Pausar monitoreo (if active)
 *  2. Reactivar monitoreo (if paused)
 *  3. Cerrar radicado (always visible, with confirmation)
 *  4. Eliminar (always visible, with confirmation)
 *
 * All actions update Supabase first; CGP items also fire-and-forget to CPNU API.
 */

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  syncCpnuPausar,
  syncCpnuReactivar,
  syncCpnuCerrar,
  syncCpnuEliminar,
} from "@/lib/services/cpnu-sync-service";
import { softDeleteWorkItem } from "@/lib/services/work-item-delete-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  RotateCcw,
  Zap,
  Clock,
  AlertTriangle,
  Pause,
  Lock,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useNavigate } from "react-router-dom";

interface WorkItemMonitoringControlsProps {
  workItem: {
    id: string;
    radicado?: string;
    workflow_type?: string;
    stage?: string;
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

type ConfirmAction = "pausar" | "cerrar" | "eliminar" | null;

export function WorkItemMonitoringControls({
  workItem,
  onUpdate,
}: WorkItemMonitoringControlsProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [reason, setReason] = useState("");
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const isCGP = workItem.workflow_type === "CGP";
  const isClosed = workItem.stage === "CLOSED";

  // ── Pausar ──────────────────────────────────────────────
  const pausarMutation = useMutation({
    mutationFn: async (razon: string) => {
      const { error } = await supabase
        .from("work_items")
        .update({
          monitoring_enabled: false,
          monitoring_suspended_at: new Date().toISOString(),
          monitoring_suspended_reason: razon || "USER_SUSPENDED",
          updated_at: new Date().toISOString(),
        })
        .eq("id", workItem.id);
      if (error) throw error;
    },
    onSuccess: (_, razon) => {
      toast.success("Monitoreo pausado");
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
      if (isCGP) void syncCpnuPausar(workItem.id, razon).catch(console.warn);
      closeDialog();
      onUpdate();
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  // ── Reactivar ───────────────────────────────────────────
  const reactivarMutation = useMutation({
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
      if (isCGP) void syncCpnuReactivar(workItem.id).catch(console.warn);
      onUpdate();
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  // ── Cerrar radicado ─────────────────────────────────────
  const cerrarMutation = useMutation({
    mutationFn: async (razon: string) => {
      const { error } = await supabase
        .from("work_items")
        .update({
          stage: "CLOSED",
          monitoring_enabled: false,
          monitoring_suspended_reason: razon || "Cerrado por usuario",
          updated_at: new Date().toISOString(),
        })
        .eq("id", workItem.id);
      if (error) throw error;
    },
    onSuccess: (_, razon) => {
      toast.success("Radicado cerrado");
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
      if (isCGP) void syncCpnuCerrar(workItem.id, razon).catch(console.warn);
      closeDialog();
      onUpdate();
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  // ── Eliminar ────────────────────────────────────────────
  const eliminarMutation = useMutation({
    mutationFn: async (razon: string) => {
      if (!userId) throw new Error("Usuario no identificado");
      const result = await softDeleteWorkItem(supabase, workItem.id, userId, razon);
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      toast.success("Asunto eliminado");
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      closeDialog();
      navigate("/app/work-items");
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  function closeDialog() {
    setConfirmAction(null);
    setReason("");
  }

  function handleConfirm() {
    switch (confirmAction) {
      case "pausar":
        pausarMutation.mutate(reason);
        break;
      case "cerrar":
        cerrarMutation.mutate(reason);
        break;
      case "eliminar":
        eliminarMutation.mutate(reason);
        break;
    }
  }

  const isPending =
    pausarMutation.isPending ||
    reactivarMutation.isPending ||
    cerrarMutation.isPending ||
    eliminarMutation.isPending;

  const dialogConfig: Record<string, { title: string; description: string; confirmLabel: string; variant: "destructive" | "default" }> = {
    pausar: {
      title: "Pausar monitoreo",
      description: "El monitoreo se detendrá temporalmente. Puede reactivarlo en cualquier momento.",
      confirmLabel: "Pausar",
      variant: "destructive",
    },
    cerrar: {
      title: "Cerrar radicado",
      description: "El radicado se marcará como cerrado (proceso terminado). El monitoreo se desactivará.",
      confirmLabel: "Cerrar radicado",
      variant: "destructive",
    },
    eliminar: {
      title: "Eliminar asunto",
      description: "El asunto será eliminado y será recuperable durante 10 días. Esta acción desactiva el monitoreo.",
      confirmLabel: "Eliminar",
      variant: "destructive",
    },
  };

  const currentDialog = confirmAction ? dialogConfig[confirmAction] : null;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Gestión de Monitoreo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status badge */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Estado actual:</span>
            <Badge variant={workItem.monitoring_enabled ? "default" : isClosed ? "secondary" : "destructive"}>
              {isClosed
                ? "🔒 Cerrado"
                : workItem.monitoring_enabled
                  ? "🟢 Monitoreo activo"
                  : "⏸️ Pausado"}
            </Badge>
          </div>

          {/* Suspension reason */}
          {!workItem.monitoring_enabled && workItem.monitoring_suspended_reason && !isClosed && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-medium">Razón de la pausa:</span>
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

          {/* Failure metrics */}
          {workItem.monitoring_enabled && (workItem.consecutive_failures || 0) > 0 && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-destructive" />
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

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pt-2">
            {/* Pausar / Reactivar — mutually exclusive */}
            {workItem.monitoring_enabled && !isClosed ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmAction("pausar")}
                disabled={isPending}
                className="gap-1.5 border border-border"
              >
                <Pause className="h-3.5 w-3.5" />
                Pausar monitoreo
              </Button>
            ) : !isClosed ? (
              <Button
                variant="default"
                size="sm"
                onClick={() => reactivarMutation.mutate()}
                disabled={isPending}
                className="gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {reactivarMutation.isPending ? "Reactivando..." : "Reactivar monitoreo"}
              </Button>
            ) : null}

            {/* Cerrar — always visible unless already closed */}
            {!isClosed && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmAction("cerrar")}
                disabled={isPending}
                className="gap-1.5 border border-border"
              >
                <Lock className="h-3.5 w-3.5" />
                Cerrar radicado
              </Button>
            )}

            {/* Eliminar — always visible */}
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmAction("eliminar")}
              disabled={isPending}
              className="gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Eliminar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation dialog */}
      <Dialog open={!!confirmAction} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{currentDialog?.title}</DialogTitle>
            <DialogDescription>{currentDialog?.description}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Razón (opcional)"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isPending}>
              Cancelar
            </Button>
            <Button
              variant={currentDialog?.variant || "destructive"}
              onClick={handleConfirm}
              disabled={isPending}
            >
              {isPending ? "Procesando..." : currentDialog?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
