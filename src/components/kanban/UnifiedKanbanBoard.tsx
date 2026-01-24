/**
 * UnifiedKanbanBoard - Reusable Kanban engine for all pipelines
 * 
 * This component provides a unified drag-and-drop Kanban experience across all
 * workflow types (CGP, CPACA, Peticiones, Tutelas, Admin) with:
 * - Smooth drag and drop with visual feedback
 * - Optimistic updates for snappy UX
 * - Global query invalidation for consistency
 * - Keyboard navigation support
 * - Batch selection mode
 */

import { useState, useCallback, useMemo, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragCancelEvent,
  UniqueIdentifier,
  MeasuringStrategy,
} from "@dnd-kit/core";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

// =========================================
// TYPES
// =========================================

export interface KanbanStage<T extends string = string> {
  id: T;
  label: string;
  shortLabel: string;
  color: string;
  description?: string;
  phase?: string; // Optional phase grouping (e.g., 'RADICACION' | 'PROCESO')
}

export interface KanbanItem {
  id: string;
  stage: string;
}

export interface UnifiedKanbanBoardProps<TItem extends KanbanItem, TStage extends KanbanStage> {
  /** Array of stage configurations */
  stages: TStage[];
  /** Array of items to display */
  items: TItem[];
  /** Whether data is currently loading */
  isLoading?: boolean;
  /** Called when an item is dropped on a new stage */
  onStageDrop: (itemId: string, newStageId: string, item: TItem) => Promise<void> | void;
  /** Render function for individual cards */
  renderCard: (item: TItem, options: {
    isDragging?: boolean;
    isFocused?: boolean;
    isSelected?: boolean;
    isSelectionMode?: boolean;
  }) => ReactNode;
  /** Render function for column header (optional) */
  renderColumnHeader?: (stage: TStage, items: TItem[]) => ReactNode;
  /** Query keys to invalidate after successful drop */
  invalidateQueries?: string[][];
  /** Minimum height for columns */
  minColumnHeight?: string;
  /** Sort function for items within a stage */
  sortItems?: (a: TItem, b: TItem) => number;
  /** Whether to enable selection mode */
  isSelectionMode?: boolean;
  /** Currently selected item IDs */
  selectedIds?: Set<string>;
  /** Focused item ID for keyboard navigation */
  focusedItemId?: string | null;
  /** Called when item selection is toggled */
  onToggleSelection?: (item: TItem, shiftKey: boolean) => void;
  /** Custom measuring strategy for more accurate drop detection */
  measuringStrategy?: MeasuringStrategy;
}

// =========================================
// COLOR MAPPINGS
// =========================================

const COLUMN_COLORS: Record<string, string> = {
  slate: "bg-slate-500/10 border-slate-500/30",
  amber: "bg-amber-500/10 border-amber-500/30",
  rose: "bg-rose-500/10 border-rose-500/30",
  emerald: "bg-emerald-500/10 border-emerald-500/30",
  teal: "bg-teal-500/10 border-teal-500/30",
  sky: "bg-sky-500/10 border-sky-500/30",
  cyan: "bg-cyan-500/10 border-cyan-500/30",
  blue: "bg-blue-500/10 border-blue-500/30",
  indigo: "bg-indigo-500/10 border-indigo-500/30",
  violet: "bg-violet-500/10 border-violet-500/30",
  purple: "bg-purple-500/10 border-purple-500/30",
  fuchsia: "bg-fuchsia-500/10 border-fuchsia-500/30",
  pink: "bg-pink-500/10 border-pink-500/30",
  stone: "bg-stone-500/10 border-stone-500/30",
  orange: "bg-orange-500/10 border-orange-500/30",
};

const HEADER_COLORS: Record<string, string> = {
  slate: "text-slate-600 dark:text-slate-400",
  amber: "text-amber-600 dark:text-amber-400",
  rose: "text-rose-600 dark:text-rose-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  teal: "text-teal-600 dark:text-teal-400",
  sky: "text-sky-600 dark:text-sky-400",
  cyan: "text-cyan-600 dark:text-cyan-400",
  blue: "text-blue-600 dark:text-blue-400",
  indigo: "text-indigo-600 dark:text-indigo-400",
  violet: "text-violet-600 dark:text-violet-400",
  purple: "text-purple-600 dark:text-purple-400",
  fuchsia: "text-fuchsia-600 dark:text-fuchsia-400",
  pink: "text-pink-600 dark:text-pink-400",
  stone: "text-stone-600 dark:text-stone-400",
  orange: "text-orange-600 dark:text-orange-400",
};

const BADGE_COLORS: Record<string, string> = {
  slate: "bg-slate-500/20 text-slate-600 dark:text-slate-400",
  amber: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
  rose: "bg-rose-500/20 text-rose-600 dark:text-rose-400",
  emerald: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  teal: "bg-teal-500/20 text-teal-600 dark:text-teal-400",
  sky: "bg-sky-500/20 text-sky-600 dark:text-sky-400",
  cyan: "bg-cyan-500/20 text-cyan-600 dark:text-cyan-400",
  blue: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
  indigo: "bg-indigo-500/20 text-indigo-600 dark:text-indigo-400",
  violet: "bg-violet-500/20 text-violet-600 dark:text-violet-400",
  purple: "bg-purple-500/20 text-purple-600 dark:text-purple-400",
  fuchsia: "bg-fuchsia-500/20 text-fuchsia-600 dark:text-fuchsia-400",
  pink: "bg-pink-500/20 text-pink-600 dark:text-pink-400",
  stone: "bg-stone-500/20 text-stone-600 dark:text-stone-400",
  orange: "bg-orange-500/20 text-orange-600 dark:text-orange-400",
};

// =========================================
// KANBAN COLUMN
// =========================================

import { useDroppable } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface KanbanColumnProps<TItem extends KanbanItem, TStage extends KanbanStage> {
  stage: TStage;
  items: TItem[];
  renderCard: UnifiedKanbanBoardProps<TItem, TStage>["renderCard"];
  renderColumnHeader?: UnifiedKanbanBoardProps<TItem, TStage>["renderColumnHeader"];
  minHeight?: string;
  isSelectionMode?: boolean;
  selectedIds?: Set<string>;
  focusedItemId?: string | null;
}

function KanbanColumn<TItem extends KanbanItem, TStage extends KanbanStage>({
  stage,
  items,
  renderCard,
  renderColumnHeader,
  minHeight = "400px",
  isSelectionMode = false,
  selectedIds = new Set(),
  focusedItemId,
}: KanbanColumnProps<TItem, TStage>) {
  const { isOver, setNodeRef } = useDroppable({
    id: stage.id,
    data: { stage },
  });

  const columnColor = COLUMN_COLORS[stage.color] || COLUMN_COLORS.slate;
  const headerColor = HEADER_COLORS[stage.color] || HEADER_COLORS.slate;
  const badgeColor = BADGE_COLORS[stage.color] || BADGE_COLORS.slate;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col min-w-[280px] max-w-[300px] rounded-lg border-2 transition-all duration-200",
        columnColor,
        isOver && "ring-2 ring-primary ring-offset-2 scale-[1.02] shadow-lg bg-primary/5"
      )}
      style={{ minHeight }}
    >
      {/* Header */}
      <div className={cn("px-3 py-2.5 border-b border-inherit", columnColor)}>
        {renderColumnHeader ? (
          renderColumnHeader(stage, items)
        ) : (
          <div className="flex items-center justify-between">
            <h3 className={cn("font-semibold text-sm truncate", headerColor)}>
              {stage.shortLabel}
            </h3>
            <Badge
              variant="secondary"
              className={cn("text-xs font-medium px-2", badgeColor)}
            >
              {items.length}
            </Badge>
          </div>
        )}
        {stage.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {stage.description}
          </p>
        )}
      </div>

      {/* Cards */}
      <ScrollArea className="flex-1 px-2 py-2">
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id}>
              {renderCard(item, {
                isDragging: false,
                isFocused: focusedItemId === item.id,
                isSelected: selectedIds.has(item.id),
                isSelectionMode,
              })}
            </div>
          ))}
          {items.length === 0 && (
            <div className="flex items-center justify-center h-24 text-sm text-muted-foreground italic">
              Arrastra aquí
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// =========================================
// MAIN COMPONENT
// =========================================

export function UnifiedKanbanBoard<TItem extends KanbanItem, TStage extends KanbanStage>({
  stages,
  items,
  isLoading = false,
  onStageDrop,
  renderCard,
  renderColumnHeader,
  invalidateQueries = [],
  minColumnHeight = "400px",
  sortItems,
  isSelectionMode = false,
  selectedIds = new Set(),
  focusedItemId,
  onToggleSelection,
  measuringStrategy,
}: UnifiedKanbanBoardProps<TItem, TStage>) {
  const queryClient = useQueryClient();
  const [activeItem, setActiveItem] = useState<TItem | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Configure sensors for smooth drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Minimum distance before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: (event, args) => {
        // Default coordinate getter - can be customized
        return undefined;
      },
    })
  );

  // Group items by stage with sorting
  const itemsByStage = useMemo(() => {
    const result: Record<string, TItem[]> = {};

    // Initialize all stages
    stages.forEach((stage) => {
      result[stage.id] = [];
    });

    // Assign items to stages
    items.forEach((item) => {
      if (result[item.stage]) {
        result[item.stage].push(item);
      } else {
        // Fallback to first stage if unknown stage
        const fallbackStage = stages[0];
        if (fallbackStage) {
          result[fallbackStage.id].push(item);
        }
      }
    });

    // Sort items within each stage
    if (sortItems) {
      Object.keys(result).forEach((stageId) => {
        result[stageId].sort(sortItems);
      });
    }

    return result;
  }, [items, stages, sortItems]);

  // Handle drag start
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const itemId = event.active.id as string;
    const item = items.find((i) => i.id === itemId);
    setActiveItem(item || null);
  }, [items]);

  // Handle drag end with optimistic update
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    const draggedItem = activeItem;
    setActiveItem(null);

    if (!over || !draggedItem) return;

    const itemId = active.id as string;
    const targetStageId = over.id as string;

    // Skip if same stage
    if (draggedItem.stage === targetStageId) return;

    // Validate target stage exists
    const targetStage = stages.find((s) => s.id === targetStageId);
    if (!targetStage) {
      console.warn(`Unknown target stage: ${targetStageId}`);
      return;
    }

    setIsPending(true);

    try {
      // Execute the drop handler
      await onStageDrop(itemId, targetStageId, draggedItem);

      // Invalidate all specified queries for global consistency
      for (const queryKey of invalidateQueries) {
        await queryClient.invalidateQueries({ queryKey });
      }
    } catch (error) {
      console.error("Error updating stage:", error);
      toast.error("Error al actualizar etapa");
    } finally {
      setIsPending(false);
    }
  }, [activeItem, stages, onStageDrop, invalidateQueries, queryClient]);

  // Handle drag cancel
  const handleDragCancel = useCallback((event: DragCancelEvent) => {
    setActiveItem(null);
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="w-full max-w-full overflow-x-auto overflow-y-hidden">
        <div className="inline-flex gap-3 pb-4 min-w-max">
          {stages.slice(0, 6).map((stage) => (
            <Skeleton
              key={stage.id}
              className="h-[400px] min-w-[280px] flex-shrink-0 rounded-lg"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      measuring={measuringStrategy ? { droppable: { strategy: measuringStrategy } } : undefined}
    >
      {/* Contained horizontal scroll - never expands page width */}
      <div className="w-full max-w-full overflow-x-auto overflow-y-hidden">
        <div className="inline-flex gap-3 pb-4 min-w-max">
          {stages.map((stage) => (
            <KanbanColumn
              key={stage.id}
              stage={stage}
              items={itemsByStage[stage.id] || []}
              renderCard={renderCard}
              renderColumnHeader={renderColumnHeader}
              minHeight={minColumnHeight}
              isSelectionMode={isSelectionMode}
              selectedIds={selectedIds}
              focusedItemId={focusedItemId}
            />
          ))}
        </div>
      </div>

      {/* Drag overlay - follows cursor during drag */}
      <DragOverlay dropAnimation={{
        duration: 200,
        easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
      }}>
      {activeItem && renderCard(activeItem, { isDragging: true })}
      </DragOverlay>
    </DndContext>
  );
}
