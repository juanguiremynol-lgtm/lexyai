import { useState, useMemo } from "react";
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
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Loader2, Trash2, FileText, Scale, Send, Gavel, Landmark, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface BulkDeleteItem {
  id: string;
  title?: string | null;
  radicado?: string | null;
  workflowType?: string;
}

interface BulkDeleteWorkItemsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isDeleting: boolean;
  items: BulkDeleteItem[];
}

const WORKFLOW_ICONS: Record<string, typeof Scale> = {
  CGP: Scale,
  PETICION: Send,
  TUTELA: Gavel,
  GOV_PROCEDURE: Building2,
  CPACA: Landmark,
};

export function BulkDeleteWorkItemsDialog({
  open,
  onOpenChange,
  onConfirm,
  isDeleting,
  items,
}: BulkDeleteWorkItemsDialogProps) {
  const [understood, setUnderstood] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const count = items.length;
  const requiredText = `DELETE ${count}`;
  const isValid = understood && confirmText === requiredText;

  // Group items by workflow type
  const groupedItems = useMemo(() => {
    const groups: Record<string, BulkDeleteItem[]> = {};
    items.forEach((item) => {
      const type = item.workflowType || "UNKNOWN";
      if (!groups[type]) groups[type] = [];
      groups[type].push(item);
    });
    return groups;
  }, [items]);

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
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

  const previewItems = items.slice(0, 10);
  const remainingCount = items.length - previewItems.length;

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 text-destructive">
            <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
              <Trash2 className="h-5 w-5" />
            </div>
            <AlertDialogTitle className="text-lg">
              Eliminar {count} elemento{count !== 1 ? "s" : ""} permanentemente
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-4 pt-4">
              {/* Items preview */}
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Elementos seleccionados:</p>
                <ScrollArea className="h-[140px] border rounded-md p-2">
                  <div className="space-y-1.5">
                    {previewItems.map((item) => {
                      const Icon = WORKFLOW_ICONS[item.workflowType || ""] || FileText;
                      return (
                        <div
                          key={item.id}
                          className="flex items-center gap-2 text-sm py-1 px-2 rounded bg-muted/50"
                        >
                          <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="truncate">
                            {item.title || item.radicado || item.id.slice(0, 8)}
                          </span>
                          {item.workflowType && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 ml-auto">
                              {item.workflowType}
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                    {remainingCount > 0 && (
                      <div className="text-sm text-muted-foreground py-1 px-2 italic">
                        ... y {remainingCount} más
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>

              {/* Type breakdown */}
              <div className="flex flex-wrap gap-2">
                {Object.entries(groupedItems).map(([type, typeItems]) => {
                  const Icon = WORKFLOW_ICONS[type] || FileText;
                  return (
                    <Badge key={type} variant="secondary" className="gap-1">
                      <Icon className="h-3 w-3" />
                      {typeItems.length} {type}
                    </Badge>
                  );
                })}
              </div>

              {/* Warning */}
              <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
                <div className="flex items-start gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium">Esta acción eliminará permanentemente:</p>
                    <ul className="list-disc list-inside text-muted-foreground mt-1 space-y-0.5">
                      <li>Todos los documentos y archivos adjuntos</li>
                      <li>Actuaciones, eventos y términos</li>
                      <li>Alertas, tareas y recordatorios</li>
                      <li>Historial de monitoreo</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Confirmation controls */}
              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="bulk-understand"
                    checked={understood}
                    onCheckedChange={(checked) => setUnderstood(checked === true)}
                    disabled={isDeleting}
                  />
                  <Label
                    htmlFor="bulk-understand"
                    className="text-sm font-normal cursor-pointer leading-relaxed"
                  >
                    Entiendo que esta acción es <strong>permanente e irreversible</strong>
                  </Label>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bulk-confirm-text" className="text-sm">
                    Escribe{" "}
                    <code className="bg-muted px-1.5 py-0.5 rounded text-destructive font-mono">
                      DELETE {count}
                    </code>{" "}
                    para confirmar:
                  </Label>
                  <Input
                    id="bulk-confirm-text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                    placeholder={`DELETE ${count}`}
                    disabled={isDeleting}
                    className={cn(
                      "font-mono",
                      confirmText === requiredText && "border-destructive focus-visible:ring-destructive"
                    )}
                  />
                </div>
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
                Eliminar {count} elemento{count !== 1 ? "s" : ""}
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
