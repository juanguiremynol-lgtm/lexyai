import { useDroppable } from "@dnd-kit/core";
import { KanbanCard } from "./KanbanCard";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { FilingStatus } from "@/lib/constants";

interface Filing {
  id: string;
  status: FilingStatus;
  filing_type: string;
  sla_acta_due_at: string | null;
  sla_court_reply_due_at: string | null;
  matter: { client_name: string; matter_name: string } | null;
}

interface KanbanColumnProps {
  status: FilingStatus;
  filings: Filing[];
  isOver: boolean;
}

export function KanbanColumn({ status, filings }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
  });

  return (
    <div className="flex-shrink-0 w-72">
      <div
        ref={setNodeRef}
        className={cn(
          "bg-muted/50 rounded-lg p-3 min-h-[400px] transition-colors duration-200",
          isOver && "bg-primary/10 ring-2 ring-primary/30"
        )}
      >
        <div className="flex items-center justify-between mb-3">
          <StatusBadge status={status} size="sm" />
          <span className="text-xs text-muted-foreground font-medium">
            {filings.length}
          </span>
        </div>
        <div className="space-y-2">
          {filings.map((filing) => (
            <KanbanCard key={filing.id} filing={filing} />
          ))}
          {filings.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              Arrastra aquí
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
