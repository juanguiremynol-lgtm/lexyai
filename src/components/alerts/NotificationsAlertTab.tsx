/**
 * NotificationsAlertTab — Tab for the /alerts page showing user notifications
 * (ACTUACION_NUEVA, ESTADO_NUEVO, STAGE_CHANGE, etc.) from the unified notifications table.
 */

import { useState, useMemo } from "react";
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
import { ALERT_TYPE_LABELS, type UserAlertType } from "@/lib/alerts/create-user-alert";

const SEVERITY_STYLES: Record<string, { dot: string; border: string }> = {
  INFO: { dot: "bg-primary", border: "border-primary/20" },
  WARNING: { dot: "bg-amber-500", border: "border-amber-500/30" },
  CRITICAL: { dot: "bg-destructive animate-pulse", border: "border-destructive/30" },
};

const ALERT_TYPE_BADGE_STYLES: Record<string, string> = {
  ACTUACION_NUEVA: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  ESTADO_NUEVO: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  STAGE_CHANGE: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  TAREA_CREADA: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  TAREA_VENCIDA: "bg-destructive/10 text-destructive",
  AUDIENCIA_PROXIMA: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  AUDIENCIA_CREADA: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  TERMINO_CRITICO: "bg-destructive/10 text-destructive",
  TERMINO_VENCIDO: "bg-destructive/10 text-destructive",
  PETICION_CREADA: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  HITO_ALCANZADO: "bg-green-500/10 text-green-600 dark:text-green-400",
};

interface UserNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  severity: string;
  category: string;
  work_item_id: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
  deep_link: string | null;
}

const PAGE_SIZE = 50;

export function NotificationsAlertTab() {
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [showRead, setShowRead] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["user-notifications-page", typeFilter, severityFilter, showRead],
    queryFn: async () => {
      let query = (supabase.from("notifications") as any)
        .select("*")
        .in("category", ["WORK_ITEM_ALERTS", "TERMS"])
        .is("dismissed_at", null)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);

      if (typeFilter !== "all") {
        query = query.eq("type", typeFilter);
      }
      if (severityFilter !== "all") {
        query = query.eq("severity", severityFilter);
      }
      if (!showRead) {
        query = query.is("read_at", null);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as UserNotification[];
    },
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("notifications") as any)
        .update({ read_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-notifications-page"] });
      queryClient.invalidateQueries({ queryKey: ["unified-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unified-notifications-unread"] });
    },
  });

  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("notifications") as any)
        .update({ dismissed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-notifications-page"] });
      queryClient.invalidateQueries({ queryKey: ["unified-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unified-notifications-unread"] });
      toast.success("Notificación descartada");
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      let query = (supabase.from("notifications") as any)
        .update({ read_at: new Date().toISOString() })
        .is("read_at", null)
        .is("dismissed_at", null)
        .in("category", ["WORK_ITEM_ALERTS", "TERMS"]);

      if (typeFilter !== "all") {
        query = query.eq("type", typeFilter);
      }
      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-notifications-page"] });
      queryClient.invalidateQueries({ queryKey: ["unified-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unified-notifications-unread"] });
      toast.success("Todas marcadas como leídas");
    },
  });

  const bulkDismiss = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await (supabase.from("notifications") as any)
        .update({ dismissed_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["user-notifications-page"] });
      queryClient.invalidateQueries({ queryKey: ["unified-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unified-notifications-unread"] });
      toast.success("Notificaciones descartadas");
    },
  });

  const bulkMarkRead = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await (supabase.from("notifications") as any)
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["user-notifications-page"] });
      queryClient.invalidateQueries({ queryKey: ["unified-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unified-notifications-unread"] });
      toast.success("Marcadas como leídas");
    },
  });

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(notifications.map(n => n.id)));
  };

  const unreadCount = notifications.filter(n => !n.read_at).length;

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
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              {Object.entries(ALERT_TYPE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
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
              <SelectItem value="WARNING">Alerta</SelectItem>
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
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Inbox className="h-12 w-12 mb-3 opacity-50" />
            <p className="text-sm">No hay notificaciones {!showRead ? "sin leer" : ""}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map(n => {
              const severity = SEVERITY_STYLES[n.severity] || SEVERITY_STYLES.INFO;
              const typeLabel = ALERT_TYPE_LABELS[n.type as UserAlertType] || n.type;
              const typeBadgeStyle = ALERT_TYPE_BADGE_STYLES[n.type] || "bg-muted text-muted-foreground";
              const radicado = (n.metadata as any)?.radicado;

              return (
                <div
                  key={n.id}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border transition-colors",
                    severity.border,
                    !n.read_at ? "bg-primary/5" : "bg-background",
                    selectedIds.has(n.id) && "ring-2 ring-primary"
                  )}
                >
                  <Checkbox
                    checked={selectedIds.has(n.id)}
                    onCheckedChange={() => toggleSelection(n.id)}
                    className="mt-1 shrink-0"
                  />
                  <div className={cn("h-2.5 w-2.5 rounded-full mt-1.5 shrink-0", severity.dot)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", typeBadgeStyle)}>
                        {typeLabel}
                      </Badge>
                      {n.severity === "CRITICAL" && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Crítica</Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium">{n.title}</p>
                    {n.body && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</p>
                    )}
                    {radicado && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Radicado: <code className="bg-muted px-1 rounded">{String(radicado)}</code>
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground/70 mt-1">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: es })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {n.deep_link && (
                      <Button variant="ghost" size="sm" asChild title="Ver asunto">
                        <Link to={n.deep_link}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    )}
                    {!n.read_at && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => markRead.mutate(n.id)}
                        title="Marcar leída"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => dismiss.mutate(n.id)}
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
