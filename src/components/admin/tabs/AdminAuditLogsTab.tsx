/**
 * Admin Audit Logs Tab - View organization audit trail
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  History, 
  Search,
  User,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileText,
  Shield,
  AlertCircle,
  Eye
} from "lucide-react";
import { formatDistanceToNow, format, subDays } from "date-fns";
import { es } from "date-fns/locale";
import { useOrganization } from "@/contexts/OrganizationContext";
import { Skeleton } from "@/components/ui/skeleton";
import type { AuditAction, EntityType } from "@/lib/audit-log";

interface AuditLogEntry {
  id: string;
  organization_id: string;
  actor_user_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const ACTION_LABELS: Partial<Record<AuditAction, string>> = {
  WORK_ITEM_CREATED: "Proceso creado",
  WORK_ITEM_UPDATED: "Proceso actualizado",
  WORK_ITEM_STAGE_CHANGED: "Etapa cambiada",
  WORK_ITEM_SOFT_DELETED: "Proceso archivado",
  WORK_ITEM_RESTORED: "Proceso restaurado",
  WORK_ITEM_HARD_DELETED: "Proceso eliminado",
  CLIENT_CREATED: "Cliente creado",
  CLIENT_UPDATED: "Cliente actualizado",
  CLIENT_SOFT_DELETED: "Cliente archivado",
  CLIENT_RESTORED: "Cliente restaurado",
  CLIENT_HARD_DELETED: "Cliente eliminado",
  MEMBERSHIP_ROLE_CHANGED: "Rol cambiado",
  MEMBERSHIP_REMOVED: "Miembro removido",
  MEMBERSHIP_ADDED: "Miembro agregado",
  OWNERSHIP_TRANSFERRED: "Propiedad transferida",
  ORGANIZATION_UPDATED: "Organización actualizada",
  INVITE_SENT: "Invitación enviada",
  INVITE_REVOKED: "Invitación revocada",
  INVITE_ACCEPTED: "Invitación aceptada",
  EMAIL_RETRY: "Correo reintentado",
  EMAIL_CANCELLED: "Correo cancelado",
  EMAIL_BULK_RETRY: "Correos reintentados (masivo)",
  TRIAL_EXTENDED: "Prueba extendida",
  SUBSCRIPTION_ACTIVATED: "Suscripción activada",
  SUBSCRIPTION_SUSPENDED: "Suscripción suspendida",
  SUBSCRIPTION_UNSUSPENDED: "Suscripción reactivada",
  SUBSCRIPTION_EXPIRED: "Suscripción expirada",
  SECURITY_SETTINGS_UPDATED: "Seguridad actualizada",
  DATA_EXPORTED: "Datos exportados",
  DEMO_DATA_RESET: "Datos reiniciados",
  RECYCLE_BIN_PURGED: "Papelera vaciada",
  RECYCLE_BIN_RESTORED: "Elementos restaurados",
};

const ENTITY_LABELS: Record<EntityType, string> = {
  work_item: "Proceso",
  client: "Cliente",
  alert: "Alerta",
  task: "Tarea",
  hearing: "Audiencia",
  process_event: "Evento",
  membership: "Membresía",
  invite: "Invitación",
  email_outbox: "Correo",
  subscription: "Suscripción",
  import: "Importación",
  organization: "Organización",
};

const DATE_RANGES = [
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
  { value: "all", label: "Todo" },
];

const PAGE_SIZE = 25;

export function AdminAuditLogsTab() {
  const { organization } = useOrganization();
  
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<string>("30");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

  // Fetch audit logs
  const { data: auditLogs, isLoading } = useQuery({
    queryKey: ["admin-audit-logs", organization?.id, actionFilter, entityFilter, dateRange, page],
    queryFn: async () => {
      if (!organization?.id) return { logs: [], total: 0 };

      let query = supabase
        .from("audit_logs")
        .select("*", { count: "exact" })
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      // Apply date filter
      if (dateRange !== "all") {
        const startDate = subDays(new Date(), parseInt(dateRange));
        query = query.gte("created_at", startDate.toISOString());
      }

      // Apply action filter
      if (actionFilter !== "all") {
        query = query.eq("action", actionFilter);
      }

      // Apply entity filter
      if (entityFilter !== "all") {
        query = query.eq("entity_type", entityFilter);
      }

      const { data, error, count } = await query;
      if (error) throw error;

      return { 
        logs: (data || []) as AuditLogEntry[], 
        total: count || 0 
      };
    },
    enabled: !!organization?.id,
  });

  // Fetch user details for display
  const { data: userDetails } = useQuery({
    queryKey: ["audit-user-details", auditLogs?.logs.map(l => l.actor_user_id).filter(Boolean)],
    queryFn: async () => {
      const userIds = auditLogs?.logs
        .map(l => l.actor_user_id)
        .filter((id): id is string => !!id) || [];
      
      if (userIds.length === 0) return {};

      const { data } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);

      const map: Record<string, string> = {};
      (data || []).forEach(u => {
        map[u.id] = u.full_name || "Usuario";
      });
      return map;
    },
    enabled: (auditLogs?.logs.length || 0) > 0,
  });

  // Filter by search (client-side for simplicity)
  const filteredLogs = auditLogs?.logs.filter(log => {
    if (!searchQuery) return true;
    const search = searchQuery.toLowerCase();
    return (
      log.action.toLowerCase().includes(search) ||
      log.entity_type.toLowerCase().includes(search) ||
      log.entity_id?.toLowerCase().includes(search) ||
      JSON.stringify(log.metadata).toLowerCase().includes(search)
    );
  }) || [];

  const totalPages = Math.ceil((auditLogs?.total || 0) / PAGE_SIZE);

  // Get unique actions from current data for filter
  const uniqueActions = [...new Set(auditLogs?.logs.map(l => l.action) || [])];

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
      {/* Header Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <History className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{auditLogs?.total || 0}</p>
              <p className="text-xs text-muted-foreground">Total Eventos</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Audit Logs Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Historial de Auditoría
          </CardTitle>
          <CardDescription>
            Registro inmutable de todas las acciones administrativas
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar en logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-40">
                <Calendar className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_RANGES.map(r => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Entidad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {Object.entries(ENTITY_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Acción" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las acciones</SelectItem>
                {uniqueActions.map(action => (
                  <SelectItem key={action} value={action}>
                    {ACTION_LABELS[action as AuditAction] || action}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No hay registros de auditoría</p>
            </div>
          ) : (
            <>
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Acción</TableHead>
                      <TableHead>Entidad</TableHead>
                      <TableHead>Resumen</TableHead>
                      <TableHead className="text-right">Ver</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.map((log) => (
                      <TableRow key={log.id} className="cursor-pointer hover:bg-muted/50">
                        <TableCell className="text-sm">
                          <div className="space-y-0.5">
                            <p className="font-medium">
                              {format(new Date(log.created_at), "dd MMM", { locale: es })}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(log.created_at), "HH:mm")}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {log.actor_type === "SYSTEM" ? (
                              <Badge variant="outline" className="text-xs">
                                <Shield className="h-3 w-3 mr-1" />
                                Sistema
                              </Badge>
                            ) : (
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm truncate max-w-[120px]">
                                  {userDetails?.[log.actor_user_id || ""] || "Usuario"}
                                </span>
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {ACTION_LABELS[log.action as AuditAction] || log.action}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-0.5">
                            <p className="text-sm">
                              {ENTITY_LABELS[log.entity_type as EntityType] || log.entity_type}
                            </p>
                            {log.entity_id && (
                              <p className="text-xs text-muted-foreground font-mono truncate max-w-[100px]">
                                {log.entity_id.slice(0, 8)}...
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          <p className="text-xs text-muted-foreground truncate">
                            {log.metadata && typeof log.metadata === "object" 
                              ? Object.entries(log.metadata)
                                  .slice(0, 2)
                                  .map(([k, v]) => `${k}: ${String(v).slice(0, 20)}`)
                                  .join(", ")
                              : "—"
                            }
                          </p>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedLog(log)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>

              {/* Pagination */}
              <div className="flex items-center justify-between pt-4 border-t">
                <p className="text-sm text-muted-foreground">
                  Mostrando {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, auditLogs?.total || 0)} de {auditLogs?.total || 0}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm">
                    Página {page + 1} de {totalPages || 1}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => p + 1)}
                    disabled={page >= totalPages - 1}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Detalle del Registro
            </DialogTitle>
            <DialogDescription>
              {selectedLog && format(new Date(selectedLog.created_at), "dd MMMM yyyy HH:mm:ss", { locale: es })}
            </DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <ScrollArea className="flex-1 pr-4">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Acción</p>
                    <Badge variant="secondary">
                      {ACTION_LABELS[selectedLog.action as AuditAction] || selectedLog.action}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Entidad</p>
                    <p className="font-medium">
                      {ENTITY_LABELS[selectedLog.entity_type as EntityType] || selectedLog.entity_type}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Actor</p>
                    <p className="font-medium">
                      {selectedLog.actor_type === "SYSTEM" 
                        ? "Sistema" 
                        : userDetails?.[selectedLog.actor_user_id || ""] || "Usuario"
                      }
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Entity ID</p>
                    <p className="font-mono text-sm truncate">
                      {selectedLog.entity_id || "—"}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground mb-2">Metadata (JSON)</p>
                  <pre className="bg-muted p-4 rounded-lg text-xs overflow-auto max-h-[300px]">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground">ID del Registro</p>
                  <p className="font-mono text-xs">{selectedLog.id}</p>
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
