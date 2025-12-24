import { useDraggable } from "@dnd-kit/core";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Calendar, User, FileText, Gavel, Archive, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import type { TutelaPhase } from "@/lib/tutela-constants";
import { TUTELA_FINAL_PHASES } from "@/lib/tutela-constants";

export interface TutelaItem {
  id: string;
  filingType: string;
  radicado: string | null;
  courtName: string | null;
  createdAt: string;
  status: string;
  phase: TutelaPhase;
  clientName: string | null;
  demandantes: string | null;
  demandados: string | null;
  lastArchivedPromptAt: string | null;
  isFavorable: boolean | null;
}

interface TutelaCardProps {
  item: TutelaItem;
  isDragging?: boolean;
  isFocused?: boolean;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (item: { id: string; type: "tutela" }, shiftKey: boolean) => void;
  onArchivePrompt?: (item: TutelaItem) => void;
}

export function TutelaCard({
  item,
  isDragging = false,
  isFocused = false,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelection,
  onArchivePrompt,
}: TutelaCardProps) {
  const navigate = useNavigate();
  
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `tutela:${item.id}`,
    disabled: isSelectionMode,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const handleClick = (e: React.MouseEvent) => {
    if (isSelectionMode && onToggleSelection) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelection({ id: item.id, type: "tutela" }, e.shiftKey);
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleSelection) {
      onToggleSelection({ id: item.id, type: "tutela" }, e.shiftKey);
    }
  };

  const isFinalPhase = TUTELA_FINAL_PHASES.includes(item.phase);
  const showArchiveButton = isFinalPhase && onArchivePrompt;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...(isSelectionMode ? {} : { ...attributes, ...listeners })}
      onClick={handleClick}
      className={cn(
        "cursor-grab active:cursor-grabbing transition-all duration-200",
        "hover:shadow-md hover:border-primary/50",
        isDragging && "opacity-50 rotate-2 scale-105 shadow-xl",
        isFocused && "ring-2 ring-primary ring-offset-2",
        isSelected && "ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-950/20",
        isFinalPhase && item.isFavorable && "border-green-300 bg-green-50/50 dark:bg-green-950/10",
        isFinalPhase && !item.isFavorable && "border-red-300 bg-red-50/50 dark:bg-red-950/10"
      )}
    >
      <CardContent className="p-3 space-y-2">
        {/* Header with selection checkbox */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            {isSelectionMode && (
              <Checkbox
                checked={isSelected}
                onClick={handleCheckboxClick}
                className="mt-0.5"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Gavel className="h-4 w-4 text-purple-500" />
                <p className="text-sm font-medium">Tutela</p>
              </div>
              {item.radicado && (
                <p className="text-xs font-mono text-muted-foreground mt-1">
                  {item.radicado}
                </p>
              )}
            </div>
          </div>
          {isFinalPhase && (
            <Badge 
              variant={item.isFavorable ? "default" : "destructive"}
              className="text-xs"
            >
              {item.isFavorable ? "Favorable" : "Desfavorable"}
            </Badge>
          )}
        </div>

        {/* Court name */}
        {item.courtName && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <FileText className="h-3 w-3" />
            <span className="truncate">{item.courtName}</span>
          </div>
        )}

        {/* Client name */}
        {item.clientName && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <User className="h-3 w-3" />
            <span className="truncate">{item.clientName}</span>
          </div>
        )}

        {/* Parties */}
        {item.demandantes && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Accionante:</span>{" "}
            <span className="truncate">{item.demandantes}</span>
          </div>
        )}
        {item.demandados && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Accionado:</span>{" "}
            <span className="truncate">{item.demandados}</span>
          </div>
        )}

        {/* Created date */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          <span>{format(new Date(item.createdAt), "dd/MM/yyyy", { locale: es })}</span>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs flex-1"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/filings/${item.id}`);
            }}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Ver detalle
          </Button>
          
          {showArchiveButton && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onArchivePrompt(item);
              }}
            >
              <Archive className="h-3 w-3 mr-1" />
              Archivar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
