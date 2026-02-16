import { useQueryClient } from "@tanstack/react-query";
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
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useSoftDeleteWorkItems } from "@/hooks/use-soft-delete-work-items";

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

  const { archiveBulk, isArchiving } = useSoftDeleteWorkItems({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["process-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      onComplete();
    },
  });

  const handleDelete = () => {
    if (processIds.length === 0) return;
    archiveBulk(processIds);
  };

  const isPending = isArchiving;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar procesos?</AlertDialogTitle>
          <AlertDialogDescription>
            Estás a punto de eliminar {processIds.length} proceso
            {processIds.length !== 1 ? "s" : ""}. Podrás recuperarlos con Andro IA
            en los próximos 10 días.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending ? (
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
