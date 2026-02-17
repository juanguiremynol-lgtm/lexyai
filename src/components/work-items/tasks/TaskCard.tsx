/**
 * Task card component for displaying a single work item task
 */

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar, Bell, Trash2, User } from "lucide-react";
import { format, isPast } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useToggleTaskStatus, useDeleteTask, type WorkItemTask } from "@/hooks/use-work-item-tasks";
import { getTemplateByKey } from "./TaskTemplates";

interface TaskCardProps {
  task: WorkItemTask;
}

const PRIORITY_CONFIG = {
  ALTA: { label: '🔴 Alta', class: 'border-l-red-500' },
  MEDIA: { label: '🟡 Media', class: 'border-l-amber-500' },
  BAJA: { label: '🟢 Baja', class: 'border-l-emerald-500' },
};

export function TaskCard({ task }: TaskCardProps) {
  const toggleStatus = useToggleTaskStatus();
  const deleteTask = useDeleteTask();

  const isCompleted = task.status === 'COMPLETADA';
  const isOverdue = !isCompleted && task.due_date && isPast(new Date(task.due_date));
  const priority = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.MEDIA;
  const template = task.template_key ? getTemplateByKey(task.template_key) : null;

  const channelLabels = task.alert_channels?.map(c => 
    c === 'IN_APP' ? 'App' : c === 'EMAIL' ? 'Email' : c
  ).join(', ');

  return (
    <Card className={cn(
      "transition-colors border-l-4",
      isCompleted ? "bg-muted/30 border-l-muted" : priority.class,
      isOverdue && !isCompleted && "bg-destructive/5"
    )}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Checkbox
            checked={isCompleted}
            onCheckedChange={() => toggleStatus.mutate({
              taskId: task.id,
              workItemId: task.work_item_id,
              currentStatus: task.status,
            })}
            disabled={toggleStatus.isPending}
            className="mt-1"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn(
                "font-medium text-sm",
                isCompleted && "line-through text-muted-foreground"
              )}>
                {task.title}
              </span>
              {template && (
                <Badge variant="outline" className="text-[10px]">
                  {template.category === 'milestone' ? '📋' : '⚖️'} {template.label}
                </Badge>
              )}
              {!isCompleted && (
                <Badge variant="outline" className="text-[10px]">
                  {priority.label}
                </Badge>
              )}
            </div>

            {task.description && !isCompleted && (
              <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
            )}

            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {task.due_date && (
                <span className={cn(
                  "flex items-center gap-1 text-xs",
                  isOverdue ? "text-destructive font-medium" : "text-muted-foreground"
                )}>
                  <Calendar className="h-3 w-3" />
                  {format(new Date(task.due_date), "d MMM yyyy", { locale: es })}
                  {isOverdue && " (vencida)"}
                </span>
              )}

              {task.alert_enabled && !isCompleted && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Bell className="h-3 w-3" />
                  {channelLabels} · c/{task.alert_cadence_days}d
                </span>
              )}

              {task.assigned_to && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <User className="h-3 w-3" />
                  Asignada
                </span>
              )}
            </div>
          </div>

          {!isCompleted && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => deleteTask.mutate({ taskId: task.id, workItemId: task.work_item_id })}
              disabled={deleteTask.isPending}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
