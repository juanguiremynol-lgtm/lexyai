import { Button } from "@/components/ui/button";
import { Trash2, X, CheckSquare } from "lucide-react";

interface TutelasBulkActionsBarProps {
  selectedCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkDelete: () => void;
  isDeleting: boolean;
}

export function TutelasBulkActionsBar({
  selectedCount,
  onSelectAll,
  onClearSelection,
  onBulkDelete,
  isDeleting,
}: TutelasBulkActionsBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-background border shadow-lg rounded-lg px-4 py-3 flex items-center gap-4">
        <span className="text-sm font-medium">
          {selectedCount} tutela{selectedCount !== 1 ? "s" : ""} seleccionada{selectedCount !== 1 ? "s" : ""}
        </span>
        
        <div className="h-4 w-px bg-border" />
        
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onSelectAll}>
            <CheckSquare className="h-4 w-4 mr-2" />
            Todas
          </Button>
          
          <Button variant="outline" size="sm" onClick={onClearSelection}>
            <X className="h-4 w-4 mr-2" />
            Limpiar
          </Button>
          
          <Button
            variant="destructive"
            size="sm"
            onClick={onBulkDelete}
            disabled={isDeleting}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Eliminar
          </Button>
        </div>
      </div>
    </div>
  );
}
