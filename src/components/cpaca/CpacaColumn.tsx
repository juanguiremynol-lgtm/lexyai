import { useDroppable } from "@dnd-kit/core";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CpacaCard, CpacaItem } from "./CpacaCard";
import { CPACA_PHASES, type CpacaPhase } from "@/lib/cpaca-constants";
import { Info } from "lucide-react";

export interface CpacaStageConfig {
  id: string;
  label: string;
  shortLabel: string;
  color: string;
  description: string;
  keyDates: string[];
  phase: CpacaPhase;
}

interface CpacaColumnProps {
  stage: CpacaStageConfig;
  items: CpacaItem[];
  isSelectionMode: boolean;
  isItemSelected: (item: { id: string; type: "cpaca" }) => boolean;
  onToggleSelection: (item: { id: string; type: "cpaca" }, shiftKey: boolean) => void;
}

export function CpacaColumn({
  stage,
  items,
  isSelectionMode,
  isItemSelected,
  onToggleSelection,
}: CpacaColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
  });

  // Count urgencies
  const criticalCount = items.filter(i => 
    i.estadoCaducidad === "VENCIDO" || i.estadoCaducidad === "RIESGO"
  ).length;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-shrink-0 w-72 bg-muted/30 rounded-lg border",
        "flex flex-col min-h-[400px] max-h-[calc(100vh-300px)] transition-colors duration-200",
        isOver && "bg-primary/5 border-primary/50"
      )}
    >
      {/* Column Header */}
      <div className="p-3 border-b bg-muted/50 rounded-t-lg">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className={cn("w-2 h-2 rounded-full flex-shrink-0", stage.color)} />
            <Tooltip>
              <TooltipTrigger asChild>
                <h3 className="font-medium text-sm truncate cursor-help">
                  {stage.shortLabel}
                </h3>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="font-medium">{stage.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{stage.description}</p>
                {stage.keyDates.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium">Fechas clave:</p>
                    <ul className="text-xs text-muted-foreground list-disc list-inside">
                      {stage.keyDates.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </TooltipContent>
            </Tooltip>
            <Badge variant="secondary" className="text-xs flex-shrink-0">
              {items.length}
            </Badge>
            {criticalCount > 0 && (
              <Badge variant="destructive" className="text-xs flex-shrink-0">
                {criticalCount} ⚠️
              </Badge>
            )}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 text-muted-foreground cursor-help flex-shrink-0" />
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              <p className="text-xs">{stage.description}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Column Content */}
      <ScrollArea className="flex-1 p-2">
        <div className="space-y-2">
          {items.map((item) => (
            <CpacaCard
              key={item.id}
              item={item}
              isSelectionMode={isSelectionMode}
              isSelected={isItemSelected({ id: item.id, type: "cpaca" })}
              onToggleSelection={onToggleSelection}
            />
          ))}
          {items.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Sin procesos
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
