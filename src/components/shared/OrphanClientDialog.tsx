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
import { UserMinus } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientName: string;
  onConfirm: () => void | Promise<void>;
}

/** Shown after a soft-delete when the client has no other live work items. */
export function OrphanClientDialog({ open, onOpenChange, clientName, onConfirm }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3 text-amber-600">
            <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <UserMinus className="h-5 w-5" />
            </div>
            <AlertDialogTitle>¿Eliminar también al cliente?</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="pt-4 space-y-2">
            <p>
              <strong>{clientName}</strong> ya no tiene otros expedientes activos ni pausados.
            </p>
            <p className="text-muted-foreground text-sm">
              Puedes conservarlo para usarlo con futuros radicados, o eliminarlo ahora.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>No, conservar cliente</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Sí, eliminar cliente
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}