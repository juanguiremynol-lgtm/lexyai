import { useDroppable } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PeticionCard, PeticionItem } from "./PeticionCard";
import type { PeticionPhase } from "@/lib/peticiones-constants";
import { PETICION_PHASES } from "@/lib/peticiones-constants";

export interface PeticionStageConfig {
  id: string;
  label: string;
  shortLabel: string;
  color: string;
  phase: PeticionPhase;
}

interface PeticionColumnProps {
  stage: PeticionStageConfig;
  items: PeticionItem[];
  focusedItemId?: string | null;
  isSelectionMode?: boolean;
  isItemSelected?: (item: { id: string; type: "peticion" }) => boolean;
  onToggleSelection?: (item: { id: string; type: "peticion" }, shiftKey: boolean) => void;
  onEscalateToTutela?: (item: PeticionItem) => void;
}

const STAGE_COLORS: Record<string, string> = {
  blue: "bg-blue-50/50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800",
  amber: "bg-amber-50/50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800",
  emerald: "bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800",
};

const BADGE_COLORS: Record<string, string> = {
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
};

export function PeticionColumn({
  stage,
  items,
  focusedItemId,
  isSelectionMode = false,
  isItemSelected,
  onToggleSelection,
  onEscalateToTutela,
}: PeticionColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
  });

  const colorClass = STAGE_COLORS[stage.color] || STAGE_COLORS.blue;
  const badgeClass = BADGE_COLORS[stage.color] || BADGE_COLORS.blue;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col min-w-[280px] max-w-[320px] rounded-lg border-2 transition-all duration-200",
        colorClass,
        isOver && "ring-2 ring-primary ring-offset-2 scale-[1.02]"
      )}
    >
      {/* Column Header */}
      <div className="p-3 border-b border-inherit">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">{stage.shortLabel}</h3>
            <Badge variant="secondary" className={cn("text-xs px-2", badgeClass)}>
              {items.length}
            </Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {PETICION_PHASES[stage.phase].description}
        </p>
      </div>

      {/* Cards Container */}
      <div className="flex-1 p-2 space-y-2 min-h-[200px] max-h-[600px] overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            Sin peticiones
          </div>
        ) : (
          items.map((item) => (
            <PeticionCard
              key={item.id}
              item={item}
              isFocused={focusedItemId === `peticion:${item.id}`}
              isSelectionMode={isSelectionMode}
              isSelected={isItemSelected?.({ id: item.id, type: "peticion" }) ?? false}
              onToggleSelection={onToggleSelection}
              onEscalateToTutela={onEscalateToTutela}
            />
          ))
        )}
      </div>
    </div>
  );
}
