/**
 * Hook to trigger actuaciones normalization into process_events
 * Uses the normalize-actuaciones edge function
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface NormalizeParams {
  monitored_process_id?: string;
  filing_id?: string;
  radicado?: string;
  force_reprocess?: boolean;
}

interface NormalizationResult {
  ok: boolean;
  run_id: string;
  counts: {
    ingested: number;
    existing: number;
    inserted: number;
    errors: number;
  };
  errors?: string[];
}

export function useNormalizeActuaciones() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: NormalizeParams): Promise<NormalizationResult> => {
      // Get current user
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error("No autenticado");
      }

      const { data, error } = await supabase.functions.invoke("normalize-actuaciones", {
        body: {
          ...params,
          owner_id: user.id,
        },
      });

      if (error) {
        throw error;
      }

      if (!data.ok) {
        throw new Error(data.error || "Error en normalización");
      }

      return data as NormalizationResult;
    },
    onSuccess: (data, variables) => {
      const { counts } = data;
      
      if (counts.inserted > 0) {
        toast.success(
          `Normalización completada: ${counts.inserted} eventos nuevos`,
          {
            description: `De ${counts.ingested} actuaciones, ${counts.existing} ya existían.`,
          }
        );
      } else if (counts.ingested > 0) {
        toast.info("Sin nuevos eventos", {
          description: `Las ${counts.ingested} actuaciones ya estaban normalizadas.`,
        });
      } else {
        toast.info("Sin actuaciones para normalizar");
      }

      // Invalidate relevant queries
      if (variables.monitored_process_id) {
        queryClient.invalidateQueries({ 
          queryKey: ["work-item-events"] 
        });
        queryClient.invalidateQueries({ 
          queryKey: ["process-events", variables.monitored_process_id] 
        });
      }
      if (variables.filing_id) {
        queryClient.invalidateQueries({ 
          queryKey: ["work-item-events"] 
        });
        queryClient.invalidateQueries({ 
          queryKey: ["process-events", variables.filing_id] 
        });
      }
    },
    onError: (error) => {
      console.error("Normalization error:", error);
      toast.error("Error al normalizar actuaciones", {
        description: error instanceof Error ? error.message : "Error desconocido",
      });
    },
  });
}
