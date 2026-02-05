import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Gavel, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { PeticionItem } from "./PeticionCard";

interface EscalateToTutelaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  peticion: PeticionItem | null;
}

export function EscalateToTutelaDialog({
  open,
  onOpenChange,
  peticion,
}: EscalateToTutelaDialogProps) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");

  const escalateMutation = useMutation({
    mutationFn: async () => {
      if (!peticion) throw new Error("No petición selected");
      
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No autenticado");

      // Create a matter for the tutela
      const { data: matter, error: matterError } = await supabase
        .from("matters")
        .insert({
          owner_id: user.user.id,
          client_name: peticion.clientName || "Cliente",
          matter_name: `Tutela - ${peticion.subject}`,
          notes: `Tutela derivada de petición no respondida.\nEntidad: ${peticion.entityName}\nAsunto original: ${peticion.subject}`,
        })
        .select()
        .single();

      if (matterError) throw matterError;

      // Create the tutela as a work_item
      const { data: workItem, error: workItemError } = await supabase
        .from("work_items")
        .insert({
          owner_id: user.user.id,
          matter_id: matter.id,
          workflow_type: "TUTELA",
          stage: "FILING",
          status: "ACTIVE",
          source: "MANUAL",
          title: `Tutela por vulneración al Derecho de Petición`,
          description: `Tutela por vulneración al Derecho de Petición.\n\nEntidad demandada: ${peticion.entityName}\nPetición original: ${peticion.subject}\n\n${notes}`,
          demandados: peticion.entityName,
          monitoring_enabled: true,
        })
        .select()
        .single();

      if (workItemError) throw workItemError;

      // Update the petición to mark as escalated
      const { error: updateError } = await supabase
        .from("peticiones")
        .update({
          escalated_to_tutela: true,
          tutela_work_item_id: workItem.id,
        })
        .eq("id", peticion.id);

      if (updateError) throw updateError;

      // Create alert for the escalation
      await supabase.from("peticion_alerts").insert({
        owner_id: user.user.id,
        peticion_id: peticion.id,
        alert_type: "UNANSWERED_ESCALATE",
        severity: "CRITICAL",
        message: `Petición escalada a Tutela: ${peticion.subject}`,
      });

      return workItem;
    },
    onSuccess: (workItem) => {
      queryClient.invalidateQueries({ queryKey: ["peticiones"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      toast.success("Tutela creada exitosamente", {
        description: "La petición ha sido escalada a proceso de tutela",
        action: {
          label: "Ver Tutela",
          onClick: () => window.location.href = `/app/work-items/${workItem.id}`,
        },
      });
      setNotes("");
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error("Error al escalar a tutela: " + error.message);
    },
  });

  if (!peticion) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Gavel className="h-5 w-5 text-purple-600" />
            Escalar a Tutela
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p>
                Está a punto de crear una acción de tutela por vulneración al Derecho de Petición.
              </p>
              
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg dark:bg-amber-950/20 dark:border-amber-800">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-800 dark:text-amber-200">
                      Información de la petición no respondida:
                    </p>
                    <ul className="mt-2 space-y-1 text-amber-700 dark:text-amber-300">
                      <li><strong>Entidad:</strong> {peticion.entityName}</li>
                      <li><strong>Asunto:</strong> {peticion.subject}</li>
                      {peticion.radicado && <li><strong>Radicado:</strong> {peticion.radicado}</li>}
                    </ul>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notas adicionales para la tutela</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Agregue información adicional relevante para la tutela..."
                  rows={3}
                />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => escalateMutation.mutate()}
            disabled={escalateMutation.isPending}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {escalateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Crear Tutela
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
