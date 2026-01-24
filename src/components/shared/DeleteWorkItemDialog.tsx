import { useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DeleteWorkItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isDeleting: boolean;
  itemInfo?: {
    title?: string | null;
    radicado?: string | null;
    workflowType?: string;
  };
}

export function DeleteWorkItemDialog({
  open,
  onOpenChange,
  onConfirm,
  isDeleting,
  itemInfo,
}: DeleteWorkItemDialogProps) {
  const [understood, setUnderstood] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const isValid = understood && confirmText === "DELETE";

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      // Reset state when closing
      setUnderstood(false);
      setConfirmText("");
    }
    onOpenChange(isOpen);
  };

  const handleConfirm = () => {
    if (isValid && !isDeleting) {
      onConfirm();
    }
  };

  const displayTitle = itemInfo?.title || itemInfo?.radicado || "este elemento";

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 text-destructive">
            <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
              <Trash2 className="h-5 w-5" />
            </div>
            <AlertDialogTitle className="text-lg">
              ¿Eliminar permanentemente?
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="space-y-4 pt-4">
            <p>
              Estás a punto de eliminar <strong>{displayTitle}</strong>.
              {itemInfo?.workflowType && (
                <span className="text-muted-foreground"> ({itemInfo.workflowType})</span>
              )}
            </p>

            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 space-y-2">
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div className="text-sm space-y-1">
                  <p className="font-medium">Esta acción eliminará permanentemente:</p>
                  <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                    <li>Todos los documentos y archivos adjuntos</li>
                    <li>Actuaciones y eventos del expediente</li>
                    <li>Alertas, tareas y recordatorios</li>
                    <li>Términos y plazos calculados</li>
                    <li>Historial de monitoreo y evidencias</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-2">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="understand"
                  checked={understood}
                  onCheckedChange={(checked) => setUnderstood(checked === true)}
                  disabled={isDeleting}
                />
                <Label
                  htmlFor="understand"
                  className="text-sm font-normal cursor-pointer leading-relaxed"
                >
                  Entiendo que esta acción es <strong>permanente e irreversible</strong>
                </Label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-text" className="text-sm">
                  Escribe <code className="bg-muted px-1.5 py-0.5 rounded text-destructive font-mono">DELETE</code> para confirmar:
                </Label>
                <Input
                  id="confirm-text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                  placeholder="DELETE"
                  disabled={isDeleting}
                  className={cn(
                    "font-mono",
                    confirmText === "DELETE" && "border-destructive focus-visible:ring-destructive"
                  )}
                />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!isValid || isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Eliminando...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-2" />
                Eliminar permanentemente
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
