/**
 * DemoPipelineKanban — Full Kanban board for the demo sandbox
 * 
 * Reuses UnifiedKanbanBoard with in-memory state from DemoPipelineContext.
 * Category-aware stages, drag & drop, card interactions — all demo-safe.
 */

import { useCallback, useMemo } from "react";
import { UnifiedKanbanBoard, type KanbanStage } from "@/components/kanban/UnifiedKanbanBoard";
import { useDemoPipeline, type DemoWorkItem } from "./DemoPipelineContext";
import { getDemoStages } from "./demo-pipeline-stages";
import { DemoPipelineCard } from "./DemoPipelineCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";

export function DemoPipelineKanban() {
  const { items, moveItem, reset, openDetail, deleteItem } = useDemoPipeline();

  // Determine category from first non-sample item
  const mainItem = items.find(i => !i.isSample);
  const category = mainItem?.category || "UNCERTAIN";

  const stages = useMemo(() => getDemoStages(category), [category]);

  const handleStageDrop = useCallback(async (itemId: string, newStageId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const stage = stages.find(s => s.id === newStageId);
    moveItem(itemId, newStageId);
    toast.success(`Movido a: ${stage?.shortLabel || newStageId}`, {
      description: "Demo — este cambio no se guarda",
      duration: 2000,
    });
  }, [items, stages, moveItem]);

  const renderCard = useCallback((item: DemoWorkItem, options: { isDragging?: boolean }) => (
    <DemoPipelineCard
      item={item}
      isDragging={options.isDragging}
      onOpen={() => openDetail(item.id)}
      onDelete={() => deleteItem(item.id)}
    />
  ), [openDetail, deleteItem]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Pipeline interactivo</h3>
          <Badge variant="outline" className="text-xs">
            Demo Mode
          </Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5 h-7"
          onClick={reset}
        >
          <RotateCcw className="h-3 w-3" />
          Reset demo
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Arrastra las tarjetas entre columnas. Haz clic en una tarjeta para ver el detalle completo.
        Los cambios son solo demostrativos y no se guardan.
      </p>

      {/* Kanban Board — same component as production */}
      <UnifiedKanbanBoard<DemoWorkItem, KanbanStage>
        stages={stages}
        items={items}
        onStageDrop={handleStageDrop}
        renderCard={renderCard}
        minColumnHeight="280px"
      />
    </div>
  );
}
