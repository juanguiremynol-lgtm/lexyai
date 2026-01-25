/**
 * Admin Audit Logs Tab - View organization audit trail with filters, export, and deep linking
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileText,
  Shield,
  AlertCircle,
  Eye,
  Download,
  ExternalLink,
  Filter,
  X
} from "lucide-react";
import { formatDistanceToNow, format, subDays, startOfDay, endOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { logAudit, type AuditAction, type EntityType } from "@/lib/audit-log";
import { getAuditSeverity, SEVERITY_COLORS, SEVERITY_LABELS, type AuditSeverity } from "@/lib/audit-critical";
import { cn } from "@/lib/utils";

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

const ACTION_LABELS: Record<string, string> = {
  // Work Item Actions
  WORK_ITEM_CREATED: "Proceso creado",
  WORK_ITEM_UPDATED: "Proceso actualizado",
  WORK_ITEM_STAGE_CHANGED: "Etapa cambiada",
  WORK_ITEM_CLIENT_LINKED: "Cliente vinculado",
  WORK_ITEM_SOFT_DELETED: "Proceso archivado",
  WORK_ITEM_RESTORED: "Proceso restaurado",
  WORK_ITEM_HARD_DELETED: "Proceso eliminado",
  // Client Actions
  CLIENT_CREATED: "Cliente creado",
  CLIENT_UPDATED: "Cliente actualizado",
  CLIENT_SOFT_DELETED: "Cliente archivado",
  CLIENT_RESTORED: "Cliente restaurado",
  CLIENT_HARD_DELETED: "Cliente eliminado",
  // Membership Actions
  MEMBERSHIP_ROLE_CHANGED: "Rol cambiado",
  MEMBERSHIP_REMOVED: "Miembro removido",
  MEMBERSHIP_ADDED: "Miembro agregado",
  OWNERSHIP_TRANSFERRED: "Propiedad transferida",
  // Organization Actions
  ORGANIZATION_UPDATED: "Organización actualizada",
  // Invite Actions
  INVITE_SENT: "Invitación enviada",
  INVITE_RESENT: "Invitación reenviada",
  INVITE_REVOKED: "Invitación revocada",
  INVITE_ACCEPTED: "Invitación aceptada",
  INVITE_EXPIRED: "Invitación expirada",
  // Email Actions
  EMAIL_QUEUED: "Correo encolado",
  EMAIL_SENT: "Correo enviado",
  EMAIL_FAILED: "Correo fallido",
  EMAIL_RETRY: "Correo reintentado",
  EMAIL_CANCELLED: "Correo cancelado",
  EMAIL_BULK_RETRY: "Correos reintentados",
  // Subscription Actions
  TRIAL_STARTED: "Prueba iniciada",
  TRIAL_EXTENDED: "Prueba extendida",
  SUBSCRIPTION_ACTIVATED: "Suscripción activada",
  SUBSCRIPTION_SUSPENDED: "Suscripción suspendida",
  SUBSCRIPTION_UNSUSPENDED: "Suscripción reactivada",
  SUBSCRIPTION_EXPIRED: "Suscripción expirada",
  // Security Actions
  SECURITY_SETTINGS_UPDATED: "Seguridad actualizada",
  // Data Lifecycle Actions
  DATA_EXPORTED: "Datos exportados",
  DATA_PURGED: "Datos purgados",
  DEMO_DATA_RESET: "Datos reiniciados",
  RECYCLE_BIN_PURGED: "Papelera vaciada",
  RECYCLE_BIN_RESTORED: "Elementos restaurados",
  // DB Trigger Actions
  DB_MEMBERSHIP_INSERTED: "Miembro insertado (DB)",
  DB_MEMBERSHIP_UPDATED: "Miembro actualizado (DB)",
  DB_MEMBERSHIP_DELETED: "Miembro eliminado (DB)",
  DB_SUBSCRIPTION_UPDATED: "Suscripción actualizada (DB)",
  DB_EMAIL_STATUS_CHANGED: "Estado email cambiado (DB)",
  // Generic
  GENERIC_ACTION: "Acción genérica",
};

const ENTITY_LABELS: Record<string, string> = {
  work_item: "Proceso",
  client: "Cliente",
  alert: "Alerta",
  task: "Tarea",
  hearing: "Audiencia",
  process_event: "Evento",
  membership: "Membresía",
  organization_memberships: "Membresía",
  invite: "Invitación",
  email_outbox: "Correo",
  subscription: "Suscripción",
  subscriptions: "Suscripción",
  import: "Importación",
  organization: "Organización",
};

const ALL_ACTIONS = Object.keys(ACTION_LABELS);
const ALL_ENTITIES = Object.keys(ENTITY_LABELS);

const PAGE_SIZE = 25;
const MAX_EXPORT_ROWS = 5000;

export function AdminAuditLogsTab() {
  const { organization } = useOrganization();
  const navigate = useNavigate();
  
  // Filter state
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [actorFilter, setActorFilter] = useState("");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(subDays(new Date(), 30));
  const [dateTo, setDateTo] = useState<Date | undefined>(new Date());
  const [includeDbEvents, setIncludeDbEvents] = useState(true);
  const [page, setPage] = useState(0);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Reset page when filters change
  const handleFilterChange = <T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: T) => {
    setter(value);
    setPage(0);
  };

  // Fetch audit logs
  const { data: auditLogs, isLoading } = useQuery({
    queryKey: ["admin-audit-logs", organization?.id, actionFilter, entityFilter, severityFilter, actorFilter, dateFrom, dateTo, includeDbEvents, page],
    queryFn: async () => {
      if (!organization?.id) return { logs: [], total: 0 };

      let query = supabase
        .from("audit_logs")
        .select("*", { count: "exact" })
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      // Apply date filters
      if (dateFrom) {
        query = query.gte("created_at", startOfDay(dateFrom).toISOString());
      }
      if (dateTo) {
        query = query.lte("created_at", endOfDay(dateTo).toISOString());
      }

      // Apply action filter
      if (actionFilter !== "all") {
        query = query.eq("action", actionFilter);
      }

      // Apply entity filter
      if (entityFilter !== "all") {
        query = query.eq("entity_type", entityFilter);
      }

      // Exclude DB events if toggle is off
      if (!includeDbEvents) {
        query = query.not("action", "like", "DB_%");
      }

      // Actor filter (search in metadata as fallback)
      if (actorFilter.trim()) {
        query = query.ilike("metadata::text", `%${actorFilter.trim()}%`);
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

  // Apply severity filter client-side
  const filteredLogs = useMemo(() => {
    if (!auditLogs?.logs) return [];
    if (severityFilter === "all") return auditLogs.logs;
    return auditLogs.logs.filter(log => getAuditSeverity(log.action) === severityFilter);
  }, [auditLogs?.logs, severityFilter]);

  const totalPages = Math.ceil((auditLogs?.total || 0) / PAGE_SIZE);

  // Export CSV
  const exportCSV = async () => {
    if (!organization?.id) return;
    
    setIsExporting(true);
    try {
      // Fetch all logs with current filters (up to MAX_EXPORT_ROWS)
      let query = supabase
        .from("audit_logs")
        .select("*")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false })
        .range(0, MAX_EXPORT_ROWS - 1);

      if (dateFrom) {
        query = query.gte("created_at", startOfDay(dateFrom).toISOString());
      }
      if (dateTo) {
        query = query.lte("created_at", endOfDay(dateTo).toISOString());
      }
      if (actionFilter !== "all") {
        query = query.eq("action", actionFilter);
      }
      if (entityFilter !== "all") {
        query = query.eq("entity_type", entityFilter);
      }
      if (!includeDbEvents) {
        query = query.not("action", "like", "DB_%");
      }
      if (actorFilter.trim()) {
        query = query.ilike("metadata::text", `%${actorFilter.trim()}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      const logs = data as AuditLogEntry[];

      // Apply severity filter client-side
      const filteredExport = severityFilter === "all" 
        ? logs 
        : logs.filter(log => getAuditSeverity(log.action) === severityFilter);

      // Build CSV
      const headers = ["Fecha", "Acción", "Tipo Entidad", "ID Entidad", "Actor", "Severidad", "Resumen", "Metadata JSON"];
      const rows = filteredExport.map(log => [
        format(new Date(log.created_at), "yyyy-MM-dd HH:mm:ss"),
        log.action,
        log.entity_type,
        log.entity_id || "",
        log.actor_type === "SYSTEM" ? "SYSTEM" : (userDetails?.[log.actor_user_id || ""] || log.actor_user_id || ""),
        getAuditSeverity(log.action),
        ACTION_LABELS[log.action] || log.action,
        JSON.stringify(log.metadata),
      ]);

      // Escape CSV values
      const escapeCSV = (val: string) => {
        if (val.includes(",") || val.includes('"') || val.includes("\n")) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      };

      const csvContent = [
        headers.join(","),
        ...rows.map(row => row.map(escapeCSV).join(","))
      ].join("\n");

      // Download
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `audit_logs_${format(new Date(), "yyyy-MM-dd_HHmm")}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);

      // Log the export
      await logAudit({
        organizationId: organization.id,
        action: "DATA_EXPORTED",
        entityType: "organization",
        entityId: organization.id,
        metadata: {
          exportType: "audit_logs",
          filters: { actionFilter, entityFilter, severityFilter, dateFrom: dateFrom?.toISOString(), dateTo: dateTo?.toISOString() },
          rowCount: filteredExport.length,
        },
      });

      if (filteredExport.length >= MAX_EXPORT_ROWS) {
        toast.warning(`Export limitado a ${MAX_EXPORT_ROWS} filas. Use filtros más específicos para obtener más datos.`);
      } else {
        toast.success(`Exportadas ${filteredExport.length} filas`);
      }

    } catch (error) {
      console.error("Export error:", error);
      toast.error("Error al exportar");
    } finally {
      setIsExporting(false);
    }
  };

  // Deep link navigation
  const navigateToEntity = (log: AuditLogEntry) => {
    const entityType = log.entity_type;
    const entityId = log.entity_id;
    const metadata = log.metadata as Record<string, unknown>;

    // Try to resolve entity from metadata if entityId is null
    const resolvedEntityId = entityId || (metadata?.work_item_id as string) || (metadata?.client_id as string);

    if (entityType === "work_item" && resolvedEntityId) {
      navigate(`/work-items/${resolvedEntityId}`);
      return;
    }

    if (entityType === "client" && resolvedEntityId) {
      navigate(`/clients/${resolvedEntityId}`);
      return;
    }

    if (entityType === "task" && metadata?.work_item_id) {
      navigate(`/work-items/${metadata.work_item_id}?tab=tareas`);
      return;
    }

    if (entityType === "email_outbox" || entityType === "organization_memberships" || entityType === "subscriptions") {
      navigate("/settings?tab=admin");
      return;
    }

    // Fallback: show detail modal
    setSelectedLog(log);
  };

  // Clear all filters
  const clearFilters = () => {
    setActionFilter("all");
    setEntityFilter("all");
    setSeverityFilter("all");
    setActorFilter("");
    setDateFrom(subDays(new Date(), 30));
    setDateTo(new Date());
    setIncludeDbEvents(true);
    setPage(0);
  };

  const hasActiveFilters = actionFilter !== "all" || entityFilter !== "all" || severityFilter !== "all" || actorFilter.trim() !== "" || !includeDbEvents;

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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5 text-primary" />
                Historial de Auditoría
              </CardTitle>
              <CardDescription>
                Registro inmutable de todas las acciones administrativas
              </CardDescription>
            </div>
            <Button
              onClick={exportCSV}
              disabled={isExporting || !auditLogs?.total}
              variant="outline"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Exportar CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter Toolbar */}
          <div className="p-4 border rounded-lg bg-muted/30 space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Filter className="h-4 w-4" />
              Filtros
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-6 px-2 text-xs">
                  <X className="h-3 w-3 mr-1" />
                  Limpiar
                </Button>
              )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Action Filter */}
              <div className="space-y-1.5">
                <Label className="text-xs">Acción</Label>
                <Select value={actionFilter} onValueChange={(v) => handleFilterChange(setActionFilter, v)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las acciones</SelectItem>
                    {ALL_ACTIONS.map(action => (
                      <SelectItem key={action} value={action}>
                        {ACTION_LABELS[action]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Entity Filter */}
              <div className="space-y-1.5">
                <Label className="text-xs">Entidad</Label>
                <Select value={entityFilter} onValueChange={(v) => handleFilterChange(setEntityFilter, v)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las entidades</SelectItem>
                    {ALL_ENTITIES.map(entity => (
                      <SelectItem key={entity} value={entity}>
                        {ENTITY_LABELS[entity]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Severity Filter */}
              <div className="space-y-1.5">
                <Label className="text-xs">Severidad</Label>
                <Select value={severityFilter} onValueChange={(v) => handleFilterChange(setSeverityFilter, v)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="CRITICAL">Crítico</SelectItem>
                    <SelectItem value="HIGH">Alto</SelectItem>
                    <SelectItem value="NORMAL">Normal</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Actor Search */}
              <div className="space-y-1.5">
                <Label className="text-xs">Actor (búsqueda)</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar actor..."
                    value={actorFilter}
                    onChange={(e) => handleFilterChange(setActorFilter, e.target.value)}
                    className="h-9 pl-8"
                  />
                </div>
              </div>
            </div>

            {/* Date Range and DB Events Toggle */}
            <div className="flex flex-wrap items-end gap-4">
              {/* Date From */}
              <div className="space-y-1.5">
                <Label className="text-xs">Desde</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-9 w-[140px] justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateFrom ? format(dateFrom, "dd/MM/yyyy") : "Seleccionar"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateFrom}
                      onSelect={(d) => handleFilterChange(setDateFrom, d)}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Date To */}
              <div className="space-y-1.5">
                <Label className="text-xs">Hasta</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-9 w-[140px] justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateTo ? format(dateTo, "dd/MM/yyyy") : "Seleccionar"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateTo}
                      onSelect={(d) => handleFilterChange(setDateTo, d)}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Include DB Events Toggle */}
              <div className="flex items-center gap-2 pb-1">
                <Switch
                  id="include-db"
                  checked={includeDbEvents}
                  onCheckedChange={(v) => handleFilterChange(setIncludeDbEvents, v)}
                />
                <Label htmlFor="include-db" className="text-xs cursor-pointer">
                  Incluir eventos DB
                </Label>
              </div>
            </div>
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
                      <TableHead className="w-[100px]">Fecha</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Acción</TableHead>
                      <TableHead>Severidad</TableHead>
                      <TableHead>Entidad</TableHead>
                      <TableHead>Resumen</TableHead>
                      <TableHead className="text-right w-[80px]">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.map((log) => {
                      const severity = getAuditSeverity(log.action);
                      const colors = SEVERITY_COLORS[severity];
                      
                      return (
                        <TableRow 
                          key={log.id} 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => navigateToEntity(log)}
                        >
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
                              {ACTION_LABELS[log.action] || log.action}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge 
                              variant="outline" 
                              className={cn("text-xs", colors.bg, colors.text, colors.border)}
                            >
                              {SEVERITY_LABELS[severity]}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-0.5">
                              <p className="text-sm">
                                {ENTITY_LABELS[log.entity_type] || log.entity_type}
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
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedLog(log);
                                }}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              {log.entity_id && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigateToEntity(log);
                                  }}
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
                      {ACTION_LABELS[selectedLog.action] || selectedLog.action}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Severidad</p>
                    <Badge 
                      variant="outline"
                      className={cn(
                        SEVERITY_COLORS[getAuditSeverity(selectedLog.action)].bg,
                        SEVERITY_COLORS[getAuditSeverity(selectedLog.action)].text
                      )}
                    >
                      {SEVERITY_LABELS[getAuditSeverity(selectedLog.action)]}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Entidad</p>
                    <p className="font-medium">
                      {ENTITY_LABELS[selectedLog.entity_type] || selectedLog.entity_type}
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

                <div className="flex gap-2">
                  {selectedLog.entity_id && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedLog(null);
                        navigateToEntity(selectedLog);
                      }}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Ir a entidad
                    </Button>
                  )}
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
