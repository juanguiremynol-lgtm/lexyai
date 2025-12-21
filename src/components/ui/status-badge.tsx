import { cn } from "@/lib/utils";
import { FILING_STATUSES, type FilingStatus } from "@/lib/constants";

interface StatusBadgeProps {
  status: FilingStatus;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const colorMap: Record<string, string> = {
  drafted: "bg-status-drafted/20 text-status-drafted border-status-drafted/30",
  sent: "bg-status-sent/20 text-status-sent border-status-sent/30",
  pending: "bg-status-pending/20 text-status-pending border-status-pending/30",
  received: "bg-status-received/20 text-status-received border-status-received/30",
  confirmed: "bg-status-confirmed/20 text-status-confirmed border-status-confirmed/30",
  active: "bg-status-active/20 text-status-active border-status-active/30",
  closed: "bg-status-closed/20 text-status-closed border-status-closed/30",
};

const sizeMap = {
  sm: "text-xs px-2 py-0.5",
  md: "text-sm px-2.5 py-1",
  lg: "text-base px-3 py-1.5",
};

export function StatusBadge({ status, size = "md", className }: StatusBadgeProps) {
  const config = FILING_STATUSES[status];
  
  if (!config) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center font-medium rounded-full border",
        colorMap[config.color],
        sizeMap[size],
        className
      )}
    >
      {config.label}
    </span>
  );
}
