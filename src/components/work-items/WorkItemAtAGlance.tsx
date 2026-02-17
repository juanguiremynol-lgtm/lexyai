/**
 * WorkItemAtAGlance — Persistent header chips for work item detail
 * Shows: last_update, alert_status, tasks_pending, responsible user
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Clock, Bell, CheckSquare, User, AlertTriangle, ShieldAlert } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import type { WorkItem } from "@/types/work-item";

interface AtAGlanceProps {
  workItem: WorkItem;
}

export function WorkItemAtAGlance({ workItem }: AtAGlanceProps) {
  // Fetch pending tasks count
  const { data: taskStats } = useQuery({
    queryKey: ["work-item-task-stats", workItem.id],
    queryFn: async () => {
      const { count: pending, error: e1 } = await supabase
        .from("work_item_tasks")
        .select("*", { count: "exact", head: true })
        .eq("work_item_id", workItem.id)
        .eq("status", "PENDIENTE");

      const { count: total } = await supabase
        .from("work_item_tasks")
        .select("*", { count: "exact", head: true })
        .eq("work_item_id", workItem.id);

      if (e1) throw e1;
      return { pending: pending ?? 0, total: total ?? 0 };
    },
    enabled: !!workItem.id,
  });

  // Fetch active alerts count
  const { data: alertStats } = useQuery({
    queryKey: ["work-item-alert-stats", workItem.id],
    queryFn: async () => {
      const { count: active } = await supabase
        .from("alert_instances")
        .select("*", { count: "exact", head: true })
        .eq("entity_id", workItem.id)
        .eq("entity_type", "work_item")
        .not("status", "eq", "RESOLVED");

      const { count: unread } = await supabase
        .from("alert_instances")
        .select("*", { count: "exact", head: true })
        .eq("entity_id", workItem.id)
        .eq("entity_type", "work_item")
        .not("status", "eq", "RESOLVED")
        .is("read_at", null);

      return { active: active ?? 0, unread: unread ?? 0 };
    },
    enabled: !!workItem.id,
  });

  const handleChipClick = (chipType: string) => {
    track(ANALYTICS_EVENTS.WORK_ITEM_CHIP_CLICKED, { chip_type: chipType });
  };

  const chips = [
    // Last update
    {
      id: "last_update",
      icon: Clock,
      label: workItem.last_action_date
        ? formatDistanceToNow(new Date(workItem.last_action_date), { addSuffix: true, locale: es })
        : workItem.updated_at
          ? formatDistanceToNow(new Date(workItem.updated_at), { addSuffix: true, locale: es })
          : "Sin actualización",
      tooltip: "Última actualización",
      variant: "outline" as const,
      color: "",
    },
    // Alert status
    {
      id: "alert_status",
      icon: alertStats && alertStats.unread > 0 ? ShieldAlert : Bell,
      label: alertStats
        ? alertStats.unread > 0
          ? `${alertStats.unread} sin leer`
          : alertStats.active > 0
            ? `${alertStats.active} activa${alertStats.active > 1 ? "s" : ""}`
            : "Sin alertas"
        : "…",
      tooltip: "Estado de alertas",
      variant: "outline" as const,
      color: alertStats && alertStats.unread > 0 ? "border-amber-500/50 text-amber-600 dark:text-amber-400" : "",
    },
    // Tasks pending
    {
      id: "tasks_pending",
      icon: CheckSquare,
      label: taskStats
        ? taskStats.pending > 0
          ? `${taskStats.pending} pendiente${taskStats.pending > 1 ? "s" : ""}`
          : taskStats.total > 0
            ? "Todas completadas"
            : "Sin tareas"
        : "…",
      tooltip: "Tareas",
      variant: "outline" as const,
      color: taskStats && taskStats.pending > 0 ? "border-primary/50 text-primary" : "",
    },
    // Monitoring status
    {
      id: "monitoring",
      icon: workItem.monitoring_enabled ? Bell : AlertTriangle,
      label: workItem.monitoring_enabled ? "Monitoreado" : "Sin monitoreo",
      tooltip: "Estado de monitoreo",
      variant: "outline" as const,
      color: workItem.monitoring_enabled
        ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
        : "border-destructive/50 text-destructive",
    },
  ];

  return (
    <TooltipProvider>
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => {
          const Icon = chip.icon;
          return (
            <Tooltip key={chip.id}>
              <TooltipTrigger asChild>
                <Badge
                  variant={chip.variant}
                  className={cn(
                    "cursor-default gap-1.5 py-1 px-2.5 text-xs font-normal",
                    chip.color
                  )}
                  onClick={() => handleChipClick(chip.id)}
                >
                  <Icon className="h-3 w-3" />
                  {chip.label}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">{chip.tooltip}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
