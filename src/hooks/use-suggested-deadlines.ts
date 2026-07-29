/**
 * Deadlines suggested by email evidence (status = 'SUGGESTED_BY_EMAIL').
 *
 * Nothing becomes an active término without an explicit user confirmation:
 * confirm promotes the row to PENDING, dismiss deletes it.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useSuggestedDeadlineActions(workItemId: string | undefined | null) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["work-item-deadlines", workItemId] });
    queryClient.invalidateQueries({ queryKey: ["work-item-timeline", workItemId] });
    queryClient.invalidateQueries({ queryKey: ["email-link-effects", workItemId] });
  };

  const confirm = useMutation({
    mutationFn: async (deadlineId: string) => {
      const { error } = await supabase
        .from("work_item_deadlines")
        .update({ status: "PENDING", updated_at: new Date().toISOString() })
        .eq("id", deadlineId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Término confirmado");
      invalidate();
    },
    onError: () => toast.error("No se pudo confirmar el término"),
  });

  const dismiss = useMutation({
    mutationFn: async (deadlineId: string) => {
      const { error } = await supabase.from("work_item_deadlines").delete().eq("id", deadlineId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.info("Sugerencia de término descartada");
      invalidate();
    },
    onError: () => toast.error("No se pudo descartar la sugerencia"),
  });

  return { confirm, dismiss };
}
