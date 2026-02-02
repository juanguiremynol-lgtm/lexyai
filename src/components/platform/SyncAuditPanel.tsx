/**
 * SyncAuditPanel - Displays recent sync audit logs with anomaly detection
 * 
 * Shows:
 * - Recent sync operations with before/after counts
 * - Anomaly alerts when count decreased
 * - Provider info and latency
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Database,
  Clock,
  TrendingUp,
  TrendingDown,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface SyncAuditLog {
  id: string;
  work_item_id: string;
  organization_id: string | null;
  radicado: string | null;
  workflow_type: string | null;
  sync_type: string;
  acts_count_before: number;
  acts_count_after: number;
  publicaciones_count_before: number;
  publicaciones_count_after: number;
  acts_inserted: number;
  acts_skipped: number;
  publicaciones_inserted: number;
  publicaciones_skipped: number;
  provider_used: string | null;
  provider_latency_ms: number | null;
  status: string;
  error_message: string | null;
  count_decreased: boolean;
  anomaly_details: string | null;
  triggered_by: string | null;
  edge_function: string | null;
  created_at: string;
}

export function SyncAuditPanel() {
  const { data: auditLogs, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["sync-audit-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return data as SyncAuditLog[];
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const anomalyCount = auditLogs?.filter(log => log.count_decreased).length || 0;

  const getStatusIcon = (status: string, countDecreased: boolean) => {
    if (countDecreased) return <AlertTriangle className="h-4 w-4 text-destructive" />;
    switch (status) {
      case "success":
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "partial":
        return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case "error":
        return <XCircle className="h-4 w-4 text-destructive" />;
      case "anomaly":
        return <AlertTriangle className="h-4 w-4 text-destructive" />;
      default:
        return <Activity className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string, countDecreased: boolean) => {
    if (countDecreased) {
      return <Badge variant="destructive">ANOMALY</Badge>;
    }
    switch (status) {
      case "success":
        return <Badge variant="outline" className="text-emerald-600 border-emerald-300">Success</Badge>;
      case "partial":
        return <Badge variant="outline" className="text-amber-600 border-amber-300">Partial</Badge>;
      case "error":
        return <Badge variant="destructive">Error</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Sync Audit Log
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Sync Audit Log
              {anomalyCount > 0 && (
                <Badge variant="destructive" className="ml-2">
                  ⚠️ {anomalyCount} anomal{anomalyCount === 1 ? "ía" : "ías"}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Registro de operaciones de sincronización con detección de anomalías
            </CardDescription>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!auditLogs || auditLogs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Database className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No hay registros de sincronización aún.</p>
            <p className="text-sm">Ejecuta un sync para ver el historial.</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3">
              {auditLogs.map((log) => (
                <div
                  key={log.id}
                  className={cn(
                    "p-3 rounded-lg border transition-colors",
                    log.count_decreased && "bg-destructive/5 border-destructive/30",
                    log.status === "success" && !log.count_decreased && "hover:bg-muted/50",
                    log.status === "error" && "bg-destructive/5 border-destructive/30"
                  )}
                >
                  <div className="flex items-start gap-3">
                    {getStatusIcon(log.status, log.count_decreased)}
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {getStatusBadge(log.status, log.count_decreased)}
                        <Badge variant="outline" className="text-xs">
                          {log.sync_type}
                        </Badge>
                        {log.workflow_type && (
                          <Badge variant="secondary" className="text-xs">
                            {log.workflow_type}
                          </Badge>
                        )}
                        {log.provider_used && (
                          <span className="text-xs text-muted-foreground">
                            via {log.provider_used.toUpperCase()}
                          </span>
                        )}
                      </div>
                      
                      {log.radicado && (
                        <p className="text-xs font-mono text-muted-foreground mt-1 truncate">
                          {log.radicado}
                        </p>
                      )}
                      
                      {/* Count changes */}
                      <div className="flex items-center gap-4 mt-2 text-sm">
                        {log.sync_type === "actuaciones" || log.sync_type === "both" ? (
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">Acts:</span>
                            <span className={cn(
                              "font-mono",
                              log.acts_count_after > log.acts_count_before && "text-emerald-600",
                              log.acts_count_after < log.acts_count_before && "text-destructive font-bold"
                            )}>
                              {log.acts_count_before} → {log.acts_count_after}
                            </span>
                            {log.acts_count_after > log.acts_count_before ? (
                              <TrendingUp className="h-3 w-3 text-emerald-500" />
                            ) : log.acts_count_after < log.acts_count_before ? (
                              <TrendingDown className="h-3 w-3 text-destructive" />
                            ) : null}
                            <span className="text-xs text-muted-foreground">
                              (+{log.acts_inserted}, ={log.acts_skipped})
                            </span>
                          </div>
                        ) : null}
                        
                        {log.sync_type === "publicaciones" || log.sync_type === "both" ? (
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">Pubs:</span>
                            <span className={cn(
                              "font-mono",
                              log.publicaciones_count_after > log.publicaciones_count_before && "text-emerald-600",
                              log.publicaciones_count_after < log.publicaciones_count_before && "text-destructive font-bold"
                            )}>
                              {log.publicaciones_count_before} → {log.publicaciones_count_after}
                            </span>
                            {log.publicaciones_count_after > log.publicaciones_count_before ? (
                              <TrendingUp className="h-3 w-3 text-emerald-500" />
                            ) : log.publicaciones_count_after < log.publicaciones_count_before ? (
                              <TrendingDown className="h-3 w-3 text-destructive" />
                            ) : null}
                            <span className="text-xs text-muted-foreground">
                              (+{log.publicaciones_inserted}, ={log.publicaciones_skipped})
                            </span>
                          </div>
                        ) : null}
                      </div>
                      
                      {/* Anomaly details */}
                      {log.count_decreased && log.anomaly_details && (
                        <p className="text-xs text-destructive mt-1 font-medium">
                          ⚠️ {log.anomaly_details}
                        </p>
                      )}
                      
                      {/* Error message */}
                      {log.error_message && (
                        <p className="text-xs text-destructive mt-1 line-clamp-2">
                          {log.error_message}
                        </p>
                      )}
                      
                      {/* Metadata footer */}
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(log.created_at), { addSuffix: true, locale: es })}
                        </span>
                        {log.provider_latency_ms && (
                          <span>{log.provider_latency_ms}ms</span>
                        )}
                        {log.edge_function && (
                          <span className="font-mono">{log.edge_function}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
