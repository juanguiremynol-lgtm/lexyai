import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { TutelaItem } from "./TutelaCard";
import type { TutelaPhase } from "@/lib/tutela-constants";

interface FalloOutcomeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tutela: TutelaItem | null;
  targetPhase: TutelaPhase;
}

export function FalloOutcomeDialog({
  open,
  onOpenChange,
  tutela,
  targetPhase,
}: FalloOutcomeDialogProps) {
  const queryClient = useQueryClient();

  const updateFalloMutation = useMutation({
    mutationFn: async (isFavorable: boolean) => {
      if (!tutela) return;

      // Determine the new status based on phase
      const newStatus = targetPhase === "FALLO_PRIMERA_INSTANCIA" 
        ? "ACTIVE" 
        : "CLOSED";

      // Update work_items instead of filings
      const { error } = await supabase
        .from("work_items")
        .update({
          status: newStatus,
          is_flagged: isFavorable, // Using is_flagged to track favorable outcome
        })
        .eq("id", tutela.id);

      if (error) throw error;

      // Create an alert for the user
      const { data: user } = await supabase.auth.getUser();
      if (user.user) {
        await supabase.from("alerts").insert({
          owner_id: user.user.id,
          severity: isFavorable ? "INFO" : "WARN",
          message: `Fallo de ${targetPhase === "FALLO_PRIMERA_INSTANCIA" ? "primera" : "segunda"} instancia: ${isFavorable ? "FAVORABLE" : "DESFAVORABLE"} - ${tutela.demandantes || "Accionante"} vs ${tutela.demandados || "Accionado"}`,
        });
      }

      return { isFavorable };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["tutelas"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      
      const outcomeText = result?.isFavorable ? "favorable" : "desfavorable";
      toast.success(`Fallo registrado como ${outcomeText}`);
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error("Error al registrar fallo: " + error.message);
    },
  });

  if (!tutela) return null;

  const phaseLabel = targetPhase === "FALLO_PRIMERA_INSTANCIA" 
    ? "Primera Instancia" 
    : "Segunda Instancia";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Resultado del Fallo - {phaseLabel}</DialogTitle>
          <DialogDescription>
            ¿El fallo de {phaseLabel.toLowerCase()} fue favorable para el accionante?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="text-sm text-muted-foreground">
            <p><strong>Radicado:</strong> {tutela.radicado || "Sin radicado"}</p>
            <p><strong>Accionante:</strong> {tutela.demandantes || "N/A"}</p>
            <p><strong>Accionado:</strong> {tutela.demandados || "N/A"}</p>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 h-20 flex-col gap-2 border-green-300 hover:bg-green-50 hover:border-green-500"
              onClick={() => updateFalloMutation.mutate(true)}
              disabled={updateFalloMutation.isPending}
            >
              {updateFalloMutation.isPending ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <>
                  <ThumbsUp className="h-6 w-6 text-green-600" />
                  <span className="text-green-700 font-medium">Favorable</span>
                </>
              )}
            </Button>
            
            <Button
              variant="outline"
              className="flex-1 h-20 flex-col gap-2 border-red-300 hover:bg-red-50 hover:border-red-500"
              onClick={() => updateFalloMutation.mutate(false)}
              disabled={updateFalloMutation.isPending}
            >
              {updateFalloMutation.isPending ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <>
                  <ThumbsDown className="h-6 w-6 text-red-600" />
                  <span className="text-red-700 font-medium">Desfavorable</span>
                </>
              )}
            </Button>
          </div>

          {targetPhase === "FALLO_PRIMERA_INSTANCIA" && (
            <p className="text-xs text-muted-foreground text-center">
              Si el fallo es favorable, el proceso puede terminar aquí. 
              Un fallo desfavorable permite impugnación a segunda instancia.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
