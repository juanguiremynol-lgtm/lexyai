/**
 * HearingTimelineItem — Single step in the hearing timeline
 */
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Check, Clock, Calendar, CircleDot, Ban, ArrowRight } from "lucide-react";
import type { WorkItemHearing } from "@/hooks/use-work-item-hearings-v2";
import { HEARING_STATUS_LABELS } from "@/hooks/use-work-item-hearings-v2";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Props {
  hearing: WorkItemHearing;
  isSelected: boolean;
  onClick: () => void;
}

const statusIcons: Record<string, React.ReactNode> = {
  planned: <CircleDot className="h-4 w-4 text-muted-foreground" />,
  scheduled: <Calendar className="h-4 w-4 text-blue-500" />,
  held: <Check className="h-4 w-4 text-green-500" />,
  postponed: <ArrowRight className="h-4 w-4 text-yellow-500" />,
  cancelled: <Ban className="h-4 w-4 text-red-500" />,
};

export function HearingTimelineItem({ hearing, isSelected, onClick }: Props) {
  const name = hearing.custom_name || hearing.hearing_type?.short_name || "Audiencia";
  const legalBasis = hearing.hearing_type?.legal_basis;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-lg border transition-colors",
        "hover:bg-accent/50",
        isSelected
          ? "bg-accent border-primary/30 shadow-sm"
          : "border-transparent"
      )}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5">{statusIcons[hearing.status] || statusIcons.planned}</div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{name}</p>
          {legalBasis && (
            <p className="text-xs text-muted-foreground truncate">{legalBasis}</p>
          )}
          {hearing.scheduled_at && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {format(new Date(hearing.scheduled_at), "d MMM yyyy, HH:mm", { locale: es })}
            </p>
          )}
          {!hearing.scheduled_at && hearing.status === "planned" && (
            <p className="text-xs text-muted-foreground/60 mt-1 italic">Sin programar</p>
          )}
        </div>
        <Badge
          variant="secondary"
          className={cn("text-[10px] shrink-0", {
            "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300": hearing.status === "held",
            "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300": hearing.status === "scheduled",
            "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300": hearing.status === "postponed",
            "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300": hearing.status === "cancelled",
          })}
        >
          {HEARING_STATUS_LABELS[hearing.status]}
        </Badge>
      </div>
    </button>
  );
}
