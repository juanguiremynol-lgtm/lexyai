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
import { Badge } from "@/components/ui/badge";
import { FileText, Scale, AlertTriangle } from "lucide-react";

interface BulkDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filingsCount: number;
  processesCount: number;
  onConfirm: () => void;
  isDeleting?: boolean;
}

export function BulkDeleteDialog({
  open,
  onOpenChange,
  filingsCount,
  processesCount,
  onConfirm,
  isDeleting = false,
}: BulkDeleteDialogProps) {
  const totalCount = filingsCount + processesCount;

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
              Estás a punto de eliminar permanentemente{" "}
              <strong>{totalCount} elemento{totalCount !== 1 ? "s" : ""}</strong>:
            </p>
            
            <div className="flex items-center gap-2">
              {filingsCount > 0 && (
                <Badge variant="secondary" className="bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30">
                  <FileText className="h-3 w-3 mr-1" />
                  {filingsCount} radicacion{filingsCount !== 1 ? "es" : ""}
                </Badge>
              )}
              {processesCount > 0 && (
                <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                  <Scale className="h-3 w-3 mr-1" />
                  {processesCount} proceso{processesCount !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            <p className="text-destructive font-medium">
              Esta acción eliminará todos los datos asociados (documentos, eventos, audiencias, etc.) y no se puede deshacer.
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
            {isDeleting ? "Eliminando..." : `Eliminar ${totalCount} elemento${totalCount !== 1 ? "s" : ""}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
