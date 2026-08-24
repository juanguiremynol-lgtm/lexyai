/**
 * CatalogBoardContainer — generic consumer of the governed stage catalog.
 *
 * Columns come from `workflow_stages_global` (via CatalogKanbanBoard); this
 * container only supplies the matters and persists an allowed stage move.
 * No stage vocabulary is hard-coded here.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CatalogKanbanBoard } from "@/components/kanban/CatalogKanbanBoard";
import type { CatalogCardItem } from "@/components/kanban/CatalogKanbanCard";
import { useCatalogStages } from "@/hooks/use-workflow-catalog-board";
import type { WorkflowType } from "@/lib/workflow-constants";

interface Props {
  workflowType: WorkflowType;
}

interface DeadlineRow {
  work_item_id: string;
  label: string | null;
  deadline_date: string | null;
}

const OPEN_DEADLINE_STATUSES = ["PENDING", "PENDING_REVIEW", "SUGGESTED_BY_PROVIDER"];

export function CatalogBoardContainer({ workflowType }: Props) {
  const queryClient = useQueryClient();
  const queryKey = ["catalog-board-items", workflowType];
  const { data: stages = [] } = useCatalogStages(workflowType);

  const stageLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stages) m.set(s.code, s.label);
    return m;
  }, [stages]);

  const { data: rows, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_items")
        .select(
          "id, stage, radicado, title, authority_name, demandados, client_id, clients(name)",
        )
        .eq("workflow_type", workflowType as never)
        .neq("status", "CLOSED")
        .neq("status", "ARCHIVED")
        .is("deleted_at", null);
      if (error) throw error;
      const items = (data ?? []) as Array<Record<string, unknown>>;

      let deadlines: DeadlineRow[] = [];
      if (items.length > 0) {
        const { data: dl } = await supabase
          .from("work_item_deadlines")
          .select("work_item_id, label, deadline_date")
          .in("work_item_id", items.map((i) => i.id as string))
          .in("status", OPEN_DEADLINE_STATUSES)
          .not("deadline_date", "is", null)
          .order("deadline_date", { ascending: true });
        deadlines = (dl ?? []) as DeadlineRow[];
      }
      const nextByItem = new Map<string, DeadlineRow>();
      for (const d of deadlines) {
        if (!nextByItem.has(d.work_item_id)) nextByItem.set(d.work_item_id, d);
      }

      return items.map((item) => {
        const d = nextByItem.get(item.id as string) ?? null;
        const demandados = item.demandados as unknown;
        const counterparty =
          (Array.isArray(demandados) && demandados.length > 0
            ? typeof demandados[0] === "string"
              ? (demandados[0] as string)
              : ((demandados[0] as { nombre?: string })?.nombre ?? null)
            : null) ??
          (item.authority_name as string | null) ??
          ((item.clients as { name?: string } | null)?.name ?? null);
        return {
          id: item.id as string,
          stage: (item.stage as string) ?? "",
          identifier: (item.radicado as string | null) ?? (item.title as string | null),
          counterparty,
          nextDeadlineLabel: d?.label ?? null,
          nextDeadlineDate: d?.deadline_date ?? null,
        };
      });
    },
  });

  const items: CatalogCardItem[] = useMemo(
    () =>
      (rows ?? []).map((r) => ({
        ...r,
        stageLabel: stageLabel.get(r.stage) ?? r.stage,
      })),
    [rows, stageLabel],
  );

  const updateStage = useMutation({
    mutationFn: async ({ itemId, stage }: { itemId: string; stage: string }) => {
      const { error } = await supabase
        .from("work_items")
        .update({ stage, updated_at: new Date().toISOString() })
        .eq("id", itemId);
      if (error) throw error;
      return stage;
    },
    onSuccess: (stage) => {
      toast.success(`Movido a: ${stageLabel.get(stage) ?? stage}`);
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
    onError: () => toast.error("No se pudo actualizar la etapa"),
  });

  return (
    <CatalogKanbanBoard
      workflowType={workflowType}
      items={items}
      isLoading={isLoading}
      invalidateQueries={[queryKey as string[], ["work-items"]]}
      onStageChange={async (itemId, toStageCode) => {
        await updateStage.mutateAsync({ itemId, stage: toStageCode });
      }}
    />
  );
}
