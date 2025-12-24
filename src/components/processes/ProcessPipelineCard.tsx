import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { User, ExternalLink } from "lucide-react";
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

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "cursor-grab active:cursor-grabbing transition-all duration-200 group",
        isDragging && "opacity-90 shadow-lg scale-105 rotate-2 ring-2 ring-primary",
        !isDragging && "hover:shadow-md hover:ring-2 hover:ring-primary/30"
      )}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          {/* Navigation button - top left corner */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              navigate(`/process-status/${process.id}`);
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <div className="flex-1 min-w-0">
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
        </div>
      </CardContent>
    </Card>
  );
}
