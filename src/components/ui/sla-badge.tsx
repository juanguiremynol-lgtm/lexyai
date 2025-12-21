import { cn } from "@/lib/utils";
import { getSlaStatus, getDaysDiff } from "@/lib/constants";
import { Clock, AlertTriangle, CheckCircle } from "lucide-react";

interface SlaBadgeProps {
  dueDate: string | Date | null;
  label?: string;
  showIcon?: boolean;
  size?: "sm" | "md";
  className?: string;
}

const colorMap = {
  safe: "bg-sla-safe/15 text-sla-safe border-sla-safe/30",
  warning: "bg-sla-warning/15 text-sla-warning border-sla-warning/30",
  critical: "bg-sla-critical/15 text-sla-critical border-sla-critical/30 animate-pulse-slow",
};

const iconMap = {
  safe: CheckCircle,
  warning: Clock,
  critical: AlertTriangle,
};

const sizeMap = {
  sm: "text-xs px-2 py-0.5 gap-1",
  md: "text-sm px-2.5 py-1 gap-1.5",
};

export function SlaBadge({ dueDate, label, showIcon = true, size = "md", className }: SlaBadgeProps) {
  const status = getSlaStatus(dueDate);
  const daysDiff = getDaysDiff(dueDate);
  
  if (!status || daysDiff === null) {
    return null;
  }

  const Icon = iconMap[status];
  
  let displayText: string;
  if (daysDiff < 0) {
    displayText = `${label ? label + ' ' : ''}Vencido ${Math.abs(daysDiff)}d`;
  } else if (daysDiff === 0) {
    displayText = `${label ? label + ' ' : ''}Vence hoy`;
  } else {
    displayText = `${label ? label + ' ' : ''}${daysDiff}d`;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center font-medium rounded-full border",
        colorMap[status],
        sizeMap[size],
        className
      )}
    >
      {showIcon && <Icon className={cn(size === "sm" ? "h-3 w-3" : "h-4 w-4")} />}
      {displayText}
    </span>
  );
}
