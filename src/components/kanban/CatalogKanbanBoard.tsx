/**
 * Fase 4 / C — catalog-driven board for governed workflows.
 *
 * Columns come from `workflow_stages_global`, moves are validated against
 * `workflow_stage_transitions`, and attention conditions are rendered as
 * badges on the card (never as columns).
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { UnifiedKanbanBoard, type KanbanStage } from "./UnifiedKanbanBoard";
import { CatalogKanbanCard, type CatalogCardItem } from "./CatalogKanbanCard";
import {
  BAND_COLOR,
  BAND_LABEL,
  evaluateMove,
  useAttentionConditions,
  useCatalogStages,
  useCatalogTransitions,
  type AttentionCondition,
} from "@/hooks/use-workflow-catalog-board";

export interface CatalogKanbanBoardProps {
  workflowType: string;
  items: CatalogCardItem[];
  isLoading?: boolean;
  /** Persists the stage change once the catalog has allowed the move. */
  onStageChange: (itemId: string, toStageCode: string) => Promise<void> | void;
  invalidateQueries?: string[][];
}

export function CatalogKanbanBoard({
  workflowType,
  items,
  isLoading,
  onStageChange,
  invalidateQueries,
}: CatalogKanbanBoardProps) {
  const navigate = useNavigate();
  const {
    data: stages = [],
    isLoading: stagesLoading,
    error: stagesError,
  } = useCatalogStages(workflowType);
  const { data: transitions = [], error: transitionsError } = useCatalogTransitions(workflowType);
  const { data: conditions = [] } = useAttentionConditions(workflowType);
  const catalogError = stagesError ?? transitionsError;

  const byItem = useMemo(() => {
    const map = new Map<string, AttentionCondition[]>();
    for (const c of conditions) {
      const list = map.get(c.workItemId) ?? [];
      list.push(c);
      map.set(c.workItemId, list);
    }
    return map;
  }, [conditions]);

  const kanbanStages: KanbanStage[] = useMemo(
    () =>
      stages.map((s) => ({
        id: s.code,
        label: s.label,
        shortLabel: s.label,
        color: s.lifecycleBand ? BAND_COLOR[s.lifecycleBand] : "slate",
        description: s.lifecycleBand ? BAND_LABEL[s.lifecycleBand] : undefined,
        phase: s.lifecycleBand ?? undefined,
      })),
    [stages],
  );

  return (
    <UnifiedKanbanBoard
      stages={kanbanStages}
      items={items}
      isLoading={isLoading || stagesLoading}
      invalidateQueries={invalidateQueries}
      onStageDrop={async (itemId, newStageId, item) => {
        const verdict = evaluateMove(transitions, item.stage, newStageId);
        if (!verdict.allowed) {
          toast.error(verdict.reason);
          return;
        }
        await onStageChange(itemId, newStageId);
        if (verdict.isRegression) {
          toast.warning("Retroceso de etapa registrado con su justificación.");
        }
      }}
      renderCard={(item, opts) => (
        <CatalogKanbanCard
          item={item}
          conditions={byItem.get(item.id) ?? []}
          isDragging={opts.isDragging}
          onOpen={(id) => navigate(`/app/work-items/${id}`)}
        />
      )}
    />
  );
}
