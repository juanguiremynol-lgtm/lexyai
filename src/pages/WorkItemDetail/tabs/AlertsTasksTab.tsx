/**
 * Alerts & Tasks Tab - Shows milestone reminders, alerts, and user-created tasks
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ensureValidSession } from "@/lib/supabase-query-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Bell, 
  CheckSquare,
  Calendar,
  AlertTriangle,
  Info,
  AlertCircle,
  Clock,
  Target,
  Hash,
  FileText,
  Link2,
  Gavel,
  RotateCcw,
  X,
  Plus,
} from "lucide-react";
import { format, formatDistanceToNow, isPast } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

import type { WorkItem } from "@/types/work-item";
import { 
  useDueReminders, 
  useActiveReminders,
  useSnoozeReminder, 
  useDismissReminder 
} from "@/hooks/use-work-item-reminders";
import { REMINDER_CONFIG, type ReminderType, type WorkItemReminder } from "@/lib/reminders/reminder-types";
import { useWorkItemTasks } from "@/hooks/use-work-item-tasks";
import { TaskCard } from "@/components/work-items/tasks/TaskCard";
import { CreateTaskDialog } from "@/components/work-items/tasks/CreateTaskDialog";

interface AlertsTasksTabProps {
  workItem: WorkItem & { _source?: string };
}

interface Alert {
  id: string;
  title: string;
  message: string | null;
  severity: "info" | "warning" | "error";
  is_read: boolean;
  created_at: string;
  alert_type?: string;
  alert_source?: string;
}

// Icon mapping for reminder types
const REMINDER_ICONS: Record<ReminderType, typeof FileText> = {
  ACTA_REPARTO_PENDING: FileText,
  RADICADO_PENDING: Hash,
  EXPEDIENTE_PENDING: Link2,
  AUTO_ADMISORIO_PENDING: Gavel,
};

export function AlertsTasksTab({ workItem }: AlertsTasksTabProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Fetch all active reminders
  const { data: activeReminders = [], isLoading: remindersLoading } = useActiveReminders({ 
    workItemId: workItem.id 
  });
  const snoozeMutation = useSnoozeReminder();
  const dismissMutation = useDismissReminder();

  // Fetch new work_item_tasks
  const { data: tasks = [], isLoading: tasksLoading } = useWorkItemTasks(workItem.id);

  // Fetch alerts
  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ["work-item-alerts", workItem.id],
    queryFn: async () => {
      await ensureValidSession();
      const { data, error } = await supabase
        .from("alert_instances")
        .select("*")
        .eq("entity_id", workItem.id)
        .eq("entity_type", "work_item")
        .not("status", "eq", "RESOLVED")
        .order("fired_at", { ascending: false })
        .limit(20);
      
      if (error) throw error;
      return (data || []).map((a: any) => ({
        id: a.id,
        title: a.title || "Alerta",
        message: a.message,
        severity: a.severity === "CRITICAL" ? "error" : a.severity === "WARNING" ? "warning" : "info",
        is_read: !!a.read_at || !!a.seen_at,
        created_at: a.fired_at || a.created_at,
        alert_type: a.alert_type,
        alert_source: a.alert_source,
      })) as Alert[];
    },
    enabled: !!workItem.id,
  });

  const isLoading = tasksLoading || alertsLoading || remindersLoading;

  const pendingTasks = tasks.filter((t) => t.status === "PENDIENTE");
  const completedTasks = tasks.filter((t) => t.status === "COMPLETADA");
  const unreadAlerts = alerts?.filter((a) => !a.is_read) || [];
  
  const now = new Date();
  const dueReminders = activeReminders.filter(r => new Date(r.next_run_at) <= now);
  const upcomingReminders = activeReminders.filter(r => new Date(r.next_run_at) > now);

  const getSeverityConfig = (severity: string) => {
    switch (severity) {
      case "error":
        return { icon: AlertCircle, color: "text-destructive", bg: "bg-destructive/10" };
      case "warning":
        return { icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-500/10" };
      default:
        return { icon: Info, color: "text-primary", bg: "bg-primary/10" };
    }
  };

  const handleSnooze = (reminderId: string) => {
    snoozeMutation.mutate({ reminderId, snoozeDays: 3 });
  };

  const handleDismiss = (reminderId: string) => {
    dismissMutation.mutate(reminderId);
  };

  const renderReminderCard = (reminder: WorkItemReminder, isDue: boolean) => {
    const config = REMINDER_CONFIG[reminder.reminder_type];
    const Icon = REMINDER_ICONS[reminder.reminder_type];
    const triggerCount = reminder.trigger_count;
    
    return (
      <Card 
        key={reminder.id} 
        className={cn(
          "transition-colors border-l-4",
          isDue ? "border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/10" : "border-l-muted"
        )}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className={cn(
              "p-2 rounded-full",
              isDue ? "bg-amber-100 dark:bg-amber-900/30" : "bg-muted"
            )}>
              <Icon className={cn(
                "h-4 w-4",
                isDue ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
              )} />
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-sm">{config.label}</span>
                {isDue && (
                  <Badge variant="outline" className="text-xs bg-amber-100 text-amber-700 border-amber-300">
                    Pendiente
                  </Badge>
                )}
                {triggerCount > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    Recordatorio #{triggerCount + 1}
                  </Badge>
                )}
              </div>
              
              <p className="text-sm text-muted-foreground">{config.message}</p>
              
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
              </div>
            </div>
            
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSnooze(reminder.id)}
                disabled={snoozeMutation.isPending}
                title="Recordarme en 3 días hábiles"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDismiss(reminder.id)}
                disabled={dismissMutation.isPending}
                title="Descartar recordatorio"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {isDue && (
            <div className="mt-3 pl-11">
              <Button 
                variant="outline" 
                size="sm"
                className="text-xs"
                onClick={() => {
                  const tabsList = document.querySelector('[role="tablist"]');
                  const overviewTab = tabsList?.querySelector('[value="overview"]') as HTMLButtonElement;
                  overviewTab?.click();
                }}
              >
                <Target className="h-3 w-3 mr-1" />
                {config.ctaLabel}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const hasTasks = tasks.length > 0;
  const hasAlerts = (alerts?.length || 0) > 0;
  const hasReminders = activeReminders.length > 0;
  const isEmpty = !hasTasks && !hasAlerts && !hasReminders;

  return (
    <div className="space-y-6">
      {/* Milestone Reminders Section */}
      {hasReminders && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Recordatorios de Hitos
                {dueReminders.length > 0 && (
                  <Badge className="ml-2 bg-amber-500">
                    {dueReminders.length} pendientes
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
          </Card>
          
          {dueReminders.length > 0 && (
            <div className="space-y-2">
              {dueReminders.map(reminder => renderReminderCard(reminder, true))}
            </div>
          )}
          
          {upcomingReminders.length > 0 && (
            <>
              {dueReminders.length > 0 && (
                <p className="text-sm text-muted-foreground pt-2">
                  Próximos ({upcomingReminders.length})
                </p>
              )}
              <div className="space-y-2">
                {upcomingReminders.map(reminder => renderReminderCard(reminder, false))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Alerts Section */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Alertas
              {unreadAlerts.length > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {unreadAlerts.length} sin leer
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
        </Card>

        {!hasAlerts ? (
          <Card>
            <CardContent className="py-6">
              <div className="text-center">
                <Bell className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground text-sm">Sin alertas pendientes</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {alerts?.map((alert) => {
              const config = getSeverityConfig(alert.severity);
              const Icon = config.icon;

              return (
                <Card key={alert.id} className={cn("transition-colors", config.bg)}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Icon className={cn("h-5 w-5 mt-0.5", config.color)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">{alert.title}</p>
                          <div className="flex items-center gap-1">
                            {alert.alert_type === 'LEXY_DAILY' && (
                              <Badge variant="outline" className="text-[10px]">📩 Lexy</Badge>
                            )}
                            {!alert.is_read && (
                              <Badge variant="secondary" className="text-xs">Nuevo</Badge>
                            )}
                          </div>
                        </div>
                        {alert.message && (
                          <p className="text-sm text-muted-foreground mt-1">{alert.message}</p>
                        )}
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                          <span>{formatDistanceToNow(new Date(alert.created_at), { addSuffix: true, locale: es })}</span>
                          {alert.alert_source && (
                            <Badge variant="outline" className="text-[10px]">{alert.alert_source}</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Tasks Section - NEW */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <CheckSquare className="h-5 w-5" />
                Tareas
                {pendingTasks.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {pendingTasks.length} pendientes
                  </Badge>
                )}
              </CardTitle>
              <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Nueva Tarea
              </Button>
            </div>
          </CardHeader>
        </Card>

        {!hasTasks ? (
          <Card>
            <CardContent className="py-6">
              <div className="text-center">
                <CheckSquare className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground text-sm">Sin tareas registradas</p>
                <p className="text-muted-foreground text-xs mt-1">
                  Crea tareas personalizadas o desde plantillas legales para hacer seguimiento
                </p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-3"
                  onClick={() => setCreateDialogOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Crear primera tarea
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {pendingTasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}

            {completedTasks.length > 0 && (
              <>
                <p className="text-sm text-muted-foreground pt-4 pb-2">
                  Completadas ({completedTasks.length})
                </p>
                {completedTasks.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Empty state - only when nothing at all */}
      {isEmpty && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Bell className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-semibold mb-2">Sin alertas, tareas ni recordatorios</h3>
              <p className="text-muted-foreground text-sm mb-4">
                Las alertas se crean automáticamente. También puedes crear tareas manuales.
              </p>
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Crear Tarea
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create Task Dialog */}
      <CreateTaskDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        workItemId={workItem.id}
      />
    </div>
  );
}
