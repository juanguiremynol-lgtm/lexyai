/**
 * Admin Email Notifications Tab
 * Organization-level email notification management
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Mail, 
  Bell, 
  Users, 
  History, 
  Plus, 
  Copy, 
  Trash2,
  RefreshCw,
  ExternalLink,
  Pencil
} from "lucide-react";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { 
  fetchNotificationRules, 
  toggleNotificationRule, 
  deleteNotificationRule,
  duplicateNotificationRule,
  fetchNotificationRecipients,
  toggleNotificationRecipient,
  deleteNotificationRecipient,
  fetchDeliveryLog,
  getDeliveryStats,
} from "@/lib/email-notifications";
import { 
  TRIGGER_EVENTS, 
  RECIPIENT_MODES, 
  SEVERITY_LEVELS,
  EMAIL_STATUS_LABELS,
  type NotificationRule,
  type NotificationRecipient,
  type EmailOutboxEntry,
} from "@/lib/email-notifications/types";
import { formatDateColombia } from "@/lib/constants";
import { Link } from "react-router-dom";
import { NotificationRuleDialog, NotificationRecipientDialog } from "../dialogs";

export function AdminEmailNotificationsTab() {
  const { organization } = useOrganization();
  const queryClient = useQueryClient();
  const orgId = organization?.id;

  // Dialog state
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [recipientDialogOpen, setRecipientDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<NotificationRule | null>(null);
  const [editingRecipient, setEditingRecipient] = useState<NotificationRecipient | null>(null);

  // Fetch notification rules
  const { data: rules = [], isLoading: loadingRules } = useQuery({
    queryKey: ["notification-rules", orgId],
    queryFn: () => orgId ? fetchNotificationRules(orgId) : Promise.resolve([]),
    enabled: !!orgId,
  });

  // Fetch recipients
  const { data: recipients = [], isLoading: loadingRecipients } = useQuery({
    queryKey: ["notification-recipients", orgId],
    queryFn: () => orgId ? fetchNotificationRecipients(orgId) : Promise.resolve([]),
    enabled: !!orgId,
  });

  // Fetch delivery log
  const { data: deliveryLog, isLoading: loadingLog } = useQuery({
    queryKey: ["delivery-log", orgId],
    queryFn: () => orgId ? fetchDeliveryLog(orgId, {}, 1, 20) : Promise.resolve({ data: [], count: 0, page: 1, pageSize: 20 }),
    enabled: !!orgId,
  });

  // Fetch stats
  const { data: stats } = useQuery({
    queryKey: ["delivery-stats", orgId],
    queryFn: () => orgId ? getDeliveryStats(orgId, 30) : Promise.resolve({ total: 0, sent: 0, delivered: 0, failed: 0, opened: 0 }),
    enabled: !!orgId,
  });

  // Toggle rule mutation
  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => toggleNotificationRule(id, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-rules", orgId] });
      toast.success("Regla actualizada");
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  // Duplicate rule mutation
  const duplicateMutation = useMutation({
    mutationFn: duplicateNotificationRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-rules", orgId] });
      toast.success("Regla duplicada");
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  // Delete rule mutation
  const deleteMutation = useMutation({
    mutationFn: deleteNotificationRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-rules", orgId] });
      toast.success("Regla eliminada");
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const getTriggerLabel = (event: string) => {
    return TRIGGER_EVENTS.find(t => t.value === event)?.label || event;
  };

  const getRecipientLabel = (mode: string) => {
    return RECIPIENT_MODES.find(r => r.value === mode)?.label || mode;
  };

  const getSeverityBadge = (severity: string) => {
    const config = SEVERITY_LEVELS.find(s => s.value === severity);
    return (
      <Badge variant="outline" className={config?.color || ""}>
        {config?.label || severity}
      </Badge>
    );
  };

  if (!orgId) {
    return <div className="text-center py-8 text-muted-foreground">Seleccione una organización</div>;
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Reglas Activas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{rules.filter(r => r.enabled).length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Destinatarios</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{recipients.filter(r => r.enabled).length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Enviados (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600">{stats?.sent || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Fallidos (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-destructive">{stats?.failed || 0}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="rules" className="w-full">
        <TabsList>
          <TabsTrigger value="rules">
            <Bell className="h-4 w-4 mr-2" />
            Reglas ({rules.length})
          </TabsTrigger>
          <TabsTrigger value="recipients">
            <Users className="h-4 w-4 mr-2" />
            Destinatarios ({recipients.length})
          </TabsTrigger>
          <TabsTrigger value="log">
            <History className="h-4 w-4 mr-2" />
            Historial
          </TabsTrigger>
        </TabsList>

        {/* RULES TAB */}
        <TabsContent value="rules">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Reglas de Notificación</CardTitle>
                  <CardDescription>Configure cuándo y a quién enviar notificaciones por email</CardDescription>
                </div>
                <Button size="sm" onClick={() => { setEditingRule(null); setRuleDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Nueva Regla
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingRules ? (
                <p className="text-muted-foreground">Cargando...</p>
              ) : rules.length === 0 ? (
                <div className="text-center py-8">
                  <Bell className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <h3 className="mt-4 text-lg font-medium">No hay reglas configuradas</h3>
                  <p className="text-muted-foreground">Cree una regla para comenzar a enviar notificaciones automáticas</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {rules.map((rule) => (
                    <div key={rule.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-4">
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={(checked) => toggleMutation.mutate({ id: rule.id, enabled: checked })}
                        />
                        <div>
                          <p className="font-medium">{rule.name}</p>
                          <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                            <span>{getTriggerLabel(rule.trigger_event)}</span>
                            <span>•</span>
                            {getSeverityBadge(rule.severity_min)}
                            <span>•</span>
                            <span>{getRecipientLabel(rule.recipient_mode)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => { setEditingRule(rule); setRuleDialogOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => duplicateMutation.mutate(rule.id)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(rule.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* RECIPIENTS TAB */}
        <TabsContent value="recipients">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Directorio de Destinatarios</CardTitle>
                  <CardDescription>Emails disponibles para las reglas de notificación</CardDescription>
                </div>
                <Button size="sm" onClick={() => { setEditingRecipient(null); setRecipientDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Agregar Email
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingRecipients ? (
                <p className="text-muted-foreground">Cargando...</p>
              ) : recipients.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <h3 className="mt-4 text-lg font-medium">No hay destinatarios</h3>
                  <p className="text-muted-foreground">Agregue emails para usarlos en las reglas de notificación</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recipients.map((recipient) => (
                    <div key={recipient.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <Switch 
                          checked={recipient.enabled} 
                          onCheckedChange={(checked) => {
                            toggleNotificationRecipient(recipient.id, checked).then(() => {
                              queryClient.invalidateQueries({ queryKey: ["notification-recipients", orgId] });
                            });
                          }}
                        />
                        <div>
                          <p className="font-medium">{recipient.label}</p>
                          <p className="text-sm text-muted-foreground">{recipient.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => { setEditingRecipient(recipient); setRecipientDialogOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => {
                          deleteNotificationRecipient(recipient.id).then(() => {
                            queryClient.invalidateQueries({ queryKey: ["notification-recipients", orgId] });
                            toast.success("Destinatario eliminado");
                          });
                        }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* DELIVERY LOG TAB */}
        <TabsContent value="log">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Historial de Envíos</CardTitle>
                  <CardDescription>Auditoría completa de emails enviados</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["delivery-log", orgId] })}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Actualizar
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingLog ? (
                <p className="text-muted-foreground">Cargando...</p>
              ) : !deliveryLog?.data.length ? (
                <div className="text-center py-8">
                  <History className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <h3 className="mt-4 text-lg font-medium">No hay emails registrados</h3>
                </div>
              ) : (
                <div className="space-y-2">
                  {deliveryLog.data.map((entry: EmailOutboxEntry) => {
                    const statusConfig = EMAIL_STATUS_LABELS[entry.status] || { label: entry.status, color: "bg-muted" };
                    return (
                      <div key={entry.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge className={statusConfig.color}>{statusConfig.label}</Badge>
                            <span className="text-sm font-medium truncate">{entry.subject}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            <span>{entry.to_email}</span>
                            <span className="mx-2">•</span>
                            <span>{formatDateColombia(entry.created_at)}</span>
                            {entry.trigger_reason && (
                              <>
                                <span className="mx-2">•</span>
                                <code className="bg-muted px-1 rounded">{entry.trigger_reason}</code>
                              </>
                            )}
                          </div>
                        </div>
                        {entry.work_item && (
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/work-items/${entry.work_item.id}`}>
                              <ExternalLink className="h-4 w-4" />
                            </Link>
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      {orgId && (
        <>
          <NotificationRuleDialog
            open={ruleDialogOpen}
            onOpenChange={setRuleDialogOpen}
            organizationId={orgId}
            rule={editingRule}
          />
          <NotificationRecipientDialog
            open={recipientDialogOpen}
            onOpenChange={setRecipientDialogOpen}
            organizationId={orgId}
            recipient={editingRecipient}
          />
        </>
      )}
    </div>
  );
}
