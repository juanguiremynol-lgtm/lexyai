import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { SlaBadge } from "@/components/ui/sla-badge";
import { ClientRequiredBadge } from "@/components/shared/ClientRequiredBadge";
import { User, ExternalLink, Scale, FileText, ArrowRightLeft, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import type { WorkflowType } from "@/lib/workflow-constants";
import type { CGPPhase } from "@/lib/cgp-constants";

export interface WorkItemPipelineItem {
  id: string;
  workflow_type: WorkflowType;
  stage: string;
  cgp_phase: CGPPhase | 'FILING' | 'PROCESS' | null;
  radicado: string | null;
  title: string | null;
  client_id: string | null;
  client_name: string | null;
  authority_name: string | null;
  demandantes: string | null;
  demandados: string | null;
  is_flagged: boolean;
  last_action_date: string | null;
  last_checked_at: string | null;
  monitoring_enabled: boolean;
  auto_admisorio_date: string | null;
  created_at: string;
}

interface WorkItemPipelineCardProps {
  item: WorkItemPipelineItem;
  isDragging?: boolean;
  isFocused?: boolean;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onReclassify?: (item: WorkItemPipelineItem) => void;
  onToggleSelection?: (item: WorkItemPipelineItem, shiftKey: boolean) => void;
  onToggleFlag?: (item: WorkItemPipelineItem) => void;
}

export function WorkItemPipelineCard({ 
  item, 
  isDragging = false,
  isFocused = false,
  isSelected = false,
  isSelectionMode = false,
  onReclassify,
  onToggleSelection,
  onToggleFlag,
}: WorkItemPipelineCardProps) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: item.id,
    data: { item },
    disabled: isSelectionMode,
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  // Navigate to the complete CGP detail view (canonical route)
  const detailPath = `/cgp/${item.id}`;
  // Handle both old naming (FILING/PROCESS) and new naming (RADICACION/PROCESO)
  const isFilingPhase = item.cgp_phase === "RADICACION" || item.cgp_phase === "FILING";
  const isProcessPhase = item.cgp_phase === "PROCESO" || item.cgp_phase === "PROCESS";

  const handleCardClick = (e: React.MouseEvent) => {
    if (isSelectionMode && onToggleSelection) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelection(item, e.shiftKey);
    }
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...(isSelectionMode ? {} : { ...attributes, ...listeners })}
      onClick={handleCardClick}
      className={cn(
        "transition-all duration-200 group",
        "border-l-4 shadow-card",
        isSelectionMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-90 shadow-elevated scale-105 rotate-2 ring-2 ring-primary z-50",
        isSelected && "ring-2 ring-primary bg-primary/5",
        isFocused && !isDragging && !isSelected && "ring-2 ring-primary shadow-elevated -translate-y-0.5",
        !isDragging && !isFocused && !isSelected && "hover:shadow-elevated hover:ring-1 hover:ring-primary/30 hover:-translate-y-0.5",
        // Phase-specific styling
        isFilingPhase && "border-l-blue-500 bg-gradient-to-r from-blue-500/10 to-transparent",
        isProcessPhase && "border-l-primary bg-gradient-to-r from-primary/10 to-transparent",
        // Flagged styling
        item.is_flagged && "ring-2 ring-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20"
      )}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          {/* Selection checkbox or navigation buttons */}
          <div className="flex flex-col gap-1 flex-shrink-0">
            {isSelectionMode ? (
              <div className="h-7 w-7 flex items-center justify-center">
                <Checkbox 
                  checked={isSelected}
                  onCheckedChange={() => onToggleSelection?.(item, false)}
                  onClick={(e) => e.stopPropagation()}
                  className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                />
              </div>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-7 w-7 transition-all",
                    isFilingPhase 
                      ? "hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900/50" 
                      : "hover:bg-emerald-100 hover:text-emerald-700 dark:hover:bg-emerald-900/50"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    navigate(detailPath);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  title="Ver detalle"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
                {onReclassify && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:bg-amber-100 hover:text-amber-700 dark:hover:bg-amber-900/50 transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onReclassify(item);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    title="Reclasificar"
                  >
                    <ArrowRightLeft className="h-4 w-4" />
                  </Button>
                )}
                {onToggleFlag && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-7 w-7 transition-all",
                      item.is_flagged 
                        ? "text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/50" 
                        : "hover:bg-muted hover:text-amber-500"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onToggleFlag(item);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    title={item.is_flagged ? "Quitar bandera" : "Marcar con bandera"}
                  >
                    <Flag className={cn("h-4 w-4", item.is_flagged && "fill-current")} />
                  </Button>
                )}
              </>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Type indicator badge */}
            <div className="flex items-center gap-1.5 mb-2">
              <Badge 
                variant="secondary" 
                className={cn(
                  "text-[10px] px-1.5 py-0.5 font-medium",
                  isFilingPhase 
                    ? "bg-blue-500/20 text-blue-400 border-blue-500/30" 
                    : "bg-primary/20 text-primary border-primary/30"
                )}
              >
                {isFilingPhase ? (
                  <FileText className="h-3 w-3 mr-1" />
                ) : (
                  <Scale className="h-3 w-3 mr-1" />
                )}
                {isFilingPhase ? "Radicación" : "Proceso"}
              </Badge>
              {item.is_flagged && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-amber-500/20 text-amber-500 border-amber-500/30">
                  <Flag className="h-2.5 w-2.5 mr-0.5 fill-current" />
                  Marcado
                </Badge>
              )}
            </div>

            {/* Radicado - more prominent */}
            {item.radicado && (
              <p className="font-mono text-sm font-semibold text-foreground truncate mb-1">
                {item.radicado}
              </p>
            )}

            {/* Client info */}
            <div className="flex items-center gap-1">
              <p className="text-sm font-medium text-foreground/80 truncate">
                {item.client_name || item.title || "Sin cliente"}
              </p>
              <ClientRequiredBadge hasClient={!!item.client_id} />
            </div>

            {/* Authority/Court */}
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {item.authority_name || "Sin juzgado"}
            </p>

            {/* Parties for processes */}
            {isProcessPhase && (item.demandantes || item.demandados) && (
              <div className="flex items-center gap-1.5 mt-2 p-1.5 bg-muted/50 rounded">
                <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-muted-foreground truncate">
                  {item.demandantes?.split(",")[0] || item.demandados?.split(",")[0]}
                </span>
              </div>
            )}

            {/* Last action or last checked */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
              {item.last_checked_at && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {formatDistanceToNow(new Date(item.last_checked_at), {
                    addSuffix: true,
                    locale: es,
                  })}
                </p>
              )}
              {!item.last_checked_at && item.last_action_date && (
                <p className="text-xs text-muted-foreground">
                  Última acción: {formatDistanceToNow(new Date(item.last_action_date), {
                    addSuffix: true,
                    locale: es,
                  })}
                </p>
              )}
              {!item.last_checked_at && !item.last_action_date && (
                <span className="text-xs text-muted-foreground italic">Sin actividad</span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
