/**
 * SyncDebugDrawer - Shows detailed sync trace timeline
 * 
 * Opens from WorkItemDetail to display step-by-step sync trace events
 * for debugging "Not found" and other sync errors.
 */

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Bug,
  Copy,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Loader2,
  Database,
  Wifi,
  FileSearch,
  Shield,
  Server,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface SyncTrace {
  id: string;
  trace_id: string;
  work_item_id: string | null;
  organization_id: string | null;
  workflow_type: string | null;
  step: string;
  provider: string | null;
  http_status: number | null;
  latency_ms: number | null;
  success: boolean;
  error_code: string | null;
  message: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

interface SyncDebugDrawerProps {
  workItemId: string;
  lastTraceId?: string | null;
  onTraceIdChange?: (traceId: string | null) => void;
}

// Step icons and colors
const STEP_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  SYNC_START: { icon: Server, color: "text-blue-500", label: "Inicio de sincronización" },
  AUTHZ_OK: { icon: Shield, color: "text-green-500", label: "Autorización verificada" },
  AUTHZ_FAILED: { icon: Shield, color: "text-red-500", label: "Autorización fallida" },
  WORK_ITEM_LOADED: { icon: FileSearch, color: "text-blue-500", label: "Work Item cargado" },
  WORK_ITEM_NOT_FOUND: { icon: FileSearch, color: "text-red-500", label: "Work Item no encontrado" },
  PROVIDER_SELECTED: { icon: Wifi, color: "text-blue-500", label: "Proveedor seleccionado" },
  PROVIDER_REQUEST_START: { icon: Wifi, color: "text-yellow-500", label: "Iniciando petición" },
  PROVIDER_RESPONSE_RECEIVED: { icon: Wifi, color: "text-blue-500", label: "Respuesta recibida" },
  PROVIDER_404: { icon: Wifi, color: "text-orange-500", label: "Proveedor: No encontrado (404)" },
  PROVIDER_ERROR: { icon: Wifi, color: "text-red-500", label: "Error de proveedor" },
  PARSE_START: { icon: Database, color: "text-blue-500", label: "Parseando respuesta" },
  PARSE_RESULT: { icon: Database, color: "text-blue-500", label: "Resultado parseado" },
  PARSE_EMPTY: { icon: Database, color: "text-orange-500", label: "Sin datos para parsear" },
  DB_WRITE_START: { icon: Database, color: "text-blue-500", label: "Escribiendo en DB" },
  DB_WRITE_RESULT: { icon: Database, color: "text-green-500", label: "Escritura completada" },
  DB_WRITE_FAILED: { icon: Database, color: "text-red-500", label: "Error de escritura" },
  SYNC_SUCCESS: { icon: CheckCircle2, color: "text-green-500", label: "Sincronización exitosa" },
  SYNC_FAILED: { icon: XCircle, color: "text-red-500", label: "Sincronización fallida" },
  EXTERNAL_PROVIDER_SYNC: { icon: Wifi, color: "text-cyan-500", label: "Sync proveedor externo (Estados)" },
};

function getStepConfig(step: string) {
  return STEP_CONFIG[step] || { icon: ChevronRight, color: "text-muted-foreground", label: step };
}

export function SyncDebugDrawer({ workItemId, lastTraceId, onTraceIdChange }: SyncDebugDrawerProps) {
  const [open, setOpen] = useState(false);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(lastTraceId || null);

  // Fetch recent traces for this work item
  const { data: traces, isLoading, refetch } = useQuery({
    queryKey: ["sync-traces", workItemId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("sync_traces") as any)
        .select("*")
        .eq("work_item_id", workItemId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return (data || []) as SyncTrace[];
    },
    enabled: open,
  });

  // Group traces by trace_id
  const traceGroups = traces?.reduce((acc, trace) => {
    if (!acc[trace.trace_id]) {
      acc[trace.trace_id] = [];
    }
    acc[trace.trace_id].push(trace);
    return acc;
  }, {} as Record<string, SyncTrace[]>) || {};

  // Get unique trace IDs ordered by most recent
  const traceIds = Object.keys(traceGroups).sort((a, b) => {
    const aTime = traceGroups[a][0]?.created_at || "";
    const bTime = traceGroups[b][0]?.created_at || "";
    return bTime.localeCompare(aTime);
  });

  // Select first trace if none selected
  useEffect(() => {
    if (!selectedTraceId && traceIds.length > 0) {
      setSelectedTraceId(traceIds[0]);
    }
  }, [traceIds, selectedTraceId]);

  // Update parent when lastTraceId changes
  useEffect(() => {
    if (lastTraceId && lastTraceId !== selectedTraceId) {
      setSelectedTraceId(lastTraceId);
      refetch();
    }
  }, [lastTraceId]);

  const selectedTraces = selectedTraceId ? (traceGroups[selectedTraceId] || []).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  ) : [];

  const copyTraceJson = () => {
    if (!selectedTraces.length) return;
    
    // Sanitize before copying
    const sanitized = selectedTraces.map(t => ({
      ...t,
      meta: t.meta ? { ...t.meta } : {},
    }));
    
    navigator.clipboard.writeText(JSON.stringify(sanitized, null, 2));
    toast.success("Trace JSON copiado al portapapeles");
  };

  const copyTraceId = () => {
    if (!selectedTraceId) return;
    navigator.clipboard.writeText(selectedTraceId);
    toast.success("Trace ID copiado");
  };

  const getTraceStatus = (traces: SyncTrace[]) => {
    const lastStep = traces[traces.length - 1];
    if (!lastStep) return "unknown";
    if (lastStep.step === "SYNC_SUCCESS") return "success";
    if (lastStep.step === "SYNC_FAILED" || lastStep.error_code) return "failed";
    return "partial";
  };

  const getFirstTimestamp = (traces: SyncTrace[]) => {
    return traces[0]?.created_at;
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <Bug className="h-4 w-4" />
          Ver Debug
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[500px] sm:w-[600px] sm:max-w-none">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5" />
            Sync Debug Console
          </SheetTitle>
          <SheetDescription>
            Rastrea paso a paso el proceso de sincronización
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Trace selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Trace:</span>
            <select
              value={selectedTraceId || ""}
              onChange={(e) => setSelectedTraceId(e.target.value)}
              className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {traceIds.map((traceId) => {
                const status = getTraceStatus(traceGroups[traceId]);
                const timestamp = getFirstTimestamp(traceGroups[traceId]);
                return (
                  <option key={traceId} value={traceId}>
                    {status === "success" ? "✅" : status === "failed" ? "❌" : "⚠️"} {traceId.slice(0, 8)}... - {
                      timestamp ? formatDistanceToNow(new Date(timestamp), { addSuffix: true, locale: es }) : "—"
                    }
                  </option>
                );
              })}
            </select>
            <Button variant="outline" size="sm" onClick={copyTraceId} disabled={!selectedTraceId}>
              <Copy className="h-3 w-3" />
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : traceIds.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
              <p>No hay traces de sincronización para este asunto.</p>
              <p className="text-sm">Ejecuta "Actualizar ahora" para generar un trace.</p>
            </div>
          ) : (
            <>
              {/* Timeline */}
              <ScrollArea className="h-[calc(100vh-320px)]">
                <div className="space-y-1 pr-4">
                  {selectedTraces.map((trace, idx) => {
                    const config = getStepConfig(trace.step);
                    const Icon = config.icon;
                    const isLast = idx === selectedTraces.length - 1;

                    return (
                      <div key={trace.id} className="relative">
                        {/* Timeline connector */}
                        {!isLast && (
                          <div className="absolute left-[15px] top-[32px] w-0.5 h-full bg-border" />
                        )}

                        <div className={cn(
                          "flex gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors",
                          trace.error_code && "bg-destructive/5"
                        )}>
                          {/* Icon */}
                          <div className={cn(
                            "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
                            trace.success ? "bg-green-500/10" : trace.error_code ? "bg-red-500/10" : "bg-muted"
                          )}>
                            <Icon className={cn("h-4 w-4", config.color)} />
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{config.label}</span>
                              {trace.provider && (
                                <Badge variant="outline" className="text-xs">
                                  {trace.provider.toUpperCase()}
                                </Badge>
                              )}
                              {trace.http_status && (
                                <Badge 
                                  variant={trace.http_status >= 200 && trace.http_status < 300 ? "secondary" : "destructive"}
                                  className="text-xs"
                                >
                                  HTTP {trace.http_status}
                                </Badge>
                              )}
                              {trace.latency_ms && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {trace.latency_ms}ms
                                </span>
                              )}
                            </div>

                            {trace.message && (
                              <p className="text-sm text-muted-foreground mt-1 break-words">
                                {trace.message.slice(0, 300)}{trace.message.length > 300 ? "..." : ""}
                              </p>
                            )}

                            {trace.error_code && (
                              <Badge variant="destructive" className="mt-1 text-xs">
                                {trace.error_code}
                              </Badge>
                            )}

                            {/* Meta info */}
                            {trace.meta && Object.keys(trace.meta).length > 0 && (
                              <div className="mt-2 text-xs font-mono bg-muted/50 rounded p-2 space-y-1">
                                {Object.entries(trace.meta).slice(0, 5).map(([key, value]) => (
                                  <div key={key} className="flex gap-2">
                                    <span className="text-muted-foreground">{key}:</span>
                                    <span className="truncate">
                                      {typeof value === "object" ? JSON.stringify(value) : String(value)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}

                            <span className="text-xs text-muted-foreground mt-1 block">
                              {format(new Date(trace.created_at), "HH:mm:ss.SSS", { locale: es })}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>

              <Separator />

              {/* Actions */}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={copyTraceJson} className="gap-2">
                  <Copy className="h-4 w-4" />
                  Copiar JSON
                </Button>
                <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                  <Loader2 className="h-4 w-4" />
                  Actualizar
                </Button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
