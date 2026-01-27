import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { SlaBadge } from "@/components/ui/sla-badge";
import { ClientRequiredBadge } from "@/components/shared/ClientRequiredBadge";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import type { FilingStatus } from "@/lib/constants";

interface Filing {
  id: string;
  status: FilingStatus;
  filing_type: string;
  sla_acta_due_at: string | null;
  sla_court_reply_due_at: string | null;
  matter: { client_name: string; matter_name: string } | null;
  client_id: string | null;
}

interface KanbanCardProps {
  filing: Filing;
  isDragging?: boolean;
}

export function KanbanCard({ filing, isDragging = false }: KanbanCardProps) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: filing.id,
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  const relevantSla =
    filing.status === "ACTA_PENDING"
      ? filing.sla_acta_due_at
      : filing.sla_court_reply_due_at;

  const handleClick = (e: React.MouseEvent) => {
    // Only navigate if not dragging - use canonical work-items route
    if (!transform) {
      navigate(`/app/work-items/${filing.id}`);
    }
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "cursor-grab active:cursor-grabbing transition-all duration-200",
        isDragging && "opacity-90 shadow-lg scale-105 rotate-2 ring-2 ring-primary",
        !isDragging && "hover:shadow-md"
      )}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <div
            {...attributes}
            {...listeners}
            className="flex-shrink-0 text-muted-foreground hover:text-foreground mt-0.5"
          >
            <GripVertical className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0" onClick={handleClick}>
            <p className="font-medium text-sm truncate">
              {filing.matter?.client_name}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {filing.matter?.matter_name}
            </p>
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">
                  {filing.filing_type}
                </span>
                <ClientRequiredBadge hasClient={!!filing.client_id} />
              </div>
              {relevantSla && <SlaBadge dueDate={relevantSla} size="sm" />}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
