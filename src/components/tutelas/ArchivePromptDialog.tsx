import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Archive, Clock, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { addBusinessDays } from "@/lib/colombian-holidays";
import { ARCHIVE_PROMPT_INTERVAL_DAYS } from "@/lib/tutela-constants";

interface ArchivePromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string | null;
  itemType: "tutela" | "peticion" | "filing" | "process";
  itemLabel: string;
  onDeleted?: () => void;
}

export function ArchivePromptDialog({
  open,
  onOpenChange,
  itemId,
  itemType,
  itemLabel,
  onDeleted,
}: ArchivePromptDialogProps) {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!itemId) return;

      if (itemType === "peticion") {
        // Delete related alerts first
        await supabase.from("peticion_alerts").delete().eq("peticion_id", itemId);
        // Delete peticion
        const { error } = await supabase.from("peticiones").delete().eq("id", itemId);
        if (error) throw error;
      } else if (itemType === "tutela" || itemType === "filing") {
        // Delete related data
        await supabase.from("documents").delete().eq("filing_id", itemId);
        await supabase.from("hearings").delete().eq("filing_id", itemId);
        await supabase.from("emails").delete().eq("filing_id", itemId);
        await supabase.from("process_events").delete().eq("filing_id", itemId);
        await supabase.from("tasks").delete().eq("filing_id", itemId);
        await supabase.from("alerts").delete().eq("filing_id", itemId);
        // Delete filing
        const { error } = await supabase.from("filings").delete().eq("id", itemId);
        if (error) throw error;
      } else if (itemType === "process") {
        // Delete related data
        await supabase.from("process_events").delete().eq("monitored_process_id", itemId);
        await supabase.from("evidence_snapshots").delete().eq("monitored_process_id", itemId);
        // Delete process
        const { error } = await supabase.from("monitored_processes").delete().eq("id", itemId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tutelas"] });
      queryClient.invalidateQueries({ queryKey: ["filings"] });
      queryClient.invalidateQueries({ queryKey: ["peticiones"] });
      queryClient.invalidateQueries({ queryKey: ["monitored_processes"] });
      queryClient.invalidateQueries({ queryKey: ["unified-pipeline"] });
      toast.success("Registro eliminado exitosamente");
      onOpenChange(false);
      onDeleted?.();
    },
    onError: (error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });

  const postponeMutation = useMutation({
    mutationFn: async () => {
      if (!itemId) return;

      const nextPromptDate = addBusinessDays(new Date(), ARCHIVE_PROMPT_INTERVAL_DAYS);

      if (itemType === "peticion") {
        const { error } = await supabase
          .from("peticiones")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", itemId);
        if (error) throw error;
      } else if (itemType === "tutela" || itemType === "filing") {
        const { error } = await supabase
          .from("filings")
          .update({ last_reviewed_at: nextPromptDate.toISOString() })
          .eq("id", itemId);
        if (error) throw error;
      } else if (itemType === "process") {
        const { error } = await supabase
          .from("monitored_processes")
          .update({ last_reviewed_at: nextPromptDate.toISOString() })
          .eq("id", itemId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tutelas"] });
      queryClient.invalidateQueries({ queryKey: ["filings"] });
      queryClient.invalidateQueries({ queryKey: ["peticiones"] });
      queryClient.invalidateQueries({ queryKey: ["monitored_processes"] });
      toast.success(`Recordatorio pospuesto ${ARCHIVE_PROMPT_INTERVAL_DAYS} días hábiles`);
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const isPending = deleteMutation.isPending || postponeMutation.isPending;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5" />
            ¿Archivar o Eliminar?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Este registro ha alcanzado su fase final: <strong>{itemLabel}</strong>
            <br /><br />
            ¿Desea eliminarlo permanentemente o posponer este recordatorio por {ARCHIVE_PROMPT_INTERVAL_DAYS} días hábiles?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel disabled={isPending}>
            Mantener abierto
          </AlertDialogCancel>
          <Button
            variant="outline"
            onClick={() => postponeMutation.mutate()}
            disabled={isPending}
          >
            {postponeMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Clock className="h-4 w-4 mr-2" />
            )}
            Recordar en {ARCHIVE_PROMPT_INTERVAL_DAYS} días
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={isPending}
          >
            {deleteMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            Eliminar
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
