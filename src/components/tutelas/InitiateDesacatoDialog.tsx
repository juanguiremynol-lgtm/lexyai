import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { TutelaItem } from "./TutelaCard";

interface InitiateDesacatoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tutela: TutelaItem | null;
}

export function InitiateDesacatoDialog({
  open,
  onOpenChange,
  tutela,
}: InitiateDesacatoDialogProps) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");

  const createDesacatoMutation = useMutation({
    mutationFn: async () => {
      if (!tutela) throw new Error("No tutela selected");

      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { error } = await supabase.from("desacato_incidents").insert({
        tutela_id: tutela.id,
        owner_id: user.user.id,
        phase: "DESACATO_RADICACION",
        notes: notes.trim() || null,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["desacatos"] });
      queryClient.invalidateQueries({ queryKey: ["tutelas"] });
      toast.success("Incidente de desacato iniciado");
      onOpenChange(false);
      setNotes("");
    },
    onError: () => {
      toast.error("Error al iniciar incidente de desacato");
    },
  });

  const handleSubmit = () => {
    createDesacatoMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
            <AlertTriangle className="h-5 w-5" />
            Iniciar Incidente de Desacato
          </DialogTitle>
          <DialogDescription>
            Este proceso se activa cuando hay fallo favorable y renuencia a cumplir
            por parte del accionado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Tutela info */}
          <div className="bg-muted/50 p-3 rounded-lg space-y-1">
            <p className="text-sm font-medium">Tutela origen:</p>
            <p className="text-sm text-muted-foreground font-mono">
              {tutela?.radicado || "Sin radicado"}
            </p>
            {tutela?.demandantes && (
              <p className="text-xs text-muted-foreground">
                Accionante: {tutela.demandantes}
              </p>
            )}
            {tutela?.demandados && (
              <p className="text-xs text-muted-foreground">
                Accionado: {tutela.demandados}
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Textarea
              id="notes"
              placeholder="Describe los motivos del incumplimiento..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {/* Warning */}
          <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900 p-3 rounded-lg">
            <p className="text-sm text-orange-700 dark:text-orange-400">
              <strong>Fases del proceso:</strong>
            </p>
            <ol className="text-xs text-orange-600 dark:text-orange-500 mt-1 list-decimal list-inside space-y-0.5">
              <li>Radicación</li>
              <li>Requerimiento</li>
              <li>Segunda Solicitud</li>
              <li>Apertura Incidente</li>
              <li>Fallo Incidente</li>
            </ol>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createDesacatoMutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createDesacatoMutation.isPending}
            className="bg-orange-600 hover:bg-orange-700"
          >
            {createDesacatoMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <AlertTriangle className="h-4 w-4 mr-2" />
            )}
            Iniciar Incidente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
