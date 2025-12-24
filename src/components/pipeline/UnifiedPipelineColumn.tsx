import { useDroppable } from "@dnd-kit/core";
import { UnifiedPipelineCard, UnifiedItem } from "./UnifiedPipelineCard";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StageType = "filing" | "process";

export interface StageConfig {
  id: string;
  label: string;
  shortLabel: string;
  color: string;
  type: StageType;
}

interface UnifiedPipelineColumnProps {
  stage: StageConfig;
  items: UnifiedItem[];
  focusedItemId?: string | null;
  isSelectionMode?: boolean;
  isItemSelected?: (item: UnifiedItem) => boolean;
  onReclassify?: (item: UnifiedItem) => void;
  onToggleSelection?: (item: UnifiedItem, shiftKey: boolean) => void;
}

const STAGE_COLORS: Record<string, string> = {
  // Filing colors (blue-ish tones)
  gray: "bg-gray-500/10 border-gray-500/20",
  slate: "bg-slate-500/10 border-slate-500/20",
  zinc: "bg-zinc-500/10 border-zinc-500/20",
  sky: "bg-sky-500/10 border-sky-500/20",
  indigo: "bg-indigo-500/10 border-indigo-500/20",
  // Process colors (warm tones)
  amber: "bg-amber-500/10 border-amber-500/20",
  orange: "bg-orange-500/10 border-orange-500/20",
  rose: "bg-rose-500/10 border-rose-500/20",
  violet: "bg-violet-500/10 border-violet-500/20",
  purple: "bg-purple-500/10 border-purple-500/20",
  blue: "bg-blue-500/10 border-blue-500/20",
  cyan: "bg-cyan-500/10 border-cyan-500/20",
  teal: "bg-teal-500/10 border-teal-500/20",
  emerald: "bg-emerald-500/10 border-emerald-500/20",
};

const BADGE_COLORS: Record<string, string> = {
  gray: "bg-gray-500/20 text-gray-700 dark:text-gray-400 border-gray-500/30",
  slate: "bg-slate-500/20 text-slate-700 dark:text-slate-400 border-slate-500/30",
  zinc: "bg-zinc-500/20 text-zinc-700 dark:text-zinc-400 border-zinc-500/30",
  sky: "bg-sky-500/20 text-sky-700 dark:text-sky-400 border-sky-500/30",
  indigo: "bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 border-indigo-500/30",
  amber: "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30",
  orange: "bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/30",
  rose: "bg-rose-500/20 text-rose-700 dark:text-rose-400 border-rose-500/30",
  violet: "bg-violet-500/20 text-violet-700 dark:text-violet-400 border-violet-500/30",
  purple: "bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-500/30",
  blue: "bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/30",
  cyan: "bg-cyan-500/20 text-cyan-700 dark:text-cyan-400 border-cyan-500/30",
  teal: "bg-teal-500/20 text-teal-700 dark:text-teal-400 border-teal-500/30",
  emerald: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
};

export function UnifiedPipelineColumn({ 
  stage, 
  items,
  focusedItemId,
  isSelectionMode = false,
  isItemSelected,
  onReclassify,
  onToggleSelection,
}: UnifiedPipelineColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
    data: { stageType: stage.type },
  });

  const colorClass = STAGE_COLORS[stage.color] || STAGE_COLORS.blue;
  const badgeClass = BADGE_COLORS[stage.color] || BADGE_COLORS.blue;

  return (
    <div className="flex-shrink-0 w-72">
      <div
        ref={setNodeRef}
        className={cn(
          "rounded-xl p-4 min-h-[450px] border-2 transition-all duration-200",
          colorClass,
          isOver && "ring-2 ring-primary/50 bg-primary/10 scale-[1.02]",
          !isOver && "hover:border-opacity-40"
        )}
      >
        {/* Enhanced header */}
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-current/10">
          <div className="flex flex-col gap-1">
            <Badge 
              variant="outline" 
              className={cn(
                "text-xs font-semibold px-2 py-1",
                badgeClass
              )}
            >
              {stage.shortLabel}
            </Badge>
            <span className={cn(
              "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full inline-flex items-center gap-1 w-fit",
              stage.type === "filing" 
                ? "text-blue-700 bg-blue-100 dark:bg-blue-900/50 dark:text-blue-300" 
                : "text-emerald-700 bg-emerald-100 dark:bg-emerald-900/50 dark:text-emerald-300"
            )}>
              <span className={cn(
                "w-2 h-2 rounded-full",
                stage.type === "filing" ? "bg-blue-500" : "bg-emerald-500"
              )} />
              {stage.type === "filing" ? "Radicación" : "Proceso"}
            </span>
          </div>
          <div className={cn(
            "flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold",
            items.length > 0 
              ? stage.type === "filing" 
                ? "bg-blue-500 text-white" 
                : "bg-emerald-500 text-white"
              : "bg-muted text-muted-foreground"
          )}>
            {items.length}
          </div>
        </div>
        
        {/* Cards container */}
        <div className="space-y-3">
          {items.map((item) => {
            const itemKey = `${item.type}:${item.id}`;
            return (
              <UnifiedPipelineCard 
                key={itemKey} 
                item={item}
                isFocused={focusedItemId === itemKey}
                isSelected={isItemSelected?.(item) ?? false}
                isSelectionMode={isSelectionMode}
                onReclassify={onReclassify}
                onToggleSelection={onToggleSelection}
              />
            );
          })}
          {items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className={cn(
                "w-12 h-12 rounded-full flex items-center justify-center mb-3",
                stage.type === "filing" ? "bg-blue-100 dark:bg-blue-900/30" : "bg-emerald-100 dark:bg-emerald-900/30"
              )}>
                <span className="text-2xl">📋</span>
              </div>
              <p className="text-sm text-muted-foreground font-medium">
                Sin items
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Arrastra aquí para mover
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
