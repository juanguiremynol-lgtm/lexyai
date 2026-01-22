import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, CheckSquare, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface WorkItemBulkActionsBarProps {
  selectedCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkDelete: () => void;
  isDeleting?: boolean;
}

export function WorkItemBulkActionsBar({
  selectedCount,
  onSelectAll,
  onClearSelection,
  onBulkDelete,
  isDeleting = false,
}: WorkItemBulkActionsBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className={cn(
      "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
      "bg-card border border-border rounded-xl shadow-elevated",
      "px-4 py-3 flex items-center gap-4",
      "animate-in slide-in-from-bottom-4 duration-300"
    )}>
      {/* Selection count */}
      <div className="flex items-center gap-2">
        <CheckSquare className="h-5 w-5 text-primary" />
        <span className="font-medium">{selectedCount} seleccionados</span>
      </div>

      <div className="h-6 w-px bg-border" />

      {/* Quick select buttons */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onSelectAll}
        className="text-primary hover:text-primary/80"
      >
        Seleccionar todos
      </Button>

      <div className="h-6 w-px bg-border" />

      {/* Actions */}
      <Button
        variant="outline"
        size="sm"
        onClick={onBulkDelete}
        disabled={isDeleting}
        className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
      >
        <Trash2 className="h-4 w-4" />
        {isDeleting ? "Eliminando..." : "Eliminar"}
      </Button>

      <div className="h-6 w-px bg-border" />

      {/* Clear selection */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onClearSelection}
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4 mr-1.5" />
        Cancelar
      </Button>
    </div>
  );
}
