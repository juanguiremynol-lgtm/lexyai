/**
 * SyncWorkItemButton - Triggers sync of work item with external APIs
 * 
 * Calls the sync-by-work-item Edge Function which handles:
 * - Adapter resolution based on org settings
 * - External API calls (server-side only)
 * - Idempotent ingestion of actuaciones
 * - Detailed trace logging for debugging
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { RefreshCw, AlertTriangle, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WorkItem } from "@/types/work-item";
import { generateTraceId, formatSyncError } from "@/lib/sync-trace";

interface SyncWorkItemButtonProps {
  workItem: WorkItem;
  onTraceIdGenerated?: (traceId: string) => void;
}

interface SyncResult {
  ok: boolean;
  work_item_id: string;
  inserted_count: number;
  skipped_count: number;
  latest_event_date: string | null;
  source_used: string | null;
  warnings: string[];
  errors: string[];
  adapter_used?: string;
  code?: string;
  message?: string;
}

function isValidTutelaCode(code: string): boolean {
  return /^T\d{6,10}$/i.test(code);
}

function isValidRadicado(radicado: string): boolean {
  const normalized = radicado.replace(/\D/g, '');
  return normalized.length === 23;
}

export function SyncWorkItemButton({ workItem, onTraceIdGenerated }: SyncWorkItemButtonProps) {
  const queryClient = useQueryClient();
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editedRadicado, setEditedRadicado] = useState(workItem.radicado || "");
  const [editedTutelaCode, setEditedTutelaCode] = useState(workItem.tutela_code || "");
  
  const isTutela = workItem.workflow_type === "TUTELA";
  
  // Check if identifiers are present
  const hasValidIdentifier = isTutela
    ? (workItem.tutela_code && isValidTutelaCode(workItem.tutela_code)) || 
      (workItem.radicado && isValidRadicado(workItem.radicado))
    : workItem.radicado && isValidRadicado(workItem.radicado);

  // Sync mutation with trace ID
  const syncMutation = useMutation({
    mutationFn: async (): Promise<SyncResult> => {
      // Generate trace ID for debugging
      const traceId = generateTraceId();
      
      // Notify parent about the trace ID
      onTraceIdGenerated?.(traceId);
      
      const { data, error } = await supabase.functions.invoke("sync-by-work-item", {
        body: { work_item_id: workItem.id },
        headers: {
          "X-Trace-Id": traceId,
        },
      });

      if (error) {
        throw new Error(error.message || "Sync failed");
      }

      return data as SyncResult;
    },
    onSuccess: (result) => {
      if (result.ok) {
        if (result.inserted_count > 0) {
          toast.success(
            `Sincronización exitosa: ${result.inserted_count} nuevas actuaciones`,
            {
              description: result.source_used 
                ? `Fuente: ${result.source_used}` 
                : undefined,
            }
          );
        } else if (result.skipped_count > 0) {
          toast.info("Sin novedades", {
            description: `${result.skipped_count} actuaciones ya existentes`,
          });
        } else if (result.warnings.length > 0) {
          toast.warning("Sincronización parcial", {
            description: result.warnings[0],
          });
        } else {
          toast.success("Sincronización completada");
        }
      } else {
        // Use improved error message from trace utilities
        const errorMsg = formatSyncError(
          result.code || null,
          result.errors?.[0] || result.message || null
        );
        toast.error("Error de sincronización", {
          description: errorMsg,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
      queryClient.invalidateQueries({ queryKey: ["work-item-actuaciones", workItem.id] });
    },
    onError: (error: Error) => {
      toast.error("Error al sincronizar", {
        description: error.message,
      });
    },
  });

  // Update identifiers mutation
  const updateIdentifiersMutation = useMutation({
    mutationFn: async () => {
      const updates: Record<string, string | null> = {};
      
      if (isTutela) {
        if (editedTutelaCode.trim()) {
          if (!isValidTutelaCode(editedTutelaCode.trim())) {
            throw new Error("Código de tutela debe ser T seguido de 6-10 dígitos (ej: T11728622)");
          }
          updates.tutela_code = editedTutelaCode.trim().toUpperCase();
        }
      }
      
      if (editedRadicado.trim()) {
        const normalized = editedRadicado.replace(/\D/g, '');
        if (normalized.length !== 23) {
          throw new Error(`Radicado debe tener 23 dígitos (tiene ${normalized.length})`);
        }
        updates.radicado = normalized;
      }

      if (Object.keys(updates).length === 0) {
        throw new Error("Debe ingresar al menos un identificador");
      }

      const { error } = await supabase
        .from("work_items")
        .update(updates)
        .eq("id", workItem.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Identificadores actualizados");
      setShowEditDialog(false);
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
    },
    onError: (error: Error) => {
      toast.error("Error al actualizar", { description: error.message });
    },
  });

  const handleSync = () => {
    if (!hasValidIdentifier) {
      setShowEditDialog(true);
      return;
    }
    syncMutation.mutate();
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleSync}
        disabled={syncMutation.isPending}
        className="gap-2"
      >
        <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
        {syncMutation.isPending ? "Sincronizando..." : "Actualizar ahora"}
      </Button>

      {/* Edit Identifiers Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Identificador requerido
            </DialogTitle>
            <DialogDescription>
              Para sincronizar con fuentes externas, necesitas agregar el identificador del proceso.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {isTutela && (
              <div className="space-y-2">
                <Label htmlFor="tutela_code">
                  Código de Tutela (preferido)
                </Label>
                <Input
                  id="tutela_code"
                  placeholder="T11728622"
                  value={editedTutelaCode}
                  onChange={(e) => setEditedTutelaCode(e.target.value.toUpperCase())}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Formato: T seguido de 6-10 dígitos
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="radicado">
                Radicado {isTutela ? "(alternativo)" : ""}
              </Label>
              <Input
                id="radicado"
                placeholder="11001310501920240012300"
                value={editedRadicado}
                onChange={(e) => setEditedRadicado(e.target.value.replace(/\D/g, ''))}
                className="font-mono"
                maxLength={23}
                inputMode="numeric"
              />
              <p className="text-xs text-muted-foreground">
                23 dígitos (sin guiones ni espacios)
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEditDialog(false)}
              disabled={updateIdentifiersMutation.isPending}
            >
              <X className="h-4 w-4 mr-2" />
              Cancelar
            </Button>
            <Button
              onClick={() => updateIdentifiersMutation.mutate()}
              disabled={updateIdentifiersMutation.isPending}
            >
              <Check className="h-4 w-4 mr-2" />
              {updateIdentifiersMutation.isPending ? "Guardando..." : "Guardar y sincronizar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
