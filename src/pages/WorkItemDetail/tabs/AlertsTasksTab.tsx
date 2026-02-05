/**
 * Alerts & Tasks Tab - Shows milestone reminders, alerts, and tasks for the work item
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

interface AlertsTasksTabProps {
  workItem: WorkItem & { _source?: string };
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: "open" | "completed";
  task_type: string | null;
  created_at: string;
}

interface Alert {
  id: string;
  title: string;
  message: string | null;
  severity: "info" | "warning" | "error";
  is_read: boolean;
  created_at: string;
}

// Icon mapping for reminder types
const REMINDER_ICONS: Record<ReminderType, typeof FileText> = {
  ACTA_REPARTO_PENDING: FileText,
  RADICADO_PENDING: Hash,
  EXPEDIENTE_PENDING: Link2,
  AUTO_ADMISORIO_PENDING: Gavel,
};

export function AlertsTasksTab({ workItem }: AlertsTasksTabProps) {
  // Fetch all active reminders (not just due ones) to show upcoming too
  const { data: activeReminders = [], isLoading: remindersLoading } = useActiveReminders({ 
    workItemId: workItem.id 
  });
  const snoozeMutation = useSnoozeReminder();
  const dismissMutation = useDismissReminder();

  // Fetch tasks
  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ["work-item-tasks", workItem.id],
    queryFn: async () => {
      const legacyFilingId = workItem.legacy_filing_id;
      
      if (!legacyFilingId) return [];
      
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("filing_id", legacyFilingId)
        .order("due_at", { ascending: true, nullsFirst: false });
      
      if (error) throw error;
      return (data || []).map((t: any) => ({
        id: t.id,
        title: t.title,
        description: null,
        due_date: t.due_at,
        status: t.status === "DONE" ? "completed" : "open",
        task_type: t.type,
        created_at: t.created_at,
      })) as Task[];
    },
    enabled: !!workItem.id,
  });

  // Fetch alerts using work_item_id
  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ["work-item-alerts", workItem.id],
    queryFn: async () => {
      // Query alert_instances which use work_item_id via entity_id
      const { data, error } = await supabase
        .from("alert_instances")
        .select("*")
        .eq("entity_id", workItem.id)
        .eq("entity_type", "work_item")
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return (data || []).map((a: any) => ({
        id: a.id,
        title: a.title || "Alerta",
        message: a.message,
        severity: a.severity === "critical" ? "error" : a.severity === "warn" ? "warning" : "info",
        is_read: !!a.read_at,
        created_at: a.created_at,
      })) as Alert[];
    },
    enabled: !!workItem.legacy_filing_id,
  });

  const isLoading = tasksLoading || alertsLoading || remindersLoading;

  const pendingTasks = tasks?.filter((t) => t.status === "open") || [];
  const completedTasks = tasks?.filter((t) => t.status === "completed") || [];
  const unreadAlerts = alerts?.filter((a) => !a.is_read) || [];
  
  // Separate due vs upcoming reminders
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

  // Render a single reminder card
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
          
          {/* CTA Button */}
          {isDue && (
            <div className="mt-3 pl-11">
              <Button 
                variant="outline" 
                size="sm"
                className="text-xs"
                onClick={() => {
                  // Scroll to Overview tab where milestones are
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

  const hasTasks = (tasks?.length || 0) > 0;
  const hasAlerts = (alerts?.length || 0) > 0;
  const hasReminders = activeReminders.length > 0;
  const isEmpty = !hasTasks && !hasAlerts && !hasReminders;

  return (
    <div className="space-y-6">
      {/* Milestone Reminders Section - Show first as they are actionable */}
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
          
          {/* Due reminders first */}
          {dueReminders.length > 0 && (
            <div className="space-y-2">
              {dueReminders.map(reminder => renderReminderCard(reminder, true))}
            </div>
          )}
          
          {/* Upcoming reminders */}
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
                          {!alert.is_read && (
                            <Badge variant="secondary" className="text-xs">Nuevo</Badge>
                          )}
                        </div>
                        {alert.message && (
                          <p className="text-sm text-muted-foreground mt-1">{alert.message}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">
                          {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true, locale: es })}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Tasks Section */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <CheckSquare className="h-5 w-5" />
              Tareas
              {pendingTasks.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {pendingTasks.length} pendientes
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
        </Card>

        {!hasTasks ? (
          <Card>
            <CardContent className="py-6">
              <div className="text-center">
                <CheckSquare className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground text-sm">Sin tareas registradas</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {/* Pending tasks first */}
            {pendingTasks.map((task) => {
              const isOverdue = task.due_date && isPast(new Date(task.due_date));

              return (
                <Card 
                  key={task.id} 
                  className={cn(
                    "transition-colors",
                    isOverdue && "border-destructive bg-destructive/5"
                  )}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Checkbox disabled className="mt-1" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{task.title}</p>
                        {task.description && (
                          <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
                        )}
                        {task.due_date && (
                          <div className={cn(
                            "flex items-center gap-1 text-sm mt-2",
                            isOverdue ? "text-destructive" : "text-muted-foreground"
                          )}>
                            <Calendar className="h-3.5 w-3.5" />
                            {format(new Date(task.due_date), "d MMM yyyy", { locale: es })}
                            {isOverdue && <span className="ml-1">(vencida)</span>}
                          </div>
                        )}
                      </div>
                      {task.task_type && (
                        <Badge variant="outline" className="text-xs">
                          {task.task_type}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Completed tasks */}
            {completedTasks.length > 0 && (
              <>
                <p className="text-sm text-muted-foreground pt-4 pb-2">Completadas ({completedTasks.length})</p>
                {completedTasks.map((task) => (
                  <Card key={task.id} className="bg-muted/30">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Checkbox checked disabled className="mt-1" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium line-through text-muted-foreground">{task.title}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Empty state */}
      {isEmpty && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Bell className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-semibold mb-2">Sin alertas, tareas ni recordatorios</h3>
              <p className="text-muted-foreground text-sm">
                Las alertas y recordatorios se crearán automáticamente según la actividad del caso.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
