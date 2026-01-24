/**
 * Alerts & Tasks Tab - Shows alerts and tasks for the work item
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Bell, 
  CheckSquare,
  Calendar,
  AlertTriangle,
  Info,
  AlertCircle,
} from "lucide-react";
import { format, formatDistanceToNow, isPast } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

import type { WorkItem } from "@/types/work-item";

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

export function AlertsTasksTab({ workItem }: AlertsTasksTabProps) {
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
      // Map database fields to component interface
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
    enabled: !!workItem.legacy_filing_id,
  });

  // Fetch alerts
  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ["work-item-alerts", workItem.id],
    queryFn: async () => {
      const legacyFilingId = workItem.legacy_filing_id;
      
      if (!legacyFilingId) return [];
      
      const { data, error } = await supabase
        .from("alerts")
        .select("*")
        .eq("filing_id", legacyFilingId)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      // Map database fields to component interface
      return (data || []).map((a: any) => ({
        id: a.id,
        title: a.message?.substring(0, 50) || "Alerta",
        message: a.message,
        severity: a.severity === "CRITICAL" ? "error" : a.severity === "WARN" ? "warning" : "info",
        is_read: a.is_read,
        created_at: a.created_at,
      })) as Alert[];
    },
    enabled: !!workItem.legacy_filing_id,
  });

  const isLoading = tasksLoading || alertsLoading;

  const pendingTasks = tasks?.filter((t) => t.status === "open") || [];
  const completedTasks = tasks?.filter((t) => t.status === "completed") || [];
  const unreadAlerts = alerts?.filter((a) => !a.is_read) || [];

  const getSeverityConfig = (severity: string) => {
    switch (severity) {
      case "error":
        return { icon: AlertCircle, color: "text-destructive", bg: "bg-destructive/10" };
      case "warning":
        return { icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-500/10" };
      default:
        return { icon: Info, color: "text-blue-600", bg: "bg-blue-500/10" };
    }
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
  const isEmpty = !hasTasks && !hasAlerts;

  return (
    <div className="space-y-6">
      {/* Alerts Section */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
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
            <CardContent className="py-8">
              <div className="text-center">
                <Bell className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
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
          <CardHeader>
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
            <CardContent className="py-8">
              <div className="text-center">
                <CheckSquare className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
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
              <h3 className="font-semibold mb-2">Sin alertas ni tareas</h3>
              <p className="text-muted-foreground text-sm">
                Las alertas y tareas se crearán automáticamente según la actividad del caso.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
