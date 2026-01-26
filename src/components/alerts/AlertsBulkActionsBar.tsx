import { Button } from "@/components/ui/button";
import { CheckSquare, X, Trash2, Eye, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AlertsBulkActionsBarProps {
  selectedCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkDismiss: () => void;
  onBulkMarkRead: () => void;
  onBulkSnooze: () => void;
  isDismissing: boolean;
  isMarkingRead: boolean;
}

export function AlertsBulkActionsBar({
  selectedCount,
  onSelectAll,
  onClearSelection,
  onBulkDismiss,
  onBulkMarkRead,
  onBulkSnooze,
  isDismissing,
  isMarkingRead,
}: AlertsBulkActionsBarProps) {
  if (selectedCount === 0) return null;

  const isProcessing = isDismissing || isMarkingRead;

  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 -translate-x-1/2 z-50",
        "bg-background border rounded-lg shadow-lg",
        "px-4 py-3 flex items-center gap-4",
        "animate-in slide-in-from-bottom-4"
      )}
    >
      <div className="flex items-center gap-2">
        <CheckSquare className="h-4 w-4 text-primary" />
        <span className="font-medium">
          {selectedCount} alerta{selectedCount !== 1 ? "s" : ""} seleccionada{selectedCount !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="h-6 w-px bg-border" />

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onSelectAll}>
          Todas
        </Button>
        <Button variant="outline" size="sm" onClick={onClearSelection}>
          <X className="h-4 w-4 mr-1" />
          Limpiar
        </Button>
      </div>

      <div className="h-6 w-px bg-border" />

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onBulkMarkRead}
          disabled={isProcessing}
        >
          {isMarkingRead ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Eye className="h-4 w-4 mr-1" />
          )}
          Marcar leídas
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onBulkSnooze}
          disabled={isProcessing}
        >
          <Clock className="h-4 w-4 mr-1" />
          Posponer
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={onBulkDismiss}
          disabled={isProcessing}
        >
          {isDismissing ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4 mr-1" />
          )}
          Descartar
        </Button>
      </div>
    </div>
  );
}
