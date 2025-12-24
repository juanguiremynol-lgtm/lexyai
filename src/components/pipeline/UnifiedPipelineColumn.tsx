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
  onReclassify?: (item: UnifiedItem) => void;
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
  onReclassify,
}: UnifiedPipelineColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
    data: { stageType: stage.type },
  });

  const colorClass = STAGE_COLORS[stage.color] || STAGE_COLORS.blue;
  const badgeClass = BADGE_COLORS[stage.color] || BADGE_COLORS.blue;

  return (
    <div className="flex-shrink-0 w-64">
      <div
        ref={setNodeRef}
        className={cn(
          "rounded-lg p-3 min-h-[400px] border transition-colors duration-200",
          colorClass,
          isOver && "ring-2 ring-primary/50 bg-primary/10"
        )}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1">
            <Badge variant="outline" className={`text-[10px] ${badgeClass}`}>
              {stage.shortLabel}
            </Badge>
            <span className={cn(
              "text-[9px] uppercase font-medium px-1 rounded",
              stage.type === "filing" ? "text-blue-600 bg-blue-500/10" : "text-emerald-600 bg-emerald-500/10"
            )}>
              {stage.type === "filing" ? "RAD" : "PRO"}
            </span>
          </div>
          <span className="text-xs text-muted-foreground font-medium">
            {items.length}
          </span>
        </div>
        <div className="space-y-2">
          {items.map((item) => (
            <UnifiedPipelineCard 
              key={`${item.type}:${item.id}`} 
              item={item}
              onReclassify={onReclassify}
            />
          ))}
          {items.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              Arrastra aquí
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
