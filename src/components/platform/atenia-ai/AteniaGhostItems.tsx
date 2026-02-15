/**
 * AteniaGhostItems — Ghost Items table for Supervisor Panel
 *
 * Shows work_items with monitoring enabled but repeated failures,
 * with recommended actions per item based on error classification.
 * 
 * V2: Integrates ghost verification flow with control-run evidence.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Ghost, RefreshCw, Loader2, PauseCircle, Search, Plug, FlaskConical, CheckCircle2, AlertTriangle, ShieldAlert } from "lucide-react";
import { NormalizedErrorCode, getErrorLabel, getRecommendedAction } from "@/lib/sync/errorCodes";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { GhostVerificationBadge } from "./GhostVerificationBadge";

interface GhostItem {
  work_item_id: string;
  organization_id: string;
  consecutive_not_found: number;
  consecutive_timeouts: number;
  consecutive_other_errors: number;
  last_error_code: string | null;
  last_provider: string | null;
  last_success_at: string | null;
  last_observed_at: string;
  radicado?: string;
  workflow_type?: string;
  ghost_verification_status?: string | null;
  ghost_verification_run_id?: string | null;
}

function classifyAction(item: GhostItem): {
  label: string;
  variant: "destructive" | "secondary" | "outline" | "default";
  icon: React.ReactNode;
} {
  // If already verified as SYSTEM_ISSUE, different action
  if (item.ghost_verification_status === "SYSTEM_ISSUE") {
    return { label: "Problema Sistema", variant: "destructive", icon: <ShieldAlert className="h-3 w-3" /> };
  }
  if (item.ghost_verification_status === "ITEM_SPECIFIC") {
    return { label: "Revisar Radicado", variant: "secondary", icon: <Search className="h-3 w-3" /> };
  }

  if (item.consecutive_not_found >= 5) {
    return { label: "Verificar", variant: "default", icon: <FlaskConical className="h-3 w-3" /> };
  }
  const code = item.last_error_code?.toUpperCase() ?? '';
  if (code.includes('MISSING_PLATFORM_INSTANCE')) {
    return { label: "Config. Instancia", variant: "secondary", icon: <Plug className="h-3 w-3" /> };
  }
  if (code.includes('MAPPING') || code.includes('SNAPSHOT_PARSE')) {
    return { label: "Revisar Mapping", variant: "secondary", icon: <Search className="h-3 w-3" /> };
  }
  if (item.consecutive_timeouts >= 3 || item.consecutive_other_errors >= 3) {
    return { label: "Reintentar", variant: "default", icon: <RefreshCw className="h-3 w-3" /> };
  }
  return { label: "Investigar", variant: "outline", icon: <Search className="h-3 w-3" /> };
}

function errorSeverityBadge(item: GhostItem) {
  const total = item.consecutive_not_found + item.consecutive_timeouts + item.consecutive_other_errors;
  if (total >= 5) return "destructive" as const;
  if (total >= 3) return "secondary" as const;
  return "outline" as const;
}

export function AteniaGhostItems() {
  const queryClient = useQueryClient();

  const { data: ghostItems, isLoading, refetch } = useQuery({
    queryKey: ["atenia-ghost-items"],
    queryFn: async () => {
      const { data: states, error } = await (supabase
        .from("atenia_ai_work_item_state") as any)
        .select(`
          work_item_id,
          organization_id,
          consecutive_not_found,
          consecutive_timeouts,
          consecutive_other_errors,
          last_error_code,
          last_provider,
          last_success_at,
          last_observed_at
        `)
        .or("consecutive_not_found.gte.2,consecutive_timeouts.gte.2,consecutive_other_errors.gte.2")
        .order("last_observed_at", { ascending: false })
        .limit(50);

      if (error) {
        console.warn("[AteniaGhostItems] Error:", error.message);
        return [];
      }
      if (!states || states.length === 0) return [];

      const workItemIds = states.map((s: any) => s.work_item_id);
      const { data: workItems } = await supabase
        .from("work_items")
        .select("id, radicado, workflow_type, monitoring_enabled, ghost_verification_status, ghost_verification_run_id")
        .in("id", workItemIds);

      const wiMap = new Map((workItems || []).map((wi: any) => [wi.id, wi]));

      return states
        .map((s: any) => {
          const wi = wiMap.get(s.work_item_id);
          if (!wi || !wi.monitoring_enabled) return null;
          return {
            ...s,
            radicado: wi.radicado,
            workflow_type: wi.workflow_type,
            ghost_verification_status: wi.ghost_verification_status,
            ghost_verification_run_id: wi.ghost_verification_run_id,
          } as GhostItem;
        })
        .filter(Boolean) as GhostItem[];
    },
    staleTime: 60_000,
  });

  const verifyMutation = useMutation({
    mutationFn: async (item: GhostItem) => {
      const { data, error } = await supabase.functions.invoke("atenia-ghost-verify", {
        body: {
          work_item_id: item.work_item_id,
          organization_id: item.organization_id,
          trigger: "MANUAL",
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["atenia-ghost-items"] });
      const cls = data.classification;
      if (cls === "SYSTEM_ISSUE") {
        toast.error("⚠️ Problema de sistema detectado. El control run también falló. Incidente creado.");
      } else if (cls === "ITEM_SPECIFIC") {
        toast.info("Verificación completa: el problema es específico de este radicado. Rutas de sync funcionan correctamente.");
      } else if (cls === "RESOLVED") {
        toast.success("El item se recuperó durante la verificación. Ya no es fantasma.");
      } else {
        toast.warning(`Resultado inconcluso: ${data.decision_reason}`);
      }
    },
    onError: () => toast.error("Error al ejecutar verificación ghost"),
  });

  const handleRetry = async (item: GhostItem) => {
    try {
      const { error } = await supabase.functions.invoke("sync-by-work-item", {
        body: { work_item_id: item.work_item_id, _scheduled: true },
      });
      if (error) throw error;
      toast.success(`Reintento iniciado para ${item.radicado || item.work_item_id.slice(0, 8)}`);
    } catch {
      toast.error("Error al reintentar sincronización");
    }
  };

  const handleAction = (item: GhostItem) => {
    const action = classifyAction(item);
    if (action.label === "Verificar") {
      verifyMutation.mutate(item);
    } else if (action.label === "Reintentar") {
      handleRetry(item);
    } else {
      toast.info(`Acción "${action.label}" requiere intervención manual. Radicado: ${item.radicado || item.work_item_id.slice(0, 8)}`);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Ghost className="h-4 w-4 text-destructive" />
            Asuntos Fantasma (Ghost Items)
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {ghostItems?.length || 0} items
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-7 w-7 p-0">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Items con fallos repetidos. Use "Verificar" para ejecutar un control-run comparativo antes de clasificar.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !ghostItems || ghostItems.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            ✅ No hay asuntos fantasma con monitoreo activo.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 px-2 font-medium">Radicado</th>
                  <th className="text-left py-2 px-2 font-medium">Tipo</th>
                  <th className="text-center py-2 px-2 font-medium">Fallos</th>
                  <th className="text-left py-2 px-2 font-medium">Último Error</th>
                  <th className="text-left py-2 px-2 font-medium">Verificación</th>
                  <th className="text-left py-2 px-2 font-medium">Último Éxito</th>
                  <th className="text-left py-2 px-2 font-medium">Acción</th>
                </tr>
              </thead>
              <tbody>
                {ghostItems.map((item) => {
                  const action = classifyAction(item);
                  const totalFailures = item.consecutive_not_found + item.consecutive_timeouts + item.consecutive_other_errors;
                  const errorCode = item.last_error_code
                    ? getErrorLabel(item.last_error_code as NormalizedErrorCode)
                    : "—";

                  return (
                    <tr key={item.work_item_id} className="border-b hover:bg-muted/50">
                      <td className="py-2 px-2 font-mono text-xs">
                        {item.radicado || item.work_item_id.slice(0, 12)}
                      </td>
                      <td className="py-2 px-2 text-xs text-muted-foreground">
                        {item.workflow_type || "—"}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <Badge variant={errorSeverityBadge(item)} className="text-xs">
                          {totalFailures}
                          {item.consecutive_not_found > 0 && ` (${item.consecutive_not_found} NF)`}
                          {item.consecutive_timeouts > 0 && ` (${item.consecutive_timeouts} TO)`}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-xs">
                        <span title={getRecommendedAction(item.last_error_code as NormalizedErrorCode)}>
                          {errorCode}
                        </span>
                      </td>
                      <td className="py-2 px-2">
                        <GhostVerificationBadge status={item.ghost_verification_status} />
                      </td>
                      <td className="py-2 px-2 text-xs text-muted-foreground">
                        {item.last_success_at
                          ? formatDistanceToNow(new Date(item.last_success_at), { addSuffix: true, locale: es })
                          : "Nunca"}
                      </td>
                      <td className="py-2 px-2">
                        <Button
                          variant={action.variant}
                          size="sm"
                          className="h-6 text-xs gap-1"
                          onClick={() => handleAction(item)}
                          disabled={verifyMutation.isPending}
                          title={`${action.label}: ${getRecommendedAction(item.last_error_code as NormalizedErrorCode)}`}
                        >
                          {verifyMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            action.icon
                          )}
                          {action.label}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
