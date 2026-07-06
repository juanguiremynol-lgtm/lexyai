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
import { AlertTriangle } from "lucide-react";

interface WorkItemBulkDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onConfirm: () => void;
  isDeleting?: boolean;
}

export function WorkItemBulkDeleteDialog({
  open,
  onOpenChange,
  selectedCount,
  onConfirm,
  isDeleting = false,
}: WorkItemBulkDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-2 text-destructive mb-2">
            <AlertTriangle className="h-5 w-5" />
            <AlertDialogTitle>Eliminar elementos seleccionados</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="space-y-3">
            <p>
              Vas a archivar <strong>{selectedCount} asunto{selectedCount !== 1 ? "s" : ""}</strong>.
            </p>

            <p className="text-muted-foreground text-sm">
              Dejarán de aparecer en tus vistas y de sincronizarse. Podrás recuperarlos con Andro IA
              en los próximos <strong>10 días</strong>; después se eliminarán definitivamente.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? "Eliminando..." : `Eliminar ${selectedCount} elemento${selectedCount !== 1 ? "s" : ""}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
