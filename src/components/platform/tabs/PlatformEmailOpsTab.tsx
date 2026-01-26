/**
 * Platform Email Ops Tab - Enhanced Global Email Operations
 * 
 * Provides system-wide email monitoring, governance controls, and incident triage
 * for platform admins.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { 
  Mail, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  Building2,
  Power,
  PowerOff,
  RefreshCw,
  StopCircle,
  RotateCcw,
  TrendingUp,
  AlertCircle,
  Activity,
  Shield,
  Eye,
  Ban,
  History
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchPlatformSettings,
  toggleGlobalEmailPause,
  suspendOrgEmail,
  unsuspendOrgEmail,
  fetchGlobalEmailStats,
  fetchTopTenantsByVolume,
  fetchFailureGroups,
  forceStopRetries,
  requeueEmail,
  fetchGlobalEmailLog,
  fetchTenantEmailProfile,
  fetchPlatformEmailActions,
  type GlobalEmailLogFilters,
  type PlatformSettings,
  type TenantEmailProfile,
} from "@/lib/platform/email-operations-service";

function maskEmail(email: string): string {
  if (!email) return '***';
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***@***';
  const maskedLocal = local.length > 2 ? local[0] + '***' + local[local.length - 1] : '***';
  return `${maskedLocal}@${domain}`;
}

export function PlatformEmailOpsTab() {
  const queryClient = useQueryClient();
  const [selectedTab, setSelectedTab] = useState("overview");
  const [logFilters, setLogFilters] = useState<GlobalEmailLogFilters>({});
  const [logPage, setLogPage] = useState(1);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [suspendOrgId, setSuspendOrgId] = useState<string | null>(null);
  const [suspendReason, setSuspendReason] = useState("");

  // Fetch platform settings
  const { data: settings, isLoading: loadingSettings } = useQuery({
    queryKey: ["platform-settings"],
    queryFn: fetchPlatformSettings,
  });

  // Fetch global stats
  const { data: stats24h } = useQuery({
    queryKey: ["global-email-stats", 1],
    queryFn: () => fetchGlobalEmailStats(1),
  });

  const { data: stats7d } = useQuery({
    queryKey: ["global-email-stats", 7],
    queryFn: () => fetchGlobalEmailStats(7),
  });

  // Fetch top tenants
  const { data: topTenants } = useQuery({
    queryKey: ["top-tenants-volume"],
    queryFn: () => fetchTopTenantsByVolume(7, 10),
  });

  // Fetch failure groups
  const { data: failureGroups } = useQuery({
    queryKey: ["failure-groups"],
    queryFn: () => fetchFailureGroups(7),
  });

  // Fetch organizations list
  const { data: organizations } = useQuery({
    queryKey: ["platform-organizations-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("organizations")
        .select("id, name, email_suspended")
        .order("name");
      return data || [];
    },
  });

  // Fetch global email log
  const { data: emailLog, isLoading: loadingLog } = useQuery({
    queryKey: ["global-email-log", logFilters, logPage],
    queryFn: () => fetchGlobalEmailLog(logFilters, logPage, 50),
  });

  // Fetch tenant profile when selected
  const { data: tenantProfile } = useQuery({
    queryKey: ["tenant-email-profile", selectedOrgId],
    queryFn: () => selectedOrgId ? fetchTenantEmailProfile(selectedOrgId) : null,
    enabled: !!selectedOrgId,
  });

  // Fetch platform actions log
  const { data: actionsLog } = useQuery({
    queryKey: ["platform-email-actions"],
    queryFn: () => fetchPlatformEmailActions(50),
  });

  // Mutations
  const togglePauseMutation = useMutation({
    mutationFn: ({ pause, reason }: { pause: boolean; reason?: string }) =>
      toggleGlobalEmailPause(pause, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-settings"] });
      toast.success(settings?.email_enabled ? "Emails pausados globalmente" : "Emails reactivados");
      setPauseDialogOpen(false);
      setPauseReason("");
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const suspendOrgMutation = useMutation({
    mutationFn: ({ orgId, reason }: { orgId: string; reason?: string }) =>
      suspendOrgEmail(orgId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-organizations-list"] });
      queryClient.invalidateQueries({ queryKey: ["tenant-email-profile"] });
      toast.success("Organización suspendida");
      setSuspendDialogOpen(false);
      setSuspendReason("");
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const unsuspendOrgMutation = useMutation({
    mutationFn: unsuspendOrgEmail,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-organizations-list"] });
      queryClient.invalidateQueries({ queryKey: ["tenant-email-profile"] });
      toast.success("Suspensión removida");
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const forceStopMutation = useMutation({
    mutationFn: forceStopRetries,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["global-email-log"] });
      toast.success("Reintentos detenidos");
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const requeueMutation = useMutation({
    mutationFn: requeueEmail,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["global-email-log"] });
      toast.success("Email reencolado");
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const getStatusBadge = (status: string, isPermanent: boolean) => {
    if (isPermanent) {
      return <Badge variant="destructive">Falla Permanente</Badge>;
    }
    switch (status) {
      case "sent":
      case "SENT":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Enviado</Badge>;
      case "pending":
      case "QUEUED":
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">En Cola</Badge>;
      case "failed":
      case "FAILED_TEMP":
        return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">Error Temporal</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (loadingSettings) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando configuración...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Global Kill Switch Alert */}
      {settings && !settings.email_enabled && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <PowerOff className="h-6 w-6 text-destructive" />
                <div>
                  <p className="font-medium text-destructive">Envío de emails PAUSADO globalmente</p>
                  <p className="text-sm text-muted-foreground">
                    {settings.email_pause_reason || 'Pausado por administrador de plataforma'}
                    {settings.email_paused_at && (
                      <span> • {format(new Date(settings.email_paused_at), "dd MMM HH:mm", { locale: es })}</span>
                    )}
                  </p>
                </div>
              </div>
              <Button 
                variant="outline" 
                onClick={() => togglePauseMutation.mutate({ pause: false })}
                disabled={togglePauseMutation.isPending}
              >
                <Power className="h-4 w-4 mr-2" />
                Reactivar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="overview" className="gap-2">
            <TrendingUp className="h-4 w-4" />
            Resumen
          </TabsTrigger>
          <TabsTrigger value="log" className="gap-2">
            <Mail className="h-4 w-4" />
            Cola Global
          </TabsTrigger>
          <TabsTrigger value="failures" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            Fallas
          </TabsTrigger>
          <TabsTrigger value="tenants" className="gap-2">
            <Building2 className="h-4 w-4" />
            Tenants
          </TabsTrigger>
          <TabsTrigger value="governance" className="gap-2">
            <Shield className="h-4 w-4" />
            Controles
          </TabsTrigger>
          <TabsTrigger value="actions" className="gap-2">
            <History className="h-4 w-4" />
            Acciones
          </TabsTrigger>
        </TabsList>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview" className="space-y-6">
          {/* 24h Stats */}
          <div>
            <h3 className="text-lg font-medium mb-4">Últimas 24 horas</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold">{stats24h?.total || 0}</p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-blue-600">{stats24h?.queued || 0}</p>
                  <p className="text-xs text-muted-foreground">En Cola</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{stats24h?.sent || 0}</p>
                  <p className="text-xs text-muted-foreground">Enviados</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-amber-600">{stats24h?.failedTemp || 0}</p>
                  <p className="text-xs text-muted-foreground">Error Temp</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-destructive">{stats24h?.failedPerm || 0}</p>
                  <p className="text-xs text-muted-foreground">Error Perm</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-purple-600">{stats24h?.retryVolume || 0}</p>
                  <p className="text-xs text-muted-foreground">Reintentos</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold">
                    {stats24h?.avgSendLatencyMs ? `${Math.round(stats24h.avgSendLatencyMs / 1000)}s` : '-'}
                  </p>
                  <p className="text-xs text-muted-foreground">Latencia Med.</p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Top Tenants */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Top Tenants por Volumen (7d)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organización</TableHead>
                    <TableHead className="text-right">Emails</TableHead>
                    <TableHead className="text-right">Fallidos</TableHead>
                    <TableHead className="text-right">Tasa Error</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topTenants?.map((tenant) => (
                    <TableRow key={tenant.organization_id}>
                      <TableCell className="font-medium">{tenant.organization_name}</TableCell>
                      <TableCell className="text-right">{tenant.email_count}</TableCell>
                      <TableCell className="text-right text-destructive">{tenant.failed_count}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={tenant.failure_rate > 10 ? "destructive" : "outline"}>
                          {tenant.failure_rate.toFixed(1)}%
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => {
                            setSelectedOrgId(tenant.organization_id);
                            setSelectedTab("tenants");
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* GLOBAL LOG TAB */}
        <TabsContent value="log" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Cola de Emails Global</CardTitle>
              <CardDescription>Auditoría de todos los emails del sistema</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Filters */}
              <div className="flex flex-wrap gap-4">
                <Select 
                  value={logFilters.status || "all"} 
                  onValueChange={(v) => setLogFilters({ ...logFilters, status: v === "all" ? undefined : v })}
                >
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Estado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="pending">En Cola</SelectItem>
                    <SelectItem value="sent">Enviados</SelectItem>
                    <SelectItem value="failed">Fallidos</SelectItem>
                  </SelectContent>
                </Select>
                <Select 
                  value={logFilters.organizationId || "all"} 
                  onValueChange={(v) => setLogFilters({ ...logFilters, organizationId: v === "all" ? undefined : v })}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Organización" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {organizations?.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name} {org.email_suspended && "🚫"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button 
                  variant={logFilters.failuresOnly ? "default" : "outline"} 
                  size="sm"
                  onClick={() => setLogFilters({ ...logFilters, failuresOnly: !logFilters.failuresOnly })}
                >
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Solo Fallas
                </Button>
                <Button 
                  variant={logFilters.stuckRetries ? "default" : "outline"} 
                  size="sm"
                  onClick={() => setLogFilters({ ...logFilters, stuckRetries: !logFilters.stuckRetries })}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reintentos Atascados
                </Button>
              </div>

              {/* Table */}
              {loadingLog ? (
                <p className="text-muted-foreground">Cargando...</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Organización</TableHead>
                        <TableHead>Destinatario</TableHead>
                        <TableHead>Asunto</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Int.</TableHead>
                        <TableHead>Razón</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {emailLog?.data.map((email: any) => (
                        <TableRow key={email.id}>
                          <TableCell className="whitespace-nowrap text-sm">
                            {format(new Date(email.created_at), "dd/MM HH:mm", { locale: es })}
                          </TableCell>
                          <TableCell className="text-sm">
                            {email.organizations?.name || '-'}
                          </TableCell>
                          <TableCell className="text-sm font-mono">
                            {maskEmail(email.to_email)}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-sm">
                            {email.subject}
                          </TableCell>
                          <TableCell>
                            {getStatusBadge(email.status, email.failed_permanent)}
                          </TableCell>
                          <TableCell className="text-center">
                            {email.attempts || 0}
                          </TableCell>
                          <TableCell>
                            {email.trigger_reason && (
                              <code className="text-xs bg-muted px-1 rounded">{email.trigger_reason}</code>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {!email.failed_permanent && email.status === "failed" && (
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => forceStopMutation.mutate(email.id)}
                                  title="Detener reintentos"
                                >
                                  <StopCircle className="h-4 w-4 text-destructive" />
                                </Button>
                              )}
                              {email.failed_permanent && (
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => requeueMutation.mutate(email.id)}
                                  title="Reencolar"
                                >
                                  <RefreshCw className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Pagination */}
              {emailLog && emailLog.count > 50 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Mostrando {((logPage - 1) * 50) + 1}-{Math.min(logPage * 50, emailLog.count)} de {emailLog.count}
                  </p>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      disabled={logPage === 1}
                      onClick={() => setLogPage(logPage - 1)}
                    >
                      Anterior
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      disabled={logPage * 50 >= emailLog.count}
                      onClick={() => setLogPage(logPage + 1)}
                    >
                      Siguiente
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* FAILURES TAB */}
        <TabsContent value="failures" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Análisis de Fallas (7d)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {failureGroups?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="mx-auto h-12 w-12 text-green-500 mb-4" />
                  <p>No hay fallas recientes</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {failureGroups?.map((group, idx) => (
                    <Card key={idx}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium text-destructive">{group.error_type}</p>
                            <p className="text-2xl font-bold">{group.count} emails</p>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {group.organizations.slice(0, 3).map((org) => (
                                <Badge key={org.id} variant="outline">{org.name}</Badge>
                              ))}
                              {group.organizations.length > 3 && (
                                <Badge variant="secondary">+{group.organizations.length - 3} más</Badge>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {group.domains.slice(0, 5).map((domain) => (
                                <code key={domain} className="text-xs bg-muted px-1 rounded">@{domain}</code>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TENANTS TAB */}
        <TabsContent value="tenants" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Org Selector */}
            <Card>
              <CardHeader>
                <CardTitle>Organizaciones</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {organizations?.map((org) => (
                    <div 
                      key={org.id}
                      className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                        selectedOrgId === org.id ? 'bg-primary/10 border-primary' : 'hover:bg-muted'
                      }`}
                      onClick={() => setSelectedOrgId(org.id)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{org.name}</span>
                        {org.email_suspended && (
                          <Badge variant="destructive">Suspendido</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Tenant Profile */}
            <div className="lg:col-span-2">
              {selectedOrgId && tenantProfile ? (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle>{tenantProfile.organization_name}</CardTitle>
                        <CardDescription>Perfil de email (30 días)</CardDescription>
                      </div>
                      {tenantProfile.email_suspended ? (
                        <Button 
                          variant="outline"
                          onClick={() => unsuspendOrgMutation.mutate(selectedOrgId)}
                        >
                          <Power className="h-4 w-4 mr-2" />
                          Reactivar
                        </Button>
                      ) : (
                        <Button 
                          variant="destructive"
                          onClick={() => {
                            setSuspendOrgId(selectedOrgId);
                            setSuspendDialogOpen(true);
                          }}
                        >
                          <Ban className="h-4 w-4 mr-2" />
                          Suspender
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {tenantProfile.email_suspended && (
                      <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
                        <p className="text-destructive font-medium">Email suspendido</p>
                        <p className="text-sm text-muted-foreground">{tenantProfile.email_suspend_reason}</p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="text-center">
                        <p className="text-2xl font-bold">{tenantProfile.total_emails}</p>
                        <p className="text-xs text-muted-foreground">Total</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-green-600">{tenantProfile.sent_count}</p>
                        <p className="text-xs text-muted-foreground">Enviados</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-destructive">{tenantProfile.failed_count}</p>
                        <p className="text-xs text-muted-foreground">Fallidos</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold">{tenantProfile.failure_rate.toFixed(1)}%</p>
                        <p className="text-xs text-muted-foreground">Tasa Error</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm font-medium mb-2">Configuración</p>
                        <div className="space-y-1 text-sm">
                          <p><span className="text-muted-foreground">Reglas activas:</span> {tenantProfile.active_rules_count}</p>
                          <p><span className="text-muted-foreground">Destinatarios:</span> {tenantProfile.recipients_count}</p>
                          <p><span className="text-muted-foreground">En cola:</span> {tenantProfile.queue_depth}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-medium mb-2">Top Triggers</p>
                        <div className="space-y-1">
                          {tenantProfile.top_triggers.map((t) => (
                            <div key={t.trigger} className="flex justify-between text-sm">
                              <code className="text-xs">{t.trigger}</code>
                              <span className="text-muted-foreground">{t.count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    <Building2 className="mx-auto h-12 w-12 mb-4 opacity-50" />
                    <p>Seleccione una organización para ver su perfil</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* GOVERNANCE TAB */}
        <TabsContent value="governance" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Global Kill Switch */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Power className="h-5 w-5" />
                  Kill Switch Global
                </CardTitle>
                <CardDescription>
                  Detener todo el envío de emails en la plataforma
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">Envío de Emails</p>
                    <p className="text-sm text-muted-foreground">
                      {settings?.email_enabled ? 'Activo' : 'Pausado'}
                    </p>
                  </div>
                  <Switch
                    checked={settings?.email_enabled || false}
                    onCheckedChange={(checked) => {
                      if (!checked) {
                        setPauseDialogOpen(true);
                      } else {
                        togglePauseMutation.mutate({ pause: false });
                      }
                    }}
                  />
                </div>

                {settings && !settings.email_enabled && (
                  <div className="text-sm text-muted-foreground">
                    <p>Pausado: {settings.email_paused_at && format(new Date(settings.email_paused_at), "dd MMM yyyy HH:mm", { locale: es })}</p>
                    <p>Razón: {settings.email_pause_reason || '-'}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Rate Limits */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Límites de Tasa
                </CardTitle>
                <CardDescription>
                  Configuración de rate limiting global
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Max/Org/Hora</Label>
                    <p className="text-lg font-medium">{settings?.max_emails_per_org_per_hour || 500}</p>
                  </div>
                  <div>
                    <Label className="text-xs">Max/Org/Día</Label>
                    <p className="text-lg font-medium">{settings?.max_emails_per_org_per_day || 5000}</p>
                  </div>
                  <div>
                    <Label className="text-xs">Max Global/Min</Label>
                    <p className="text-lg font-medium">{settings?.max_global_emails_per_minute || 100}</p>
                  </div>
                  <div>
                    <Label className="text-xs">Max Reintentos</Label>
                    <p className="text-lg font-medium">{settings?.max_retry_attempts || 5}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t">
                  <div>
                    <p className="font-medium">Detección de Picos</p>
                    <p className="text-sm text-muted-foreground">Multiplicador: {settings?.spike_threshold_multiplier || 2}x</p>
                  </div>
                  <Badge variant={settings?.spike_detection_enabled ? "default" : "outline"}>
                    {settings?.spike_detection_enabled ? "Activo" : "Inactivo"}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Suspended Orgs */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Ban className="h-5 w-5 text-destructive" />
                  Organizaciones Suspendidas
                </CardTitle>
              </CardHeader>
              <CardContent>
                {organizations?.filter((o) => o.email_suspended).length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">
                    No hay organizaciones suspendidas
                  </p>
                ) : (
                  <div className="space-y-2">
                    {organizations?.filter((o) => o.email_suspended).map((org) => (
                      <div key={org.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <p className="font-medium">{org.name}</p>
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => unsuspendOrgMutation.mutate(org.id)}
                        >
                          Reactivar
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ACTIONS LOG TAB */}
        <TabsContent value="actions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Historial de Acciones de Plataforma
              </CardTitle>
            </CardHeader>
            <CardContent>
              {actionsLog?.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No hay acciones registradas
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Acción</TableHead>
                      <TableHead>Organización</TableHead>
                      <TableHead>Razón</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {actionsLog?.map((action: any) => (
                      <TableRow key={action.id}>
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(action.created_at), "dd MMM HH:mm", { locale: es })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{action.action_type}</Badge>
                        </TableCell>
                        <TableCell>
                          {action.organizations?.name || '-'}
                        </TableCell>
                        <TableCell className="max-w-[300px] truncate">
                          {action.reason || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Pause Dialog */}
      <Dialog open={pauseDialogOpen} onOpenChange={setPauseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Pausar Envío de Emails
            </DialogTitle>
            <DialogDescription>
              Esta acción detendrá TODOS los emails de la plataforma. Use con precaución.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Razón (opcional)</Label>
              <Textarea
                value={pauseReason}
                onChange={(e) => setPauseReason(e.target.value)}
                placeholder="Ej: Mantenimiento programado, investigación de incidente..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPauseDialogOpen(false)}>
              Cancelar
            </Button>
            <Button 
              variant="destructive"
              onClick={() => togglePauseMutation.mutate({ pause: true, reason: pauseReason })}
              disabled={togglePauseMutation.isPending}
            >
              <PowerOff className="h-4 w-4 mr-2" />
              Pausar Emails
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspend Org Dialog */}
      <Dialog open={suspendDialogOpen} onOpenChange={setSuspendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Ban className="h-5 w-5" />
              Suspender Email de Organización
            </DialogTitle>
            <DialogDescription>
              Los emails de esta organización serán bloqueados hasta que se reactive.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Razón</Label>
              <Textarea
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="Ej: Alto volumen de rebotes, abuso detectado..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendDialogOpen(false)}>
              Cancelar
            </Button>
            <Button 
              variant="destructive"
              onClick={() => {
                if (suspendOrgId) {
                  suspendOrgMutation.mutate({ orgId: suspendOrgId, reason: suspendReason });
                }
              }}
              disabled={suspendOrgMutation.isPending}
            >
              <Ban className="h-4 w-4 mr-2" />
              Suspender
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
