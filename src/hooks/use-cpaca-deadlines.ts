/**
 * Hook for managing CPACA deadlines
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  generateCpacaDeadlines,
  saveCpacaDeadlinesWithAlerts,
  getPendingDeadlinesWithUrgency,
  markDeadlineAsMet,
  recalculateCpacaDeadlines,
  type WorkItemDeadline,
} from "@/lib/cpaca-deadline-service";
import type { CpacaPhase } from "@/lib/cpaca-constants";

export function useCpacaDeadlines(workItemId: string | undefined) {
  const queryClient = useQueryClient();

  // Fetch deadlines with urgency
  const deadlinesQuery = useQuery({
    queryKey: ["cpaca-deadlines", workItemId],
    queryFn: async () => {
      if (!workItemId) return [];
      return getPendingDeadlinesWithUrgency(workItemId);
    },
    enabled: !!workItemId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Fetch all deadlines (including met/cancelled)
  const allDeadlinesQuery = useQuery({
    queryKey: ["cpaca-deadlines-all", workItemId],
    queryFn: async () => {
      if (!workItemId) return [];
      
      const { data, error } = await supabase
        .from("work_item_deadlines")
        .select("*")
        .eq("work_item_id", workItemId)
        .order("deadline_date", { ascending: true });
      
      if (error) throw error;
      return data;
    },
    enabled: !!workItemId,
  });

  // Generate deadlines mutation
  const generateMutation = useMutation({
    mutationFn: async (params: {
      workItemId: string;
      ownerId: string;
      cpacaData: {
        phase: CpacaPhase;
        fecha_envio_notificacion_electronica?: string | null;
        prorroga_traslado_demanda?: boolean;
        fecha_notificacion_excepciones?: string | null;
        fecha_notificacion_sentencia?: string | null;
        fecha_notificacion_auto?: string | null;
        fecha_radicacion_conciliacion?: string | null;
        fecha_vencimiento_caducidad?: string | null;
      };
      workItemTitle: string;
    }) => {
      const deadlines = await generateCpacaDeadlines(
        params.workItemId,
        params.ownerId,
        params.cpacaData
      );
      
      return saveCpacaDeadlinesWithAlerts(
        params.workItemId,
        params.ownerId,
        deadlines,
        params.workItemTitle
      );
    },
    onSuccess: (result) => {
      toast.success(`${result.deadlinesCreated} plazos y ${result.alertsCreated} alertas creadas`);
      queryClient.invalidateQueries({ queryKey: ["cpaca-deadlines", workItemId] });
      queryClient.invalidateQueries({ queryKey: ["cpaca-deadlines-all", workItemId] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
    onError: (error) => {
      toast.error("Error al generar plazos", { description: error.message });
    },
  });

  // Recalculate deadlines mutation
  const recalculateMutation = useMutation({
    mutationFn: async () => {
      if (!workItemId) throw new Error("No work item ID");
      await recalculateCpacaDeadlines(workItemId);
    },
    onSuccess: () => {
      toast.success("Plazos recalculados");
      queryClient.invalidateQueries({ queryKey: ["cpaca-deadlines", workItemId] });
      queryClient.invalidateQueries({ queryKey: ["cpaca-deadlines-all", workItemId] });
    },
    onError: (error) => {
      toast.error("Error al recalcular plazos", { description: error.message });
    },
  });

  // Mark deadline as met mutation
  const markMetMutation = useMutation({
    mutationFn: async (deadlineId: string) => {
      await markDeadlineAsMet(deadlineId);
    },
    onSuccess: () => {
      toast.success("Plazo marcado como cumplido");
      queryClient.invalidateQueries({ queryKey: ["cpaca-deadlines", workItemId] });
      queryClient.invalidateQueries({ queryKey: ["cpaca-deadlines-all", workItemId] });
    },
    onError: (error) => {
      toast.error("Error al actualizar plazo", { description: error.message });
    },
  });

  return {
    deadlines: deadlinesQuery.data || [],
    allDeadlines: allDeadlinesQuery.data || [],
    isLoading: deadlinesQuery.isLoading,
    isLoadingAll: allDeadlinesQuery.isLoading,
    generate: generateMutation.mutate,
    isGenerating: generateMutation.isPending,
    recalculate: recalculateMutation.mutate,
    isRecalculating: recalculateMutation.isPending,
    markAsMet: markMetMutation.mutate,
    isMarkingMet: markMetMutation.isPending,
  };
}
