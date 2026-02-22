/**
 * HearingTimeline — Left panel: ordered hearing steps for a work item
 */
import { Button } from "@/components/ui/button";
import { Plus, Scale } from "lucide-react";
import { HearingTimelineItem } from "./HearingTimelineItem";
import type { WorkItemHearing } from "@/hooks/use-work-item-hearings-v2";

interface Props {
  hearings: WorkItemHearing[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddClick: () => void;
}

export function HearingTimeline({ hearings, selectedId, onSelect, onAddClick }: Props) {
  if (hearings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Scale className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <p className="text-sm text-muted-foreground mb-4">
          No hay audiencias registradas para este proceso.
        </p>
        <Button variant="outline" size="sm" onClick={onAddClick}>
          <Plus className="h-4 w-4 mr-1" />
          Agregar audiencia
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1 mb-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Audiencias ({hearings.length})
        </h3>
        <Button variant="ghost" size="sm" className="h-7" onClick={onAddClick}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Timeline connector */}
      <div className="relative">
        <div className="absolute left-[22px] top-2 bottom-2 w-px bg-border" />
        <div className="space-y-0.5">
          {hearings.map((hearing) => (
            <HearingTimelineItem
              key={hearing.id}
              hearing={hearing}
              isSelected={selectedId === hearing.id}
              onClick={() => onSelect(hearing.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
