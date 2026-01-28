/**
 * SyncWorkItemButton - Triggers sync of work item with external APIs
 * 
 * Features:
 * - Auto-retry when scraping is initiated (waits 60s then retries)
 * - Polling mechanism if first retry still shows scraping in progress
 * - Visual feedback with progress bar during wait
 * - Automatic UI refresh on success
 */

import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, AlertTriangle, Check, X, Clock, Loader2 } from "lucide-react";
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
import { generateTraceId, formatSyncError, getProviderDisplayName } from "@/lib/sync-trace";

interface SyncWorkItemButtonProps {
  workItem: WorkItem;
  onTraceIdGenerated?: (traceId: string) => void;
}

interface SyncResult {
  ok: boolean;
  work_item_id: string;
  workflow_type?: string;
  inserted_count: number;
  skipped_count: number;
  latest_event_date: string | null;
  source_used: string | null;
  provider_used?: string | null;
  warnings: string[];
  errors: string[];
  adapter_used?: string;
  code?: string;
  message?: string;
  trace_id?: string;
  provider_attempts?: Array<{
    provider: string;
    status: string;
    latencyMs: number;
    message?: string;
  }>;
  // Auto-scraping fields
  scraping_initiated?: boolean;
  scraping_job_id?: string;
  scraping_poll_url?: string;
  scraping_provider?: string;
  scraping_message?: string;
}

type SyncStatus = 'idle' | 'syncing' | 'waiting' | 'polling' | 'success' | 'error';

interface SyncState {
  status: SyncStatus;
  message?: string;
  progress?: number;
  jobId?: string;
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
  const [syncState, setSyncState] = useState<SyncState>({ status: 'idle' });
  
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const isTutela = workItem.workflow_type === "TUTELA";
  
  // Check if identifiers are present
  const hasValidIdentifier = isTutela
    ? (workItem.tutela_code && isValidTutelaCode(workItem.tutela_code)) || 
      (workItem.radicado && isValidRadicado(workItem.radicado))
    : workItem.radicado && isValidRadicado(workItem.radicado);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, []);

  // Invalidate all related queries
  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
    queryClient.invalidateQueries({ queryKey: ["work-item-actuaciones", workItem.id] });
    queryClient.invalidateQueries({ queryKey: ["work-item-acts", workItem.id] });
    queryClient.invalidateQueries({ queryKey: ["work-item-alerts", workItem.id] });
    queryClient.invalidateQueries({ queryKey: ["work-item-process-events", workItem.id] });
    queryClient.invalidateQueries({ queryKey: ["work-item-publicaciones", workItem.id] });
  };

  // Execute sync call
  const executeSyncCall = async (): Promise<SyncResult> => {
    const traceId = generateTraceId();
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
  };

  // Handle successful sync
  const handleSyncSuccess = (result: SyncResult) => {
    console.log('[Sync] Success:', result);
    
    setSyncState({
      status: 'success',
      message: 'Actualización completada'
    });

    invalidateQueries();

    const newCount = result.inserted_count || 0;
    const providerName = getProviderDisplayName(result.provider_used || result.source_used);
    
    if (newCount > 0) {
      toast.success(
        `Sincronización exitosa: ${newCount} nuevas actuaciones`,
        { description: `Fuente: ${providerName}` }
      );
    } else if (result.skipped_count > 0) {
      toast.info("Sin novedades", {
        description: `${result.skipped_count} actuaciones ya existentes`,
      });
    } else {
      toast.success("Sincronización completada");
    }

    // Reset to idle after 2 seconds
    setTimeout(() => {
      setSyncState({ status: 'idle' });
    }, 2000);
  };

  // Handle scraping initiated - start countdown and auto-retry
  const handleScrapingInitiated = (result: SyncResult) => {
    const provider = result.scraping_provider || result.provider_used || 'proveedor';
    const jobId = result.scraping_job_id;
    
    console.log(`[Sync] Scraping initiated on ${provider}, job: ${jobId}`);
    
    // Show waiting state
    setSyncState({
      status: 'waiting',
      message: `Buscando proceso en ${provider.toUpperCase()}...`,
      jobId: jobId,
      progress: 0
    });

    toast.info('Buscando proceso', {
      description: 'El sistema está consultando la base de datos judicial. Esto puede tomar hasta 60 segundos.',
      duration: 5000
    });

    // Start 60 second countdown
    let secondsLeft = 60;
    countdownTimerRef.current = setInterval(() => {
      secondsLeft--;
      const progress = ((60 - secondsLeft) / 60) * 100;
      
      setSyncState(prev => ({
        ...prev,
        progress: progress,
        message: `Esperando respuesta (${secondsLeft}s restantes)...`
      }));

      if (secondsLeft <= 0) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
      }
    }, 1000);

    // After 60 seconds, auto-retry
    retryTimerRef.current = setTimeout(async () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      
      console.log('[Sync] Wait complete, retrying...');
      setSyncState({
        status: 'polling',
        message: 'Verificando si los datos están listos...',
        progress: 100
      });

      await retrySync();
    }, 60000);
  };

  // Retry sync after scraping wait
  const retrySync = async () => {
    try {
      const result = await executeSyncCall();

      // If still scraping, start polling
      if (result.scraping_initiated || result.code === 'SCRAPING_INITIATED') {
        console.log('[Sync] Still scraping, starting polling...');
        startPolling();
        return;
      }

      // If we got data, success!
      if (result.ok) {
        handleSyncSuccess(result);
        return;
      }

      throw new Error(result.message || 'No data available yet');

    } catch (error: any) {
      console.error('[Sync] Retry error:', error);
      // If retry fails, start polling
      console.log('[Sync] Retry failed, starting polling...');
      startPolling();
    }
  };

  // Start polling every 10 seconds (max 5 attempts)
  const startPolling = () => {
    let pollAttempts = 0;
    const maxAttempts = 5;

    setSyncState({
      status: 'polling',
      message: 'Verificando disponibilidad de datos...',
      progress: 100
    });

    pollingTimerRef.current = setInterval(async () => {
      pollAttempts++;
      
      console.log(`[Sync] Polling attempt ${pollAttempts}/${maxAttempts}`);
      
      setSyncState(prev => ({
        ...prev,
        message: `Verificando... (intento ${pollAttempts}/${maxAttempts})`
      }));

      try {
        const result = await executeSyncCall();

        // If we got data, stop polling
        if (result.ok && !result.scraping_initiated) {
          if (pollingTimerRef.current) {
            clearInterval(pollingTimerRef.current);
            pollingTimerRef.current = null;
          }
          handleSyncSuccess(result);
          return;
        }

        // If max attempts reached
        if (pollAttempts >= maxAttempts) {
          if (pollingTimerRef.current) {
            clearInterval(pollingTimerRef.current);
            pollingTimerRef.current = null;
          }
          
          setSyncState({
            status: 'error',
            message: 'Los datos aún no están disponibles'
          });

          toast.warning('Scraping en progreso', {
            description: 'El proceso está siendo indexado. Por favor, intenta nuevamente en unos minutos.',
            duration: 8000
          });
        }

      } catch (error: any) {
        console.error('[Sync] Polling error:', error);
        
        if (pollAttempts >= maxAttempts) {
          if (pollingTimerRef.current) {
            clearInterval(pollingTimerRef.current);
            pollingTimerRef.current = null;
          }
          
          setSyncState({
            status: 'error',
            message: error.message
          });
        }
      }
    }, 10000); // Every 10 seconds
  };

  // Handle sync error
  const handleSyncError = (result: SyncResult) => {
    const providerName = getProviderDisplayName(result.provider_used || result.source_used);
    const errorMsg = formatSyncError(
      result.code || null,
      result.errors?.[0] || result.message || null
    );
    
    setSyncState({
      status: 'error',
      message: errorMsg
    });

    toast.error("Error de sincronización", {
      description: `${providerName}: ${errorMsg}`,
      duration: 6000,
    });
  };

  // Main sync handler
  const handleSync = async () => {
    if (!hasValidIdentifier) {
      setShowEditDialog(true);
      return;
    }

    // Clear any existing timers
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

    try {
      setSyncState({ status: 'syncing', message: 'Consultando APIs externas...' });

      const result = await executeSyncCall();

      // Case 1: Scraping initiated - wait and auto-retry
      if (result.scraping_initiated || result.code === 'SCRAPING_INITIATED') {
        handleScrapingInitiated(result);
        return;
      }

      // Case 2: Success
      if (result.ok) {
        handleSyncSuccess(result);
        return;
      }

      // Case 3: Error
      handleSyncError(result);

    } catch (error: any) {
      console.error('[Sync] Error:', error);
      setSyncState({ 
        status: 'error', 
        message: error.message 
      });
      toast.error('Error en sincronización', {
        description: error.message
      });
    }
  };

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

  // Render button based on state
  const renderButton = () => {
    const { status, message, progress } = syncState;

    // Syncing state
    if (status === 'syncing') {
      return (
        <Button variant="outline" size="sm" disabled className="gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Consultando...
        </Button>
      );
    }

    // Waiting for scraping
    if (status === 'waiting') {
      return (
        <div className="flex flex-col gap-2">
          <Button variant="outline" size="sm" disabled className="gap-2">
            <Clock className="h-4 w-4 animate-pulse" />
            <span className="text-xs">{message}</span>
          </Button>
          {progress !== undefined && (
            <Progress value={progress} className="h-1 w-full" />
          )}
        </div>
      );
    }

    // Polling state
    if (status === 'polling') {
      return (
        <Button variant="outline" size="sm" disabled className="gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">{message || 'Verificando...'}</span>
        </Button>
      );
    }

    // Success state
    if (status === 'success') {
      return (
        <Button variant="outline" size="sm" disabled className="gap-2 text-primary">
          <Check className="h-4 w-4" />
          Actualizado
        </Button>
      );
    }

    // Error state - allow retry
    if (status === 'error') {
      return (
        <Button variant="outline" size="sm" onClick={handleSync} className="gap-2 text-destructive">
          <RefreshCw className="h-4 w-4" />
          Reintentar
        </Button>
      );
    }

    // Idle state (default)
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleSync}
        className="gap-2"
      >
        <RefreshCw className="h-4 w-4" />
        Actualizar ahora
      </Button>
    );
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        {renderButton()}
      </div>

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
