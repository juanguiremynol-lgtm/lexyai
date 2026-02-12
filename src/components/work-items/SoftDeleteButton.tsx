/**
 * SoftDeleteButton — Reusable trash button with confirmation dialog
 * 
 * Shows a trash icon that on click opens a confirmation dialog.
 * Soft-deletes the work item (sets deleted_at, disables monitoring, 10-day recovery).
 */

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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { softDeleteWorkItem } from "@/lib/services/work-item-delete-service";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface SoftDeleteButtonProps {
  workItemId: string;
  radicado: string | null;
  onDeleted: () => void;
  /** "icon" = ghost icon button (pipeline cards), "button" = outlined text button (detail page) */
  variant?: "icon" | "button";
  className?: string;
}

export function SoftDeleteButton({
  workItemId,
  radicado,
  onDeleted,
  variant = "icon",
  className,
}: SoftDeleteButtonProps) {
  const [deleteReason, setDeleteReason] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [open, setOpen] = useState(false);

  async function handleSoftDelete() {
    setIsDeleting(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error("No autenticado");
        return;
      }

      const result = await softDeleteWorkItem(
        supabase,
        workItemId,
        user.id,
        deleteReason || undefined
      );

      if (result.success) {
        toast.success(
          `Asunto ${radicado || ""} eliminado. Puedes recuperarlo con Atenia AI en los próximos 10 días.`
        );
        setOpen(false);
        onDeleted();
      } else {
        toast.error(result.error ?? "Error al eliminar el asunto");
      }
    } finally {
      setIsDeleting(false);
      setDeleteReason("");
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        {variant === "icon" ? (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive",
              className
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "text-destructive hover:bg-destructive hover:text-destructive-foreground",
              className
            )}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Eliminar asunto
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar este asunto?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                El asunto <strong>{radicado || "sin radicado"}</strong> será
                eliminado de tu vista y dejará de sincronizarse. Todas las
                actuaciones, estados, alertas, audiencias y notas asociadas
                dejarán de ser visibles.
              </p>
              <p className="text-sm text-muted-foreground">
                Tienes <strong>10 días</strong> para recuperarlo solicitándoselo
                a Atenia AI. Después de ese plazo, será eliminado
                permanentemente.
              </p>
              <div className="pt-2">
                <Label htmlFor="delete-reason" className="text-sm">
                  Razón (opcional)
                </Label>
                <Input
                  id="delete-reason"
                  placeholder="Ej: Caso cerrado, radicado duplicado..."
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              handleSoftDelete();
            }}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Eliminando...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-2" />
                Eliminar asunto
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
