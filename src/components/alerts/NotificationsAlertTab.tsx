/**
 * NotificationsAlertTab — Tab for the /alerts page showing user notifications
 * sourced from `alert_instances` (single source of truth, same as the
 * "Todas" and "Por portal" tabs). Procedural alerts render with the
 * consolidated portal row; operational alerts use a compact inline row.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Bell,
  CheckCheck,
  ExternalLink,
  Eye,
  EyeOff,
  Filter,
  X,
  Inbox,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AlertConsolidatedRow } from "@/components/alerts/AlertConsolidatedRow";

const PROCEDURAL_ALERT_TYPES = new Set([
  "ACTUACION_NUEVA",
  "ACTUACION_MODIFIED",
  "PUBLICACION_NEW",
  "PUBLICACION_MODIFIED",
  "ESTADO_NUEVO",
]);

const SEVERITY_STYLES: Record<string, { dot: string; border: string }> = {
  INFO: { dot: "bg-primary", border: "border-primary/20" },
  WARN: { dot: "bg-amber-500", border: "border-amber-500/30" },
  WARNING: { dot: "bg-amber-500", border: "border-amber-500/30" },
  CRITICAL: { dot: "bg-destructive animate-pulse", border: "border-destructive/30" },
  error: { dot: "bg-destructive animate-pulse", border: "border-destructive/30" },
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  ACTUACION_NUEVA: "Actuación nueva",
  ACTUACION_MODIFIED: "Actuación modificada",
  PUBLICACION_NEW: "Publicación nueva",
  PUBLICACION_MODIFIED: "Publicación modificada",
  ESTADO_NUEVO: "Estado nuevo",
  TAREA_VENCIDA: "Tarea vencida",
  HEARING_REMINDER: "Audiencia próxima",
  HEARING_TODAY: "Audiencia hoy",
  TERMINO_CRITICO: "Término crítico",
  TERMINO_VENCIDO: "Término vencido",
  WATCHDOG_PROVIDER_DOWN: "Proveedor caído",
};

interface AlertInstance {
  id: string;
  entity_id: string;
  entity_type: string;
  alert_type: string | null;
  alert_source: string | null;
  severity: string;
  status: string;
  title: string;
  message: string;
  fired_at: string;
  read_at: string | null;
  acknowledged_at: string | null;
  dismissed_at: string | null;
  payload: Record<string, unknown> | null;
}

const PAGE_SIZE = 100;

export function NotificationsAlertTab() {
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [showRead, setShowRead] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["alert-instances-notifications"] });
    queryClient.invalidateQueries({ queryKey: ["alert-instances"] });
    queryClient.invalidateQueries({ queryKey: ["unified-notifications"] });
    queryClient.invalidateQueries({ queryKey: ["unified-notifications-unread"] });
  };

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ["alert-instances-notifications", typeFilter, severityFilter, showRead],
    queryFn: async () => {
      let query = supabase
        .from("alert_instances")
        .select("*")
        .neq("status", "DISMISSED")
        .order("fired_at", { ascending: false })
        .limit(PAGE_SIZE);

      if (typeFilter !== "all") {
        query = query.eq("alert_type", typeFilter);
      }
      if (severityFilter !== "all") {
        query = query.eq("severity", severityFilter);
      }
      if (!showRead) {
        query = query.is("read_at", null);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as AlertInstance[];
    },
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("alert_instances")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const acknowledge = useMutation({
    mutationFn: async (id: string) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("alert_instances")
        .update({ status: "ACKNOWLEDGED", acknowledged_at: now, read_at: now })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("alert_instances")
        .update({ status: "DISMISSED", dismissed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Notificación descartada");
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      let query = supabase
        .from("alert_instances")
        .update({ read_at: new Date().toISOString() })
        .is("read_at", null)
        .neq("status", "DISMISSED");

      if (typeFilter !== "all") {
        query = query.eq("alert_type", typeFilter);
      }
      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Todas marcadas como leídas");
    },
  });

  const bulkDismiss = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from("alert_instances")
        .update({ status: "DISMISSED", dismissed_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      invalidateAll();
      toast.success("Notificaciones descartadas");
    },
  });

  const bulkMarkRead = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from("alert_instances")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      invalidateAll();
      toast.success("Marcadas como leídas");
    },
  });

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(alerts.map((a) => a.id)));
  };

  const unreadCount = alerts.filter((a) => !a.read_at).length;
  const isProcedural = (a: AlertInstance) => {
    if (a.alert_type && PROCEDURAL_ALERT_TYPES.has(a.alert_type)) return true;
    const p = (a.payload ?? {}) as Record<string, unknown>;
    return Boolean(p.portal || p.despacho || p.demandante || p.tipo_actuacion);
  };

  // Available filter types: union of procedural + types present in current data
  const presentTypes = Array.from(
    new Set(alerts.map((a) => a.alert_type).filter((t): t is string => !!t)),
  );
  const filterTypes = Array.from(
    new Set([...PROCEDURAL_ALERT_TYPES, ...presentTypes]),
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notificaciones de Asuntos
            {unreadCount > 0 && (
              <Badge variant="secondary" className="ml-1">
                {unreadCount} sin leer
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRead(!showRead)}
            >
              {showRead ? <EyeOff className="h-3.5 w-3.5 mr-1.5" /> : <Eye className="h-3.5 w-3.5 mr-1.5" />}
              {showRead ? "Ocultar leídas" : "Mostrar leídas"}
            </Button>
            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
                Marcar todas
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              {filterTypes.map((key) => (
                <SelectItem key={key} value={key}>
                  {ALERT_TYPE_LABELS[key] ?? key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Severidad" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="INFO">Info</SelectItem>
              <SelectItem value="WARN">Alerta</SelectItem>
              <SelectItem value="CRITICAL">Crítica</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted">
            <span className="text-sm text-muted-foreground">{selectedIds.size} seleccionadas</span>
            <Button size="sm" variant="outline" onClick={selectAll}>Seleccionar todas</Button>
            <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())}>Limpiar</Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => bulkMarkRead.mutate(Array.from(selectedIds))}
              disabled={bulkMarkRead.isPending}
            >
              Marcar leídas
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => bulkDismiss.mutate(Array.from(selectedIds))}
              disabled={bulkDismiss.isPending}
            >
              Descartar
            </Button>
          </div>
        )}

        {/* List */}
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Cargando...</div>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Inbox className="h-12 w-12 mb-3 opacity-50" />
            <p className="text-sm">No hay notificaciones {!showRead ? "sin leer" : ""}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((a) => {
              if (isProcedural(a)) {
                return (
                  <AlertConsolidatedRow
                    key={a.id}
                    alert={a}
                    isSelected={selectedIds.has(a.id)}
                    showCheckbox
                    onToggleSelect={toggleSelection}
                    onAcknowledge={(id) => acknowledge.mutate(id)}
                    onDismiss={(id) => dismiss.mutate(id)}
                    isDismissing={dismiss.isPending}
                  />
                );
              }

              const severity = SEVERITY_STYLES[a.severity] || SEVERITY_STYLES.INFO;
              const typeLabel = a.alert_type ? (ALERT_TYPE_LABELS[a.alert_type] ?? a.alert_type) : "Notificación";
              const deepLink = a.entity_id ? `/app/work-items/${a.entity_id}` : null;

              return (
                <div
                  key={a.id}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border transition-colors",
                    severity.border,
                    !a.read_at ? "bg-primary/5" : "bg-background",
                    selectedIds.has(a.id) && "ring-2 ring-primary",
                  )}
                >
                  <Checkbox
                    checked={selectedIds.has(a.id)}
                    onCheckedChange={() => toggleSelection(a.id)}
                    className="mt-1 shrink-0"
                  />
                  <div className={cn("h-2.5 w-2.5 rounded-full mt-1.5 shrink-0", severity.dot)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {typeLabel}
                      </Badge>
                      {(a.severity === "CRITICAL" || a.severity === "error") && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Crítica</Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium">{a.title}</p>
                    {a.message && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{a.message}</p>
                    )}
                    <p className="text-[11px] text-muted-foreground/70 mt-1">
                      {formatDistanceToNow(new Date(a.fired_at), { addSuffix: true, locale: es })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {deepLink && (
                      <Button variant="ghost" size="sm" asChild title="Ver asunto">
                        <Link to={deepLink}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    )}
                    {!a.read_at && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => markRead.mutate(a.id)}
                        title="Marcar leída"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => dismiss.mutate(a.id)}
                      title="Descartar"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
