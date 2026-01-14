import { Button } from "@/components/ui/button";
import { CheckSquare, Trash2, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface CpacaBulkActionsBarProps {
  selectedCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkDelete: () => void;
  isDeleting: boolean;
}

export function CpacaBulkActionsBar({
  selectedCount,
  onSelectAll,
  onClearSelection,
  onBulkDelete,
  isDeleting,
}: CpacaBulkActionsBarProps) {
  if (selectedCount === 0) return null;

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
        <span className="font-medium">{selectedCount} seleccionado{selectedCount !== 1 ? "s" : ""}</span>
      </div>

      <div className="h-6 w-px bg-border" />

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onSelectAll}>
          Seleccionar todos
        </Button>
        <Button variant="outline" size="sm" onClick={onClearSelection}>
          <X className="h-4 w-4 mr-1" />
          Limpiar
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={onBulkDelete}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4 mr-1" />
          )}
          Eliminar
        </Button>
      </div>
    </div>
  );
}
