/**
 * Hook for managing stage suggestions
 * 
 * Fetches pending suggestions from work_item_stage_suggestions table
 * and provides actions to apply, dismiss, or override suggestions.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { WorkflowType, CGPPhase } from "@/lib/workflow-constants";

export interface StageSuggestionRecord {
  id: string;
  work_item_id: string;
  organization_id: string;
  owner_id: string;
  source_type: 'ESTADO' | 'ACTUACION' | 'PUBLICACION' | 'TUTELA_EXPEDIENTE';
  event_fingerprint: string | null;
  suggested_stage: string | null;
  suggested_cgp_phase: string | null;
  suggested_pipeline_stage: string | null;
  confidence: number;
  reason: string | null;
  status: 'PENDING' | 'APPLIED' | 'DISMISSED';
  created_at: string;
  updated_at: string;
}

interface UseStageSuggestionOptions {
  workItemId: string;
  enabled?: boolean;
}

export function useStageSuggestion({ workItemId, enabled = true }: UseStageSuggestionOptions) {
  const queryClient = useQueryClient();

  // Fetch pending suggestion for this work item
  const { data: suggestion, isLoading, error } = useQuery({
    queryKey: ["stage-suggestion", workItemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_item_stage_suggestions")
        .select("*")
        .eq("work_item_id", workItemId)
        .eq("status", "PENDING")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as StageSuggestionRecord | null;
    },
    enabled: enabled && !!workItemId,
    staleTime: 30_000, // 30 seconds
  });

  // Apply suggestion mutation
  const applyMutation = useMutation({
    mutationFn: async (params: {
      suggestionId: string;
      workItemId: string;
      suggestedStage: string | null;
      suggestedCgpPhase: string | null;
      suggestedPipelineStage: string | null;
    }) => {
      // Start transaction-like operations
      const updates: Record<string, unknown> = {};
      
      if (params.suggestedStage) {
        updates.stage = params.suggestedStage;
      }
      if (params.suggestedCgpPhase) {
        updates.cgp_phase = params.suggestedCgpPhase;
      }
      if (params.suggestedPipelineStage) {
        updates.pipeline_stage = parseInt(params.suggestedPipelineStage, 10);
      }

      // Update work item
      if (Object.keys(updates).length > 0) {
        const { error: workItemError } = await supabase
          .from("work_items")
          .update(updates)
          .eq("id", params.workItemId);

        if (workItemError) throw workItemError;
      }

      // Mark suggestion as applied
      const { error: suggestionError } = await supabase
        .from("work_item_stage_suggestions")
        .update({ status: "APPLIED", updated_at: new Date().toISOString() })
        .eq("id", params.suggestionId);

      if (suggestionError) throw suggestionError;

      return params;
    },
    onSuccess: () => {
      toast.success("Etapa actualizada correctamente");
      queryClient.invalidateQueries({ queryKey: ["stage-suggestion", workItemId] });
      queryClient.invalidateQueries({ queryKey: ["work-item", workItemId] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
    onError: (error: Error) => {
      toast.error("Error al aplicar sugerencia: " + error.message);
    },
  });

  // Dismiss suggestion mutation
  const dismissMutation = useMutation({
    mutationFn: async (suggestionId: string) => {
      const { error } = await supabase
        .from("work_item_stage_suggestions")
        .update({ status: "DISMISSED", updated_at: new Date().toISOString() })
        .eq("id", suggestionId);

      if (error) throw error;
      return suggestionId;
    },
    onSuccess: () => {
      toast.info("Sugerencia descartada");
      queryClient.invalidateQueries({ queryKey: ["stage-suggestion", workItemId] });
    },
    onError: (error: Error) => {
      toast.error("Error al descartar: " + error.message);
    },
  });

  // Manual override mutation
  const overrideMutation = useMutation({
    mutationFn: async (params: {
      workItemId: string;
      newStage: string;
      newCgpPhase?: CGPPhase | null;
      suggestionId?: string;
    }) => {
      const updates: Record<string, unknown> = { stage: params.newStage };
      if (params.newCgpPhase) {
        updates.cgp_phase = params.newCgpPhase;
      }

      const { error: workItemError } = await supabase
        .from("work_items")
        .update(updates)
        .eq("id", params.workItemId);

      if (workItemError) throw workItemError;

      // If there was a pending suggestion, dismiss it
      if (params.suggestionId) {
        await supabase
          .from("work_item_stage_suggestions")
          .update({ status: "DISMISSED", updated_at: new Date().toISOString() })
          .eq("id", params.suggestionId);
      }

      return params;
    },
    onSuccess: () => {
      toast.success("Etapa actualizada manualmente");
      queryClient.invalidateQueries({ queryKey: ["stage-suggestion", workItemId] });
      queryClient.invalidateQueries({ queryKey: ["work-item", workItemId] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
    onError: (error: Error) => {
      toast.error("Error al actualizar etapa: " + error.message);
    },
  });

  return {
    suggestion,
    isLoading,
    error,
    apply: (params: Parameters<typeof applyMutation.mutate>[0]) => applyMutation.mutate(params),
    dismiss: (suggestionId: string) => dismissMutation.mutate(suggestionId),
    override: (params: Parameters<typeof overrideMutation.mutate>[0]) => overrideMutation.mutate(params),
    isApplying: applyMutation.isPending,
    isDismissing: dismissMutation.isPending,
    isOverriding: overrideMutation.isPending,
  };
}

/**
 * Create a new stage suggestion
 */
export async function createStageSuggestion(params: {
  workItemId: string;
  organizationId: string;
  ownerId: string;
  sourceType: 'ESTADO' | 'ACTUACION' | 'PUBLICACION' | 'TUTELA_EXPEDIENTE';
  eventFingerprint?: string;
  suggestedStage: string | null;
  suggestedCgpPhase: string | null;
  suggestedPipelineStage: number | null;
  confidence: number;
  reason: string;
}): Promise<{ success: boolean; id?: string; error?: string; alreadyExists?: boolean }> {
  try {
    // First check for existing PENDING suggestion with same fingerprint
    // This is a defensive check in addition to the unique partial index
    if (params.eventFingerprint) {
      const { data: existing } = await supabase
        .from("work_item_stage_suggestions")
        .select("id")
        .eq("work_item_id", params.workItemId)
        .eq("event_fingerprint", params.eventFingerprint)
        .eq("status", "PENDING")
        .maybeSingle();
      
      if (existing) {
        console.log('[createStageSuggestion] Skipping - duplicate PENDING suggestion exists:', existing.id);
        return { success: true, id: existing.id, alreadyExists: true };
      }
    }

    const { data, error } = await supabase
      .from("work_item_stage_suggestions")
      .insert({
        work_item_id: params.workItemId,
        organization_id: params.organizationId,
        owner_id: params.ownerId,
        source_type: params.sourceType,
        event_fingerprint: params.eventFingerprint || null,
        suggested_stage: params.suggestedStage,
        suggested_cgp_phase: params.suggestedCgpPhase,
        suggested_pipeline_stage: params.suggestedPipelineStage?.toString() || null,
        confidence: params.confidence,
        reason: params.reason,
        status: "PENDING",
      })
      .select("id")
      .single();

    if (error) {
      // Check for duplicate constraint violation (23505 = unique_violation)
      if (error.code === "23505") {
        console.log('[createStageSuggestion] Skipping - unique constraint violation (duplicate)');
        return { success: true, id: undefined, alreadyExists: true };
      }
      throw error;
    }

    console.log('[createStageSuggestion] Created new suggestion:', {
      id: data.id,
      workItemId: params.workItemId,
      suggestedStage: params.suggestedStage,
      confidence: params.confidence,
    });

    return { success: true, id: data.id };
  } catch (err) {
    console.error("[createStageSuggestion] Error:", err);
    return { 
      success: false, 
      error: err instanceof Error ? err.message : "Unknown error" 
    };
  }
}
