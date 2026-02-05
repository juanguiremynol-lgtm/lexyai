import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface SelectableItem {
  id: string;
  type: string;
}

interface ProcessBulkDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedItems: SelectableItem[];
  onComplete: () => void;
}

export function ProcessBulkDeleteDialog({
  open,
  onOpenChange,
  selectedItems,
  onComplete,
}: ProcessBulkDeleteDialogProps) {
  const queryClient = useQueryClient();
  const processIds = selectedItems.filter((i) => i.type === "process").map((i) => i.id);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (processIds.length === 0) return;

      // Delete from work_items instead of monitored_processes
      const { error } = await supabase
        .from("work_items")
        .delete()
        .in("id", processIds);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["process-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      toast.success(`${processIds.length} proceso(s) eliminado(s)`);
      onComplete();
    },
    onError: (error) => {
      console.error("Error deleting processes:", error);
      toast.error("Error al eliminar procesos");
    },
  });

  const handleDelete = () => {
    deleteMutation.mutate();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar procesos?</AlertDialogTitle>
          <AlertDialogDescription>
            Estás a punto de eliminar {processIds.length} proceso
            {processIds.length !== 1 ? "s" : ""} del monitoreo. Esta acción no se
            puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMutation.isPending}>
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Eliminando...
              </>
            ) : (
              "Eliminar"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
