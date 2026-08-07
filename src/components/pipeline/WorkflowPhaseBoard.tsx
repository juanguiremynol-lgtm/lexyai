/**
 * WorkflowPhaseBoard — generic kanban driven by the canonical phase catalogue
 * (iteration 37).
 *
 * Any practised workflow without a bespoke pipeline renders here, with its
 * columns taken from WORKFLOW_PHASES (the single catalogue). An enabled area
 * with no matters renders its columns plus an explicit empty state — silence
 * about a board is indistinguishable from the board not existing.
 */
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Info, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { UnifiedKanbanBoard, type KanbanStage } from "@/components/kanban/UnifiedKanbanBoard";
import { WorkItemPipelineCard, type WorkItemPipelineItem } from "./WorkItemPipelineCard";
import { WorkflowSuggestionsPanel } from "./WorkflowSuggestionsPanel";
import { getWorkflowPhases, mapStageToCanonicalPhase } from "@/lib/workflow-phases";
import { phaseColor } from "@/lib/phase-palette";
import { WORKFLOW_TYPES, type WorkflowType } from "@/lib/workflow-constants";

interface WorkflowPhaseBoardProps {
  workflowType: WorkflowType;
}

export function WorkflowPhaseBoard({ workflowType }: WorkflowPhaseBoardProps) {
  const queryClient = useQueryClient();
  const [selectedIds] = useState<Set<string>>(new Set());

  const phases = useMemo(() => getWorkflowPhases(workflowType), [workflowType]);
  const stages: KanbanStage[] = useMemo(
    () =>
      phases.map((p, i) => ({
        id: p.key,
        label: p.label,
        shortLabel: p.label,
        // ITER42 — colour comes from the canonical phase, exactly like the
        // bespoke CGP board, so every board reads as the same object.
        color: phaseColor(p.key, i, { branch: p.branch }),
        description: p.branch ? "Terminación" : undefined,
      })),
    [phases],
  );

  const queryKey = ["work-items-phase-board", workflowType];

  const { data: items, isLoading, refetch } = useQuery({
    queryKey,
    queryFn: async (): Promise<WorkItemPipelineItem[]> => {
      const { data, error } = await supabase
        .from("work_items")
        .select(
          `id, workflow_type, stage, cgp_phase, status, radicado, title, authority_name,
           demandantes, demandados, is_flagged, last_action_date, last_checked_at,
           monitoring_enabled, lifecycle_state, auto_admisorio_date, created_at,
           client_id, clients(id, name)`,
        )
        .eq("workflow_type", workflowType as never)
        .neq("status", "CLOSED")
        .neq("status", "ARCHIVED")
        .is("deleted_at", null);
      if (error) throw error;
      return (data ?? []).map((item: Record<string, unknown>) => ({
        id: item.id as string,
        workflow_type: item.workflow_type as WorkItemPipelineItem["workflow_type"],
        stage:
          mapStageToCanonicalPhase(workflowType, item.stage as string | null) ??
          phases[0]?.key ??
          "PREPARACION",
        cgp_phase: null,
        radicado: (item.radicado as string) ?? null,
        title: (item.title as string) ?? null,
        client_id: (item.client_id as string) ?? null,
        client_name: ((item.clients as { name?: string } | null)?.name) ?? null,
        authority_name: (item.authority_name as string) ?? null,
        demandantes: item.demandantes as WorkItemPipelineItem["demandantes"],
        demandados: item.demandados as WorkItemPipelineItem["demandados"],
        is_flagged: (item.is_flagged as boolean) ?? false,
        last_action_date: (item.last_action_date as string) ?? null,
        last_checked_at: (item.last_checked_at as string) ?? null,
        monitoring_enabled: (item.monitoring_enabled as boolean) ?? false,
        lifecycle_state: (item.lifecycle_state as string) ?? null,
        auto_admisorio_date: (item.auto_admisorio_date as string) ?? null,
        created_at: item.created_at as string,
      })) as WorkItemPipelineItem[];
    },
  });

  const updateStage = useMutation({
    mutationFn: async ({ itemId, newStage }: { itemId: string; newStage: string }) => {
      const { error } = await supabase
        .from("work_items")
        .update({ stage: newStage, updated_at: new Date().toISOString() })
        .eq("id", itemId);
      if (error) throw error;
      return newStage;
    },
    onSuccess: (newStage) => {
      const label = phases.find((p) => p.key === newStage)?.label ?? newStage;
      toast.success(`Movido a: ${label}`);
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
    onError: () => toast.error("Error al actualizar etapa"),
  });

  const handleStageDrop = useCallback(
    async (itemId: string, newStageId: string) => {
      await updateStage.mutateAsync({ itemId, newStage: newStageId });
    },
    [updateStage],
  );

  const renderCard = useCallback(
    (item: WorkItemPipelineItem, options: { isDragging?: boolean; isFocused?: boolean }) => (
      <WorkItemPipelineCard item={item} isDragging={options.isDragging} isFocused={options.isFocused} />
    ),
    [],
  );

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-4">
        {phases.map((p) => (
          <Skeleton key={p.key} className="h-[420px] min-w-[280px]" />
        ))}
      </div>
    );
  }

  const total = items?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            Pipeline {WORKFLOW_TYPES[workflowType]?.shortLabel ?? workflowType}
          </h2>
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? "expediente activo" : "expedientes activos"} • {phases.length} etapas
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} title="Actualizar">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {total === 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Sin expedientes en esta área. El tablero está activo y sus etapas se muestran abajo; los
            asuntos aparecerán aquí al crearlos o al clasificarlos en este flujo.
          </AlertDescription>
        </Alert>
      )}

      <UnifiedKanbanBoard<WorkItemPipelineItem, KanbanStage>
        stages={stages}
        items={items ?? []}
        isLoading={false}
        onStageDrop={handleStageDrop}
        renderCard={renderCard}
        invalidateQueries={[queryKey as string[], ["work-items"]]}
        minColumnHeight="420px"
        selectedIds={selectedIds}
      />
    </div>
  );
}
