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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Archive, Loader2 } from "lucide-react";

interface ArchiveWorkItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason?: string) => void;
  isArchiving: boolean;
  itemInfo?: {
    title?: string | null;
    radicado?: string | null;
    workflowType?: string;
  };
  count?: number; // For bulk archive
}

export function ArchiveWorkItemDialog({
  open,
  onOpenChange,
  onConfirm,
  isArchiving,
  itemInfo,
  count = 1,
}: ArchiveWorkItemDialogProps) {
  const [reason, setReason] = useState("");

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setReason("");
    }
    onOpenChange(isOpen);
  };

  const handleConfirm = () => {
    if (!isArchiving) {
      onConfirm(reason || undefined);
    }
  };

  const isBulk = count > 1;
  const displayTitle = isBulk 
    ? `${count} elementos` 
    : (itemInfo?.title || itemInfo?.radicado || "este elemento");

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 text-amber-600">
            <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Archive className="h-5 w-5" />
            </div>
            <AlertDialogTitle className="text-lg">
              ¿Archivar {isBulk ? "elementos" : "elemento"}?
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="space-y-4 pt-4">
            <p>
              {isBulk ? (
                <>Estás a punto de archivar <strong>{count} elementos</strong>.</>
              ) : (
                <>
                  Estás a punto de archivar <strong>{displayTitle}</strong>.
                  {itemInfo?.workflowType && (
                    <span className="text-muted-foreground"> ({itemInfo.workflowType})</span>
                  )}
                </>
              )}
            </p>

            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3 space-y-2">
              <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                <Archive className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div className="text-sm space-y-1">
                  <p className="font-medium">Esta acción:</p>
                  <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                    <li>Ocultará {isBulk ? "los elementos" : "el elemento"} de los pipelines y listas</li>
                    <li>Detendrá la sincronización automática</li>
                    <li>Mantendrá todos los datos intactos por <strong>10 días</strong></li>
                    <li>Podrás recuperar{isBulk ? "los" : "lo"} solicitándoselo a <strong>Atenia AI</strong></li>
                    <li>Después de 10 días, será eliminado permanentemente</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="archive-reason" className="text-sm">
                Razón del archivo (opcional)
              </Label>
              <Textarea
                id="archive-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej: Caso cerrado, duplicado, error de ingreso..."
                disabled={isArchiving}
                className="min-h-[60px]"
              />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel disabled={isArchiving}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isArchiving}
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            {isArchiving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Archivando...
              </>
            ) : (
              <>
                <Archive className="h-4 w-4 mr-2" />
                Archivar
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
