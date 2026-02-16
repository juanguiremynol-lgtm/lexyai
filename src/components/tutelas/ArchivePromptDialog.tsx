import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSoftDeleteWorkItems } from "@/hooks/use-soft-delete-work-items";
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
  itemType: "tutela" | "peticion" | "filing" | "process" | "work_item";
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
  const { archiveSingle, isArchiving } = useSoftDeleteWorkItems({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["peticiones"] });
      onOpenChange(false);
      onDeleted?.();
    },
  });

  const deleteMutation = {
    mutate: () => {
      if (!itemId) return;
      if (itemType === "peticion") {
        // Peticiones are a separate table; soft-delete doesn't apply
        supabase.from("peticion_alerts").delete().eq("peticion_id", itemId).then(() => {
          supabase.from("peticiones").delete().eq("id", itemId).then(({ error }) => {
            if (error) {
              toast.error("Error al eliminar: " + error.message);
            } else {
              queryClient.invalidateQueries({ queryKey: ["peticiones"] });
              toast.success("Registro eliminado exitosamente");
              onOpenChange(false);
              onDeleted?.();
            }
          });
        });
      } else {
        // Use soft-delete for work_items
        archiveSingle(itemId);
      }
    },
    isPending: isArchiving,
  };

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
      } else {
        // For work_items
        const { error } = await supabase
          .from("work_items")
          .update({ updated_at: nextPromptDate.toISOString() })
          .eq("id", itemId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["peticiones"] });
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
