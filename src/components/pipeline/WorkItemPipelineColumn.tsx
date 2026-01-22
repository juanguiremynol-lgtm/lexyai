import { useDroppable } from "@dnd-kit/core";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WorkItemPipelineCard, WorkItemPipelineItem } from "./WorkItemPipelineCard";

export interface WorkItemStageConfig {
  id: string;
  label: string;
  shortLabel: string;
  color: string;
  phase: "FILING" | "PROCESS";
}

interface WorkItemPipelineColumnProps {
  stage: WorkItemStageConfig;
  items: WorkItemPipelineItem[];
  focusedItemId?: string | null;
  selectedItemIds?: Set<string>;
  isSelectionMode?: boolean;
  onReclassify?: (item: WorkItemPipelineItem) => void;
  onToggleSelection?: (item: WorkItemPipelineItem, shiftKey: boolean) => void;
  onToggleFlag?: (item: WorkItemPipelineItem) => void;
}

const colorMap: Record<string, string> = {
  amber: "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400",
  sky: "bg-sky-500/10 border-sky-500/30 text-sky-600 dark:text-sky-400",
  indigo: "bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-400",
  violet: "bg-violet-500/10 border-violet-500/30 text-violet-600 dark:text-violet-400",
  emerald: "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
  rose: "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400",
  blue: "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400",
  slate: "bg-slate-500/10 border-slate-500/30 text-slate-600 dark:text-slate-400",
  teal: "bg-teal-500/10 border-teal-500/30 text-teal-600 dark:text-teal-400",
  orange: "bg-orange-500/10 border-orange-500/30 text-orange-600 dark:text-orange-400",
};

export function WorkItemPipelineColumn({
  stage,
  items,
  focusedItemId,
  selectedItemIds = new Set(),
  isSelectionMode = false,
  onReclassify,
  onToggleSelection,
  onToggleFlag,
}: WorkItemPipelineColumnProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: stage.id,
    data: { stage },
  });

  const colorClass = colorMap[stage.color] || colorMap.slate;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col h-full min-w-[280px] max-w-[320px] rounded-lg border bg-card/50 transition-all duration-200",
        isOver && "ring-2 ring-primary bg-primary/5 scale-[1.01]"
      )}
    >
      {/* Header */}
      <div className={cn("px-3 py-2.5 border-b", colorClass)}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm truncate">{stage.shortLabel}</h3>
          <Badge 
            variant="secondary" 
            className={cn(
              "text-xs font-medium",
              colorClass
            )}
          >
            {items.length}
          </Badge>
        </div>
      </div>

      {/* Items */}
      <ScrollArea className="flex-1 px-2 py-2">
        <div className="space-y-2">
          {items.map((item) => (
            <WorkItemPipelineCard
              key={item.id}
              item={item}
              isFocused={focusedItemId === item.id}
              isSelected={selectedItemIds.has(item.id)}
              isSelectionMode={isSelectionMode}
              onReclassify={onReclassify}
              onToggleSelection={onToggleSelection}
              onToggleFlag={onToggleFlag}
            />
          ))}
          {items.length === 0 && (
            <div className="text-center py-6 text-muted-foreground text-sm">
              Sin elementos
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
