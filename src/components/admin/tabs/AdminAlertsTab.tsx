/**
 * Admin Alerts Tab - View and manage critical admin notifications
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Bell, 
  BellOff,
  Check,
  CheckCheck,
  AlertCircle,
  Loader2,
  ExternalLink,
  Shield,
  Eye
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import { useOrganization } from "@/contexts/OrganizationContext";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AdminNotification {
  id: string;
  organization_id: string;
  type: string;
  title: string;
  message: string;
  audit_log_id: string | null;
  is_read: boolean;
  created_at: string;
}

interface AuditLogEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export function AdminAlertsTab() {
  const { organization } = useOrganization();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showRead, setShowRead] = useState(false);
  const [selectedAuditLog, setSelectedAuditLog] = useState<AuditLogEntry | null>(null);

  // Fetch admin notifications
  const { data: notifications, isLoading } = useQuery({
    queryKey: ["admin-notifications", organization?.id, showRead],
    queryFn: async () => {
      if (!organization?.id) return [];

      let query = supabase
        .from("admin_notifications")
        .select("*")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false })
        .limit(100);

      if (!showRead) {
        query = query.eq("is_read", false);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data || []) as AdminNotification[];
    },
    enabled: !!organization?.id,
  });

  // Mark notification as read
  const markAsRead = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from("admin_notifications")
        .update({ is_read: true })
        .in("id", ids);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-notifications"] });
      setSelectedIds(new Set());
      toast.success("Notificaciones marcadas como leídas");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Mark all as read
  const markAllAsRead = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("No organization");

      const { error } = await supabase
        .from("admin_notifications")
        .update({ is_read: true })
        .eq("organization_id", organization.id)
        .eq("is_read", false);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-notifications"] });
      toast.success("Todas las notificaciones marcadas como leídas");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Fetch related audit log
  const fetchAuditLog = async (auditLogId: string) => {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*")
      .eq("id", auditLogId)
      .maybeSingle();
    
    if (error) {
      toast.error("Error al cargar detalles");
      return;
    }
    
    if (data) {
      setSelectedAuditLog(data as AuditLogEntry);
    }
  };

  // Handle deep link navigation
  const handleNavigateToEntity = (notification: AdminNotification) => {
    // Mark as read first
    if (!notification.is_read) {
      markAsRead.mutate([notification.id]);
    }

    // If has audit log, fetch and show details
    if (notification.audit_log_id) {
      fetchAuditLog(notification.audit_log_id);
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const unreadCount = notifications?.filter(n => !n.is_read).length || 0;

  // Defensive check
  if (!organization?.id) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Contexto de Organización
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Cargando contexto de organización...
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center">
              <Bell className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold">{unreadCount}</p>
              <p className="text-xs text-muted-foreground">Sin Leer</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
              <BellOff className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold">{notifications?.length || 0}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Main Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Alertas Administrativas
              </CardTitle>
              <CardDescription>
                Notificaciones de eventos críticos del sistema
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRead(!showRead)}
              >
                {showRead ? "Solo sin leer" : "Mostrar todas"}
              </Button>
              {unreadCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => markAllAsRead.mutate()}
                  disabled={markAllAsRead.isPending}
                >
                  {markAllAsRead.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCheck className="h-4 w-4 mr-2" />
                  )}
                  Marcar todas leídas
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : notifications?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Bell className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No hay alertas {showRead ? "" : "sin leer"}</p>
            </div>
          ) : (
            <>
              {/* Bulk Actions */}
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-3 p-3 mb-4 bg-muted rounded-lg">
                  <span className="text-sm font-medium">
                    {selectedIds.size} seleccionadas
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => markAsRead.mutate(Array.from(selectedIds))}
                    disabled={markAsRead.isPending}
                  >
                    <Check className="h-4 w-4 mr-2" />
                    Marcar leídas
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Cancelar
                  </Button>
                </div>
              )}

              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {notifications?.map((notification) => (
                    <div
                      key={notification.id}
                      className={`
                        flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors
                        ${notification.is_read 
                          ? "bg-muted/30 border-border" 
                          : "bg-destructive/5 border-destructive/20 hover:bg-destructive/10"
                        }
                      `}
                      onClick={() => handleNavigateToEntity(notification)}
                    >
                      <Checkbox
                        checked={selectedIds.has(notification.id)}
                        onCheckedChange={() => toggleSelect(notification.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className={`font-medium ${!notification.is_read ? "text-foreground" : "text-muted-foreground"}`}>
                            {notification.title}
                          </p>
                          {!notification.is_read && (
                            <Badge variant="destructive" className="text-xs">
                              Nuevo
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {notification.message}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true, locale: es })}
                        </p>
                      </div>

                      {notification.audit_log_id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="flex-shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            fetchAuditLog(notification.audit_log_id!);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </CardContent>
      </Card>

      {/* Audit Log Detail Dialog */}
      <Dialog open={!!selectedAuditLog} onOpenChange={() => setSelectedAuditLog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Detalle del Evento
            </DialogTitle>
            <DialogDescription>
              {selectedAuditLog && format(new Date(selectedAuditLog.created_at), "dd MMMM yyyy HH:mm:ss", { locale: es })}
            </DialogDescription>
          </DialogHeader>
          {selectedAuditLog && (
            <ScrollArea className="flex-1 pr-4">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Acción</p>
                    <Badge variant="secondary">{selectedAuditLog.action}</Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Entidad</p>
                    <p className="font-medium">{selectedAuditLog.entity_type}</p>
                  </div>
                </div>

                {selectedAuditLog.entity_id && (
                  <div>
                    <p className="text-sm text-muted-foreground">Entity ID</p>
                    <p className="font-mono text-sm">{selectedAuditLog.entity_id}</p>
                  </div>
                )}

                <div>
                  <p className="text-sm text-muted-foreground mb-2">Metadata (JSON)</p>
                  <pre className="bg-muted p-4 rounded-lg text-xs overflow-auto max-h-[300px]">
                    {JSON.stringify(selectedAuditLog.metadata, null, 2)}
                  </pre>
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
