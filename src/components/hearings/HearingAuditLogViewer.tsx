/**
 * HearingAuditLogViewer — Shows audit trail for hearing-related actions
 * Filters audit_logs by entity_type = 'HEARING' for the work item's org
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History, ChevronDown, ChevronUp, User, Bot } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Props {
  workItemId: string;
  organizationId: string;
}

interface AuditEntry {
  id: string;
  action: string;
  actor_type: string;
  actor_user_id: string | null;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  HEARING_CREATED: "Audiencia creada",
  HEARING_UPDATED: "Audiencia actualizada",
  HEARING_DELETED: "Audiencia eliminada",
  HEARING_STATUS_CHANGED: "Estado cambiado",
  HEARING_ARTIFACT_UPLOADED: "Archivo subido",
  HEARING_ARTIFACT_DELETED: "Archivo eliminado",
  HEARING_KEY_MOMENT_ADDED: "Momento clave añadido",
  HEARING_KEY_MOMENT_REMOVED: "Momento clave eliminado",
  HEARING_AI_INSIGHT: "Análisis AI generado",
  HEARING_FLOW_AUTO_GENERATED: "Flujo auto-generado",
};

const ACTION_COLORS: Record<string, string> = {
  HEARING_CREATED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  HEARING_DELETED: "bg-destructive/10 text-destructive border-destructive/20",
  HEARING_STATUS_CHANGED: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  HEARING_ARTIFACT_UPLOADED: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  HEARING_AI_INSIGHT: "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

export function HearingAuditLogViewer({ workItemId, organizationId }: Props) {
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [limit, setLimit] = useState(25);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["hearing-audit-logs", workItemId, actionFilter, limit],
    queryFn: async () => {
      let query = supabase
        .from("audit_logs")
        .select("*")
        .eq("organization_id", organizationId)
        .in("entity_type", ["HEARING", "HEARING_ARTIFACT", "HEARING_KEY_MOMENT"])
        .order("created_at", { ascending: false })
        .limit(limit);

      if (actionFilter !== "ALL") {
        query = query.eq("action", actionFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Filter client-side by work_item_id in metadata
      return ((data || []) as AuditEntry[]).filter((e) => {
        const meta = e.metadata as Record<string, unknown>;
        return meta?.work_item_id === workItemId || e.entity_id === workItemId;
      });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4" />
            Registro de auditoría
          </CardTitle>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-48 h-8 text-xs">
              <SelectValue placeholder="Filtrar por acción" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas las acciones</SelectItem>
              {Object.entries(ACTION_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground text-center py-8">Cargando...</div>
        ) : entries.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            No hay registros de auditoría para las audiencias de este proceso.
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2">
              {entries.map((entry) => {
                const isExpanded = expandedId === entry.id;
                const colorClass = ACTION_COLORS[entry.action] || "bg-muted text-muted-foreground";
                const meta = entry.metadata as Record<string, unknown>;

                return (
                  <div
                    key={entry.id}
                    className="border rounded-md p-3 text-sm hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {entry.actor_type === "AI" ? (
                          <Bot className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                        ) : (
                          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${colorClass}`}>
                          {ACTION_LABELS[entry.action] || entry.action}
                        </Badge>
                        {meta?.hearing_name && (
                          <span className="text-xs text-muted-foreground truncate">
                            {meta.hearing_name as string}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-muted-foreground">
                          {format(new Date(entry.created_at), "dd MMM yyyy HH:mm", { locale: es })}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-2 pt-2 border-t">
                        <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap break-all bg-muted/20 rounded p-2 max-h-48 overflow-y-auto">
                          {JSON.stringify(entry.metadata, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {entries.length >= limit && (
              <div className="text-center pt-3">
                <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + 25)}>
                  Cargar más
                </Button>
              </div>
            )}
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
