import { useDroppable } from "@dnd-kit/core";
import { ProcessPipelineCard } from "./ProcessPipelineCard";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProcessPhase } from "@/lib/constants";
import { PROCESS_PHASES } from "@/lib/constants";

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
}

interface ProcessPipelineColumnProps {
  phase: ProcessPhase;
  processes: MonitoredProcess[];
}

const PHASE_COLORS: Record<string, string> = {
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

export function ProcessPipelineColumn({ phase, processes }: ProcessPipelineColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: phase,
  });

  const phaseConfig = PROCESS_PHASES[phase];
  const colorClass = PHASE_COLORS[phaseConfig.color] || PHASE_COLORS.blue;
  const badgeClass = BADGE_COLORS[phaseConfig.color] || BADGE_COLORS.blue;

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
          <Badge variant="outline" className={`text-xs ${badgeClass}`}>
            {phaseConfig.shortLabel}
          </Badge>
          <span className="text-xs text-muted-foreground font-medium">
            {processes.length}
          </span>
        </div>
        <div className="space-y-2">
          {processes.map((process) => (
            <ProcessPipelineCard key={process.id} process={process} />
          ))}
          {processes.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              Arrastra aquí
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
