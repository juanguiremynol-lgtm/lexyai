/**
 * Platform Audit Logs Tab - Global audit log viewer
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { History, Download, Search, Building2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit-log";

interface AuditLog {
  id: string;
  organization_id: string;
  organization_name?: string;
  actor_user_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const ACTION_COLORS: Record<string, string> = {
  PLATFORM_TRIAL_EXTENDED: "bg-blue-100 text-blue-800",
  PLATFORM_SUBSCRIPTION_ACTIVATED: "bg-green-100 text-green-800",
  PLATFORM_SUBSCRIPTION_SUSPENDED: "bg-amber-100 text-amber-800",
  PLATFORM_SUBSCRIPTION_EXPIRED: "bg-red-100 text-red-800",
  DATA_PURGED: "bg-red-100 text-red-800",
  DATA_EXPORTED: "bg-purple-100 text-purple-800",
  MEMBERSHIP_REMOVED: "bg-amber-100 text-amber-800",
  DB_MEMBERSHIP_DELETED: "bg-red-100 text-red-800",
  DB_SUBSCRIPTION_UPDATED: "bg-blue-100 text-blue-800",
};

export function PlatformAuditLogsTab() {
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["platform-audit-logs", actionFilter, entityFilter],
    queryFn: async () => {
      let query = supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);

      if (actionFilter !== "all") {
        query = query.eq("action", actionFilter);
      }
      if (entityFilter !== "all") {
        query = query.eq("entity_type", entityFilter);
      }

      const { data: logs, error } = await query;
      if (error) throw error;

      // Get organization names
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, name");

      const orgMap = new Map(orgs?.map((o) => [o.id, o.name]) || []);

      return (logs || []).map((log) => ({
        ...log,
        organization_name: orgMap.get(log.organization_id) || "Desconocida",
      })) as AuditLog[];
    },
  });

  // Filter by search
  const filteredLogs = data?.filter((log) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      log.action.toLowerCase().includes(query) ||
      log.entity_type.toLowerCase().includes(query) ||
      log.organization_name?.toLowerCase().includes(query) ||
      JSON.stringify(log.metadata).toLowerCase().includes(query)
    );
  });

  // Get unique actions and entity types for filters
  const uniqueActions = [...new Set(data?.map((l) => l.action) || [])].sort();
  const uniqueEntityTypes = [...new Set(data?.map((l) => l.entity_type) || [])].sort();

  const handleExportCSV = async () => {
    if (!filteredLogs || filteredLogs.length === 0) {
      toast.error("No hay logs para exportar");
      return;
    }

    // Export max 5000 rows
    const exportData = filteredLogs.slice(0, 5000);

    const csvContent = [
      ["Fecha", "Organización", "Acción", "Tipo Entidad", "ID Entidad", "Actor", "Metadata"].join(","),
      ...exportData.map((log) => [
        format(new Date(log.created_at), "yyyy-MM-dd HH:mm:ss"),
        `"${log.organization_name}"`,
        log.action,
        log.entity_type,
        log.entity_id || "",
        log.actor_type,
        `"${JSON.stringify(log.metadata).replace(/"/g, '""')}"`,
      ].join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `platform_audit_logs_${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();

    // Log the export action
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      // Use a generic org ID for platform-level exports
      await logAudit({
        organizationId: "00000000-0000-0000-0000-000000000000", // Platform-level
        action: "DATA_EXPORTED",
        entityType: "audit_log",
        metadata: {
          export_type: "platform_audit_logs",
          row_count: exportData.length,
          filters: { action: actionFilter, entity: entityFilter, search: searchQuery },
        },
      });
    }

    toast.success(`Exportados ${exportData.length} registros`);
  };

  const getActionBadgeClass = (action: string) => {
    return ACTION_COLORS[action] || "bg-gray-100 text-gray-800";
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando logs de auditoría...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Auditoría Global
          </CardTitle>
          <CardDescription>
            Logs de auditoría de todas las organizaciones
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar en logs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filtrar por acción" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las acciones</SelectItem>
                {uniqueActions.map((action) => (
                  <SelectItem key={action} value={action}>
                    {action}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filtrar por entidad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las entidades</SelectItem>
                {uniqueEntityTypes.map((entity) => (
                  <SelectItem key={entity} value={entity}>
                    {entity}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={handleExportCSV}>
              <Download className="h-4 w-4 mr-2" />
              Exportar CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Logs List */}
      <Card>
        <CardHeader>
          <CardTitle>{filteredLogs?.length || 0} registros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[600px] overflow-y-auto space-y-2">
            {filteredLogs?.map((log) => (
              <div
                key={log.id}
                className="p-3 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={getActionBadgeClass(log.action)}>
                        {log.action}
                      </Badge>
                      <Badge variant="outline">{log.entity_type}</Badge>
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <Building2 className="h-3 w-3" />
                        {log.organization_name}
                      </span>
                    </div>
                    {log.entity_id && (
                      <p className="text-xs text-muted-foreground font-mono">
                        ID: {log.entity_id}
                      </p>
                    )}
                    {log.metadata && Object.keys(log.metadata).length > 1 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                          Ver metadata
                        </summary>
                        <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                  <div className="text-right text-sm text-muted-foreground whitespace-nowrap">
                    <div>{format(new Date(log.created_at), "dd MMM yyyy", { locale: es })}</div>
                    <div>{format(new Date(log.created_at), "HH:mm:ss")}</div>
                  </div>
                </div>
              </div>
            ))}

            {(!filteredLogs || filteredLogs.length === 0) && (
              <p className="text-center text-muted-foreground py-8">
                No hay logs que coincidan con los filtros
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
