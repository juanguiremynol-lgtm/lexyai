/**
 * WorkItemSourcesTab — Shows attached provider sources, link-only references,
 * sync status, and actions (Sync now, Disable, View traces).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Server,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Plus,
  ChevronDown,
  Pause,
  AlertTriangle,
  Link as LinkIcon,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { AddSourceDialog } from "./AddSourceDialog";

interface WorkItemSourcesTabProps {
  workItemId: string;
  organizationId?: string;
}

const STATUS_BADGES: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
  OK: {
    label: "Sincronizado",
    variant: "default",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  SCRAPING_PENDING: {
    label: "Sincronizando",
    variant: "outline",
    icon: <Clock className="h-3 w-3 animate-pulse" />,
  },
  EMPTY: {
    label: "Sin eventos",
    variant: "secondary",
    icon: <AlertTriangle className="h-3 w-3" />,
  },
  ERROR: {
    label: "Error",
    variant: "destructive",
    icon: <XCircle className="h-3 w-3" />,
  },
};

export function WorkItemSourcesTab({ workItemId, organizationId }: WorkItemSourcesTabProps) {
  const queryClient = useQueryClient();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [expandedTraces, setExpandedTraces] = useState<string | null>(null);

  // Load sources
  const { data: sources = [], isLoading: sourcesLoading } = useQuery({
    queryKey: ["work-item-sources", workItemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_item_sources")
        .select("*, provider_instances(name, base_url, auth_type, provider_connectors(name))")
        .eq("work_item_id", workItemId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Load external links
  const { data: links = [] } = useQuery({
    queryKey: ["work-item-external-links", workItemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_item_external_links")
        .select("*")
        .eq("work_item_id", workItemId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Load traces for expanded source
  const { data: traces = [] } = useQuery({
    queryKey: ["provider-sync-traces", expandedTraces],
    queryFn: async () => {
      if (!expandedTraces) return [];
      const { data, error } = await supabase
        .from("provider_sync_traces")
        .select("*")
        .eq("work_item_source_id", expandedTraces)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    enabled: !!expandedTraces,
  });

  // Sync now
  const syncMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      setSyncingId(sourceId);
      const { data, error } = await supabase.functions.invoke("provider-sync-external-provider", {
        body: { work_item_source_id: sourceId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["work-item-sources", workItemId] });
      if (data?.scraping_pending) {
        toast.info("Sincronización en progreso, reintento programado");
      } else if (data?.empty) {
        toast.info("El proveedor no retornó eventos");
      } else {
        toast.success(
          `Sincronizado: ${data?.inserted_actuaciones || 0} actuaciones, ${data?.inserted_publicaciones || 0} publicaciones`
        );
      }
    },
    onError: (err) => toast.error("Error de sincronización: " + err.message),
    onSettled: () => setSyncingId(null),
  });

  // Disable source
  const disableMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      const { error } = await supabase
        .from("work_item_sources")
        .update({ status: "DISABLED" })
        .eq("id", sourceId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-item-sources", workItemId] });
      toast.success("Fuente deshabilitada");
    },
    onError: (err) => toast.error("Error: " + err.message),
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Server className="h-5 w-5" />
          Fuentes de Datos
        </h3>
        <Button size="sm" onClick={() => setShowAddDialog(true)}>
          <Plus className="h-3 w-3 mr-1" />
          Agregar Fuente
        </Button>
      </div>

      {/* Provider Sources */}
      {sourcesLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : sources.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-muted-foreground">
            <Server className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Sin fuentes conectadas</p>
            <p className="text-xs mt-1">Conecta un proveedor para sincronizar datos automáticamente</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sources.map((src: any) => {
            const instance = src.provider_instances;
            const connector = instance?.provider_connectors;
            const statusInfo = STATUS_BADGES[src.scrape_status] || STATUS_BADGES.ERROR;
            const isDisabled = src.status === "DISABLED";

            return (
              <Card key={src.id} className={isDisabled ? "opacity-60" : ""}>
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">
                        {instance?.name || "Proveedor"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ({connector?.name || "conector"})
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusInfo.variant} className="text-xs gap-1">
                        {statusInfo.icon}
                        {statusInfo.label}
                      </Badge>
                      {isDisabled && (
                        <Badge variant="secondary" className="text-xs gap-1">
                          <Pause className="h-3 w-3" />
                          Deshabilitada
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      <span className="font-medium">Tipo:</span> {src.source_input_type}
                    </div>
                    <div>
                      <span className="font-medium">Valor:</span> {src.source_input_value}
                    </div>
                    {src.provider_case_id && (
                      <div>
                        <span className="font-medium">Case ID:</span> {src.provider_case_id}
                      </div>
                    )}
                    {src.last_synced_at && (
                      <div>
                        <span className="font-medium">Última sync:</span>{" "}
                        {formatDistanceToNow(new Date(src.last_synced_at), { addSuffix: true, locale: es })}
                      </div>
                    )}
                    {src.last_provider_latency_ms && (
                      <div>
                        <span className="font-medium">Latencia:</span> {src.last_provider_latency_ms}ms
                      </div>
                    )}
                    {src.last_error_code && (
                      <div className="col-span-2 text-destructive">
                        <span className="font-medium">Error:</span> {src.last_error_code}
                        {src.last_error_message && ` — ${src.last_error_message}`}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => syncMutation.mutate(src.id)}
                      disabled={syncingId === src.id || isDisabled}
                    >
                      {syncingId === src.id ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3 mr-1" />
                      )}
                      Sincronizar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedTraces(expandedTraces === src.id ? null : src.id)}
                    >
                      <Activity className="h-3 w-3 mr-1" />
                      Trazas
                      <ChevronDown className={`h-3 w-3 ml-1 transition-transform ${expandedTraces === src.id ? "rotate-180" : ""}`} />
                    </Button>
                    {!isDisabled && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => disableMutation.mutate(src.id)}
                      >
                        <Pause className="h-3 w-3 mr-1" />
                        Deshabilitar
                      </Button>
                    )}
                  </div>

                  {/* Traces */}
                  {expandedTraces === src.id && traces.length > 0 && (
                    <div className="border-t pt-3 mt-2">
                      <ScrollArea className="h-48">
                        <div className="space-y-2">
                          {traces.map((trace: any) => (
                            <div key={trace.id} className="flex items-center gap-2 text-xs border-b pb-2">
                              <Badge variant={trace.ok ? "default" : "destructive"} className="text-[10px] px-1">
                                {trace.result_code || "?"}
                              </Badge>
                              <span className="text-muted-foreground">{trace.stage}</span>
                              {trace.latency_ms && (
                                <span className="text-muted-foreground">{trace.latency_ms}ms</span>
                              )}
                              <span className="text-muted-foreground ml-auto">
                                {formatDistanceToNow(new Date(trace.created_at), { addSuffix: true, locale: es })}
                              </span>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* External Links */}
      {links.length > 0 && (
        <>
          <Separator />
          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <LinkIcon className="h-4 w-4" />
              Enlaces Externos ({links.length})
            </h4>
            <div className="space-y-2">
              {links.map((link: any) => (
                <div key={link.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-2">
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{link.label || link.url}</p>
                      <p className="text-xs text-muted-foreground">{link.kind}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <a href={link.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <AddSourceDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        workItemId={workItemId}
      />
    </div>
  );
}
