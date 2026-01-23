import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ClientRequiredBadge } from "@/components/shared/ClientRequiredBadge";
import { User, ExternalLink, Flag } from "lucide-react";
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
  client_id: string | null;
  clients: { id: string; name: string } | null;
  is_flagged?: boolean;
}

interface ProcessPipelineCardProps {
  process: MonitoredProcess;
  isDragging?: boolean;
  isFocused?: boolean;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onToggleSelect?: () => void;
  onToggleFlag?: () => void;
}

export function ProcessPipelineCard({
  process,
  isDragging = false,
  isFocused = false,
  isSelected = false,
  isSelectionMode = false,
  onToggleSelect,
  onToggleFlag,
}: ProcessPipelineCardProps) {
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
        !isDragging && "hover:shadow-md hover:ring-2 hover:ring-primary/30",
        isFocused && "ring-2 ring-primary shadow-lg",
        isSelected && "ring-2 ring-primary bg-primary/5",
        process.is_flagged && "border-l-4 border-l-amber-500"
      )}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          {/* Selection checkbox in selection mode */}
          {isSelectionMode && onToggleSelect && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelect()}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="mt-0.5"
            />
          )}
          {/* Navigation button - top left corner */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              // Navigate to canonical CGP detail view
              navigate(`/cgp/${process.id}`);
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <p className="font-mono text-xs truncate">
                {process.radicado}
              </p>
              <ClientRequiredBadge hasClient={!!process.client_id} />
              {process.is_flagged && (
                <Flag className="h-3 w-3 text-amber-500 fill-amber-500" />
              )}
            </div>
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
          {/* Flag button */}
          {onToggleFlag && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-6 w-6 flex-shrink-0 transition-opacity",
                process.is_flagged
                  ? "text-amber-500 opacity-100"
                  : "opacity-0 group-hover:opacity-60 hover:opacity-100"
              )}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onToggleFlag();
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Flag className={cn("h-3.5 w-3.5", process.is_flagged && "fill-amber-500")} />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
