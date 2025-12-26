import { useDroppable } from "@dnd-kit/core";
import { AdminPipelineCard, AdminItem } from "./AdminPipelineCard";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface AdminStageConfig {
  id: string;
  label: string;
  shortLabel: string;
  color: string;
}

interface AdminPipelineColumnProps {
  stage: AdminStageConfig;
  items: AdminItem[];
  focusedItemId?: string | null;
  isSelectionMode?: boolean;
  isItemSelected?: (item: AdminItem) => boolean;
  onToggleSelection?: (item: AdminItem, shiftKey: boolean) => void;
}

const STAGE_COLORS: Record<string, string> = {
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

export function AdminPipelineColumn({ 
  stage, 
  items,
  focusedItemId,
  isSelectionMode = false,
  isItemSelected,
  onToggleSelection,
}: AdminPipelineColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
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
        {/* Header */}
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
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full inline-flex items-center gap-1 w-fit text-blue-700 bg-blue-100 dark:bg-blue-900/50 dark:text-blue-300">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              Administrativo
            </span>
          </div>
          <div className={cn(
            "flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold",
            items.length > 0 
              ? "bg-blue-500 text-white"
              : "bg-muted text-muted-foreground"
          )}>
            {items.length}
          </div>
        </div>
        
        {/* Cards */}
        <div className="space-y-3">
          {items.map((item) => {
            const itemKey = `admin:${item.id}`;
            return (
              <AdminPipelineCard 
                key={itemKey} 
                item={item}
                isFocused={focusedItemId === itemKey}
                isSelected={isItemSelected?.(item) ?? false}
                isSelectionMode={isSelectionMode}
                onToggleSelection={onToggleSelection}
              />
            );
          })}
          {items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3 bg-blue-100 dark:bg-blue-900/30">
                <span className="text-2xl">📋</span>
              </div>
              <p className="text-sm text-muted-foreground font-medium">
                Sin procesos
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
