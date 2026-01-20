import { Button } from "@/components/ui/button";
import { Trash2, X } from "lucide-react";

interface ProcessBulkActionsBarProps {
  selectedCount: number;
  onDelete: () => void;
  onClear: () => void;
}

export function ProcessBulkActionsBar({
  selectedCount,
  onDelete,
  onClear,
}: ProcessBulkActionsBarProps) {
  return (
    <div className="flex items-center gap-3 p-3 mb-4 bg-muted rounded-lg border">
      <span className="text-sm font-medium">
        {selectedCount} proceso{selectedCount !== 1 ? "s" : ""} seleccionado{selectedCount !== 1 ? "s" : ""}
      </span>
      <div className="flex-1" />
      <Button
        variant="destructive"
        size="sm"
        onClick={onDelete}
        className="gap-1"
      >
        <Trash2 className="h-4 w-4" />
        Eliminar
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClear}
        className="gap-1"
      >
        <X className="h-4 w-4" />
        Cancelar
      </Button>
    </div>
  );
}
