/**
 * "Línea procesal" — prominent section under the work item header.
 * Combines the canonical phase stepper, the required-action card and the
 * unified chronological timeline.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Route } from "lucide-react";
import { PhaseStepper, type PhaseReach } from "./PhaseStepper";
import { AccionRequerida } from "./AccionRequerida";
import { TimelineFeed } from "./TimelineFeed";
import { mapStageToCanonicalPhase } from "@/lib/workflow-phases";
import type { WorkflowType, CGPPhase } from "@/lib/workflow-constants";

interface LineaProcesalProps {
  workItemId: string;
  workflowType: WorkflowType;
  currentStage: string | null;
  cgpPhase: CGPPhase | null;
}

function sourceOf(changeSource: string | null): PhaseReach["source"] {
  if (!changeSource) return "MANUAL";
  if (changeSource.includes("SUGGESTION")) return "ACTUACION";
  return "MANUAL";
}

export function LineaProcesal({ workItemId, workflowType, currentStage, cgpPhase }: LineaProcesalProps) {
  const { data: reaches = [] } = useQuery({
    queryKey: ["work-item-phase-reaches", workItemId, workflowType],
    queryFn: async (): Promise<PhaseReach[]> => {
      const { data, error } = await supabase
        .from("work_item_stage_audit")
        .select("new_stage, change_source, created_at, metadata")
        .eq("work_item_id", workItemId)
        .order("created_at", { ascending: true });
      if (error) {
        console.error("[linea-procesal] stage audit", error);
        return [];
      }
      const first = new Map<string, PhaseReach>();
      for (const row of data ?? []) {
        const phaseKey = mapStageToCanonicalPhase(workflowType, row.new_stage);
        if (!phaseKey || first.has(phaseKey)) continue;
        const meta = (row.metadata ?? {}) as Record<string, unknown>;
        const isEmail = meta.source_type === "EMAIL";
        first.set(phaseKey, {
          phaseKey,
          reachedAt: row.created_at,
          source: isEmail ? "CORREO" : sourceOf(row.change_source),
        });
      }
      return [...first.values()];
    },
    enabled: !!workItemId,
    staleTime: 60_000,
  });

  return (
    <section className="space-y-4" aria-labelledby="linea-procesal-heading">
      <h2 id="linea-procesal-heading" className="flex items-center gap-2 text-lg font-semibold">
        <Route className="h-5 w-5 text-primary" aria-hidden />
        Línea procesal
      </h2>
      <PhaseStepper workflowType={workflowType} currentStage={currentStage} reaches={reaches} />
      <AccionRequerida workItemId={workItemId} workflowType={workflowType} cgpPhase={cgpPhase} />
      <TimelineFeed workItemId={workItemId} />
    </section>
  );
}
