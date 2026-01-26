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
import { Loader2 } from "lucide-react";

interface AlertBulkConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  action: "dismiss" | "markRead";
  onConfirm: () => void;
  isProcessing: boolean;
}

const ACTION_LABELS = {
  dismiss: {
    title: "Descartar alertas",
    description: "Esta acción descartará las alertas seleccionadas. Las alertas descartadas no aparecerán en la lista activa.",
    confirm: "Descartar",
  },
  markRead: {
    title: "Marcar como leídas",
    description: "Esta acción marcará las alertas seleccionadas como leídas.",
    confirm: "Marcar leídas",
  },
};

export function AlertBulkConfirmDialog({
  open,
  onOpenChange,
  count,
  action,
  onConfirm,
  isProcessing,
}: AlertBulkConfirmDialogProps) {
  const labels = ACTION_LABELS[action];

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {labels.title} ({count})
          </AlertDialogTitle>
          <AlertDialogDescription>
            {labels.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isProcessing}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isProcessing}
            className={action === "dismiss" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
          >
            {isProcessing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {labels.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
