import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Check,
  ExternalLink,
  Info,
  RefreshCw,
  Gavel,
  Target,
  Clock,
  Hash,
  FileText,
  Link2,
  RotateCcw,
  X,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateColombia } from "@/lib/constants";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useSnoozeReminder, useDismissReminder } from "@/hooks/use-work-item-reminders";
import { REMINDER_CONFIG, type ReminderType, type WorkItemReminder } from "@/lib/reminders/reminder-types";
import { dismissAlert, dismissAllAlerts } from "@/lib/alerts";

type AlertInstanceAction = {
  label: string;
  action: string;
  params?: { path?: string };
};

interface AlertInstance {
  id: string;
  owner_id: string;
  entity_type: string;
  entity_id: string;
  severity: string;
  status: string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
  actions?: AlertInstanceAction[];
  fired_at: string;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
}

interface ReminderWithWorkItem extends WorkItemReminder {
  work_item?: {
    id: string;
    radicado: string | null;
    title: string | null;
    workflow_type: string;
    authority_name: string | null;
  } | null;
}

// Icon mapping for reminder types
const REMINDER_ICONS: Record<ReminderType, typeof FileText> = {
  ACTA_REPARTO_PENDING: FileText,
  RADICADO_PENDING: Hash,
  EXPEDIENTE_PENDING: Link2,
  AUTO_ADMISORIO_PENDING: Gavel,
};

export default function Alerts() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const snoozeMutation = useSnoozeReminder();
  const dismissMutation = useDismissReminder();

  // Alert instances from 'alert_instances' table (authoritative source)
  const { data: alertInstances, isLoading: isLoadingInstances } = useQuery({
    queryKey: ["alert_instances"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alert_instances")
        .select("*")
        .in("status", ["PENDING", "SENT", "ACKNOWLEDGED"])
        .order("fired_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []).map(d => ({
        ...d,
        actions: Array.isArray(d.actions) ? d.actions as AlertInstanceAction[] : [],
      })) as AlertInstance[];
    },
  });

  // Fetch all active milestone reminders across work items
  const { data: allReminders = [], isLoading: isLoadingReminders } = useQuery({
    queryKey: ["all-active-reminders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_item_reminders")
        .select(`
          *,
          work_item:work_items(id, radicado, title, workflow_type, authority_name)
        `)
        .eq("status", "ACTIVE")
        .order("next_run_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data || []) as ReminderWithWorkItem[];
    },
  });

  const acknowledgeInstance = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("alert_instances")
        .update({ 
          status: "ACKNOWLEDGED",
          acknowledged_at: new Date().toISOString()
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert_instances"] });
      toast.success("Alerta reconocida");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const dismissInstance = useMutation({
    mutationFn: async (id: string) => {
      const result = await dismissAlert(id);
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert_instances"] });
      toast.success("Alerta descartada");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const dismissAllInstances = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      
      const result = await dismissAllAlerts(user.id);
      if (!result.success) throw new Error(result.error);
      return result.count;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["alert_instances"] });
      toast.success(`${count} alerta(s) descartada(s)`);
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case "CRITICAL":
      case "error":
        return <AlertCircle className="h-5 w-5 text-destructive" />;
      case "WARN":
      case "WARNING":
        return <AlertTriangle className="h-5 w-5 text-amber-600" />;
      default:
        return <Info className="h-5 w-5 text-primary" />;
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "CRITICAL":
      case "error":
        return <Badge variant="destructive">Crítica</Badge>;
      case "WARN":
      case "WARNING":
        return (
          <Badge className="bg-amber-500 text-white">
            Advertencia
          </Badge>
        );
      default:
        return <Badge variant="secondary">Info</Badge>;
    }
  };

  const getEntityTypeBadge = (entityType: string) => {
    switch (entityType) {
      case "CGP_FILING":
        return <Badge variant="outline"><Gavel className="h-3 w-3 mr-1" />CGP</Badge>;
      case "CGP_CASE":
        return <Badge variant="outline"><Gavel className="h-3 w-3 mr-1" />Proceso</Badge>;
      case "PETICION":
        return <Badge variant="outline">Petición</Badge>;
      case "TUTELA":
        return <Badge variant="outline">Tutela</Badge>;
      case "ADMIN_PROCESS":
        return <Badge variant="outline">Admin</Badge>;
      case "GOV_PROCEDURE":
        return <Badge variant="outline">Trámite</Badge>;
      case "PENAL_906":
        return <Badge variant="outline">Penal</Badge>;
      case "LABORAL":
        return <Badge variant="outline">Laboral</Badge>;
      case "CPACA":
        return <Badge variant="outline">CPACA</Badge>;
      default:
        return <Badge variant="outline">{entityType}</Badge>;
    }
  };

  const getWorkflowBadge = (workflowType: string) => {
    const colors: Record<string, string> = {
      CGP: "bg-emerald-100 text-emerald-700 border-emerald-300",
      CPACA: "bg-indigo-100 text-indigo-700 border-indigo-300",
      TUTELA: "bg-purple-100 text-purple-700 border-purple-300",
      LABORAL: "bg-blue-100 text-blue-700 border-blue-300",
    };
    return (
      <Badge variant="outline" className={colors[workflowType] || ""}>
        {workflowType}
      </Badge>
    );
  };

  const handleInstanceAction = (action: AlertInstanceAction) => {
    if (action.action === "navigate" && action.params?.path) {
      navigate(action.params.path);
    }
  };

  const handleSnooze = (reminderId: string) => {
    snoozeMutation.mutate({ reminderId, snoozeDays: 3 });
  };

  const handleDismiss = (reminderId: string) => {
    dismissMutation.mutate(reminderId);
  };

  // Categorize reminders
  const now = new Date();
  const dueReminders = allReminders.filter(r => new Date(r.next_run_at) <= now);
  const upcomingReminders = allReminders.filter(r => new Date(r.next_run_at) > now);

  // Counts based on modern alert_instances only
  const pendingInstanceCount = alertInstances?.filter(a => a.status === "PENDING").length || 0;
  const criticalCount = alertInstances?.filter(a => a.severity === "CRITICAL").length || 0;
  const processUpdateCount = alertInstances?.filter(a => 
    a.entity_type === "CGP_FILING" || a.entity_type === "CGP_CASE"
  ).length || 0;
  const milestoneReminderCount = dueReminders.length;

  const isLoading = isLoadingInstances || isLoadingReminders;
  const totalAlerts = (alertInstances?.length || 0) + allReminders.length;

  // Render a reminder card
  const renderReminderCard = (reminder: ReminderWithWorkItem) => {
    const config = REMINDER_CONFIG[reminder.reminder_type];
    const Icon = REMINDER_ICONS[reminder.reminder_type];
    const isDue = new Date(reminder.next_run_at) <= now;
    const workItem = reminder.work_item;
    
    return (
      <div
        key={reminder.id}
        className={cn(
          "flex items-start gap-4 p-4 rounded-lg border transition-colors",
          isDue ? "bg-amber-50/50 border-amber-200 dark:bg-amber-950/10" : "bg-background"
        )}
      >
        <div className={cn(
          "p-2 rounded-full shrink-0",
          isDue ? "bg-amber-100 dark:bg-amber-900/30" : "bg-muted"
        )}>
          <Icon className={cn(
            "h-4 w-4",
            isDue ? "text-amber-600" : "text-muted-foreground"
          )} />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {workItem && getWorkflowBadge(workItem.workflow_type)}
            <Badge variant="outline" className="text-xs">
              <Target className="h-3 w-3 mr-1" />
              Hito
            </Badge>
            {isDue && (
              <Badge className="bg-amber-500 text-white text-xs">
                Pendiente
              </Badge>
            )}
          </div>
          
          <p className="text-sm font-medium">{config.label}</p>
          <p className="text-sm text-muted-foreground">{config.message}</p>
          
          {workItem && (
            <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
              {workItem.radicado && (
                <p>Radicado: <code className="bg-muted px-1 rounded">{workItem.radicado}</code></p>
              )}
              {workItem.authority_name && (
                <p>Despacho: {workItem.authority_name}</p>
              )}
            </div>
          )}
          
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {isDue ? (
              <span className="text-amber-600">
                Vence {formatDistanceToNow(new Date(reminder.next_run_at), { addSuffix: true, locale: es })}
              </span>
            ) : (
              <span>
                Próximo: {format(new Date(reminder.next_run_at), "d MMM yyyy", { locale: es })}
              </span>
            )}
            {reminder.trigger_count > 0 && (
              <span className="text-muted-foreground">
                • Recordatorio #{reminder.trigger_count + 1}
              </span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-1 shrink-0">
          {workItem && (
            <Button
              variant="ghost"
              size="sm"
              asChild
              title="Ver asunto"
            >
              <Link to={`/work-items/${workItem.id}?tab=overview`}>
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleSnooze(reminder.id)}
            disabled={snoozeMutation.isPending}
            title="Posponer 3 días hábiles"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleDismiss(reminder.id)}
            disabled={dismissMutation.isPending}
            title="Descartar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold">Alertas</h1>
          <p className="text-muted-foreground">
            {pendingInstanceCount + milestoneReminderCount} pendientes • {criticalCount} críticas • {milestoneReminderCount} hitos
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["alert_instances"] });
              queryClient.invalidateQueries({ queryKey: ["all-active-reminders"] });
              toast.success("Alertas actualizadas");
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Actualizar
          </Button>
          {pendingInstanceCount > 0 && (
            <Button
              variant="outline"
              onClick={() => dismissAllInstances.mutate()}
              disabled={dismissAllInstances.isPending}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Descartar todas
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sin Leer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{pendingInstanceCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Hitos Pendientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-amber-600">{milestoneReminderCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Críticas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-destructive">{criticalCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totalAlerts}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="milestones" className="w-full">
        <TabsList className="flex-wrap">
          <TabsTrigger value="milestones">
            <Target className="h-4 w-4 mr-1" />
            Hitos ({allReminders.length})
          </TabsTrigger>
          <TabsTrigger value="process_updates">
            Actualizaciones ({processUpdateCount})
          </TabsTrigger>
          <TabsTrigger value="all_instances">
            Sistema ({alertInstances?.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="milestones">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Recordatorios de Hitos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Cargando...
                </div>
              ) : allReminders.length === 0 ? (
                <div className="text-center py-12">
                  <Target className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <h3 className="mt-4 text-lg font-medium">No hay recordatorios de hitos</h3>
                  <p className="text-muted-foreground">
                    Los recordatorios se crean automáticamente al registrar nuevos procesos judiciales
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Due reminders first */}
                  {dueReminders.length > 0 && (
                    <>
                      <h4 className="text-sm font-medium text-amber-600 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" />
                        Requieren acción ({dueReminders.length})
                      </h4>
                      <div className="space-y-3">
                        {dueReminders.map(renderReminderCard)}
                      </div>
                    </>
                  )}
                  
                  {/* Upcoming reminders */}
                  {upcomingReminders.length > 0 && (
                    <>
                      <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2 mt-6">
                        <Clock className="h-4 w-4" />
                        Próximos ({upcomingReminders.length})
                      </h4>
                      <div className="space-y-3">
                        {upcomingReminders.map(renderReminderCard)}
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="process_updates">
          <Card>
            <CardHeader>
              <CardTitle>Actualizaciones de Procesos</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Cargando...
                </div>
              ) : alertInstances?.filter(a => a.entity_type === "CGP_FILING" || a.entity_type === "CGP_CASE").length === 0 ? (
                <div className="text-center py-12">
                  <Bell className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <h3 className="mt-4 text-lg font-medium">No hay actualizaciones de procesos</h3>
                  <p className="text-muted-foreground">
                    Las actualizaciones se detectan automáticamente al consultar fuentes judiciales
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {alertInstances
                    ?.filter(a => a.entity_type === "CGP_FILING" || a.entity_type === "CGP_CASE")
                    .map((instance) => (
                      <div
                        key={instance.id}
                        className={`flex items-start gap-4 p-4 rounded-lg border transition-colors ${
                          instance.status === "PENDING"
                            ? "bg-muted/50 border-primary/20"
                            : "bg-background"
                        }`}
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          {getSeverityIcon(instance.severity)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {getEntityTypeBadge(instance.entity_type)}
                            {getSeverityBadge(instance.severity)}
                            {instance.status === "PENDING" && (
                              <Badge variant="outline" className="text-xs">
                                Nueva
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm font-medium">{instance.title}</p>
                          <p className="text-sm text-muted-foreground">{instance.message}</p>
                          {instance.payload?.radicado && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Radicado: <code className="bg-muted px-1 rounded">{String(instance.payload.radicado)}</code>
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDateColombia(instance.fired_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {instance.status === "PENDING" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => acknowledgeInstance.mutate(instance.id)}
                              title="Reconocer"
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                          {instance.actions?.map((action, idx) => (
                            <Button 
                              key={idx}
                              variant="ghost" 
                              size="sm" 
                              onClick={() => handleInstanceAction(action)}
                              title="Ver"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          ))}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => dismissInstance.mutate(instance.id)}
                            disabled={dismissInstance.isPending}
                            title="Descartar"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="all_instances">
          <Card>
            <CardHeader>
              <CardTitle>Todas las Alertas del Sistema</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Cargando...
                </div>
              ) : alertInstances?.length === 0 ? (
                <div className="text-center py-12">
                  <Bell className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <h3 className="mt-4 text-lg font-medium">No hay alertas del sistema</h3>
                </div>
              ) : (
                <div className="space-y-3">
                  {alertInstances?.map((instance) => (
                    <div
                      key={instance.id}
                      className={`flex items-start gap-4 p-4 rounded-lg border transition-colors ${
                        instance.status === "PENDING"
                          ? "bg-muted/50 border-primary/20"
                          : "bg-background"
                      }`}
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        {getSeverityIcon(instance.severity)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {getEntityTypeBadge(instance.entity_type)}
                          {getSeverityBadge(instance.severity)}
                        </div>
                        <p className="text-sm font-medium">{instance.title}</p>
                        <p className="text-sm text-muted-foreground">{instance.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDateColombia(instance.fired_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {instance.status === "PENDING" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => acknowledgeInstance.mutate(instance.id)}
                            title="Reconocer"
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => dismissInstance.mutate(instance.id)}
                          disabled={dismissInstance.isPending}
                          title="Descartar"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
