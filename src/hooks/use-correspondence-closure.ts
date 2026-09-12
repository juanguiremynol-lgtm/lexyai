/**
 * use-correspondence-closure — LV3. He decides; the system does not assert.
 *
 * A term closed by correspondence carries the email that closed it and waits
 * for the lawyer. Confirming records his judgement; reopening returns the term
 * to the state it had before the email touched it. Neither changes the date.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export function useCorrespondenceClosure(workItemId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { deadlineId: string; decision: "CONFIRM" | "REOPEN" }) => {
      const { data, error } = await supabase.rpc("decide_correspondence_closure", {
        p_deadline_id: vars.deadlineId,
        p_decision: vars.decision,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["work-item-deadlines", workItemId] });
      qc.invalidateQueries({ queryKey: ["work-item-deadlines-pending"] });
      toast({
        title: vars.decision === "CONFIRM" ? "Término confirmado" : "Término reabierto",
        description:
          vars.decision === "CONFIRM"
            ? "Queda registrado como cumplido por su decisión."
            : "Vuelve al estado que tenía antes de que el correo lo cerrara.",
      });
    },
    onError: (e: unknown) => {
      toast({
        title: "No se pudo registrar la decisión",
        description: e instanceof Error ? e.message : "Inténtelo de nuevo.",
        variant: "destructive",
      });
    },
  });
}
