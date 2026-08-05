/**
 * use-work-item-tracks.ts — procedural tracks of a work item (iteration 32, part C).
 *
 * Tracks NEVER open automatically: `openTrack` is only called from an explicit
 * user confirmation of the art. 306 suggestion.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  implicitTrack,
  sortTracks,
  type ProceduralTrack,
  type TrackKind,
} from "@/lib/tracks/procedural-tracks";
import type { WorkflowType } from "@/lib/workflow-constants";

export function useWorkItemTracks(workItemId: string | undefined) {
  return useQuery({
    queryKey: ["work-item-tracks", workItemId],
    enabled: !!workItemId,
    queryFn: async (): Promise<ProceduralTrack[]> => {
      const { data, error } = await supabase
        .from("work_item_tracks")
        .select("*")
        .eq("work_item_id", workItemId!)
        .order("sequence_index", { ascending: true });
      if (error) throw error;
      return sortTracks((data ?? []) as unknown as ProceduralTrack[]);
    },
  });
}

/** Tracks with the implicit declarative track prepended when none is stored. */
export function useResolvedTracks(
  workItemId: string | undefined,
  workflowType: WorkflowType,
  stage: string | null | undefined,
) {
  const query = useWorkItemTracks(workItemId);
  const stored = query.data ?? [];
  const tracks =
    stored.length > 0 || !workItemId
      ? stored
      : [implicitTrack(workItemId, workflowType, stage)];
  return { ...query, tracks };
}

export function useOpenTrack(workItemId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      trackKind: TrackKind;
      workflowType: WorkflowType;
      openedByEvent?: string | null;
      startedAt?: string | null;
      currentPhase?: string | null;
      declarativeWorkflowType?: WorkflowType;
      declarativeStage?: string | null;
    }) => {
      if (!workItemId) throw new Error("work item requerido");
      const { data: existing, error: readErr } = await supabase
        .from("work_item_tracks")
        .select("id, sequence_index")
        .eq("work_item_id", workItemId);
      if (readErr) throw readErr;

      const rows: Record<string, unknown>[] = [];
      // Materialise the implicit declarative track once, so history is explicit.
      if (!existing || existing.length === 0) {
        rows.push({
          work_item_id: workItemId,
          track_kind: "DECLARATIVO",
          workflow_type: input.declarativeWorkflowType ?? "CGP",
          sequence_index: 0,
          current_phase: input.declarativeStage ?? null,
          status: "CLOSED",
          closed_at: new Date().toISOString(),
        });
      }
      rows.push({
        work_item_id: workItemId,
        track_kind: input.trackKind,
        workflow_type: input.workflowType,
        sequence_index: (existing?.length ?? 0) + rows.length,
        current_phase: input.currentPhase ?? null,
        status: "ACTIVE",
        started_at: input.startedAt ?? new Date().toISOString(),
        opened_by_event: input.openedByEvent ?? null,
      });

      const { error } = await supabase.from("work_item_tracks").insert(rows as never);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["work-item-tracks", workItemId] }),
  });
}
