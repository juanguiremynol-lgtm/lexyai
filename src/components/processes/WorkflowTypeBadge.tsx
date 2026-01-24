import { Badge } from "@/components/ui/badge";
import { Scale, Landmark, Gavel, Building2, Send, Briefcase } from "lucide-react";
import type { WorkflowType } from "@/lib/workflow-constants";
import { WORKFLOW_TYPES } from "@/lib/workflow-constants";
import { cn } from "@/lib/utils";

interface WorkflowTypeBadgeProps {
  workflowType: WorkflowType;
  className?: string;
  showIcon?: boolean;
}

const WORKFLOW_ICONS: Record<WorkflowType, React.ComponentType<{ className?: string }>> = {
  CGP: Scale,
  CPACA: Landmark,
  TUTELA: Gavel,
  GOV_PROCEDURE: Building2,
  PETICION: Send,
  LABORAL: Briefcase,
};

const WORKFLOW_COLORS: Record<WorkflowType, string> = {
  CGP: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
  CPACA: "bg-indigo-500/15 text-indigo-700 border-indigo-500/30 dark:text-indigo-400",
  TUTELA: "bg-purple-500/15 text-purple-700 border-purple-500/30 dark:text-purple-400",
  GOV_PROCEDURE: "bg-orange-500/15 text-orange-700 border-orange-500/30 dark:text-orange-400",
  PETICION: "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-400",
  LABORAL: "bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-400",
};

export function WorkflowTypeBadge({ 
  workflowType, 
  className,
  showIcon = true 
}: WorkflowTypeBadgeProps) {
  const config = WORKFLOW_TYPES[workflowType];
  const Icon = WORKFLOW_ICONS[workflowType];
  const colorClass = WORKFLOW_COLORS[workflowType];

  if (!config) {
    return (
      <Badge variant="outline" className={className}>
        {workflowType}
      </Badge>
    );
  }

  return (
    <Badge 
      variant="outline" 
      className={cn("font-medium", colorClass, className)}
    >
      {showIcon && Icon && <Icon className="h-3 w-3 mr-1" />}
      {config.shortLabel}
    </Badge>
  );
}
