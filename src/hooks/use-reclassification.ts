// Stub for reclassification hook - functionality moved to work items
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type WorkflowType = Database["public"]["Tables"]["work_items"]["Row"]["workflow_type"];

export function useReclassification() {
  const queryClient = useQueryClient();

  const reclassifyMutation = useMutation({
    mutationFn: async ({ workItemId, newWorkflowType }: { workItemId: string; newWorkflowType: WorkflowType }) => {
      const { error } = await supabase
        .from("work_items")
        .update({ workflow_type: newWorkflowType })
        .eq("id", workItemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      toast.success("Proceso reclasificado exitosamente");
    },
    onError: (error: Error) => {
      toast.error("Error al reclasificar: " + error.message);
    },
  });

  return {
    reclassify: reclassifyMutation.mutate,
    isReclassifying: reclassifyMutation.isPending,
    isPending: reclassifyMutation.isPending,
  };
}
