import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { GripVertical, User, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import type { ProcessPhase } from "@/lib/constants";

interface MonitoredProcess {
  id: string;
  radicado: string;
  despacho_name: string | null;
  monitoring_enabled: boolean;
  last_checked_at: string | null;
  last_change_at: string | null;
  phase: ProcessPhase | null;
  clients: { id: string; name: string } | null;
}

interface ProcessPipelineCardProps {
  process: MonitoredProcess;
  isDragging?: boolean;
}

export function ProcessPipelineCard({ process, isDragging = false }: ProcessPipelineCardProps) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: process.id,
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  const handleClick = (e: React.MouseEvent) => {
    // Only navigate if not dragging
    if (!transform) {
      navigate(`/process-status/${process.id}`);
    }
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "cursor-grab active:cursor-grabbing transition-all duration-200",
        isDragging && "opacity-90 shadow-lg scale-105 rotate-2 ring-2 ring-primary",
        !isDragging && "hover:shadow-md hover:ring-2 hover:ring-primary/30"
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
            <p className="font-mono text-xs truncate">
              {process.radicado}
            </p>
            <p className="text-xs text-muted-foreground truncate mt-1">
              {process.despacho_name || "Sin despacho"}
            </p>
            {process.clients && (
              <div className="flex items-center gap-1 mt-2">
                <User className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground truncate">
                  {process.clients.name}
                </span>
              </div>
            )}
            {process.last_checked_at && (
              <p className="text-[10px] text-muted-foreground mt-1">
                {formatDistanceToNow(new Date(process.last_checked_at), {
                  addSuffix: true,
                  locale: es,
                })}
              </p>
            )}
          </div>
          <button
            className="flex-shrink-0 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/process-status/${process.id}`);
            }}
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
