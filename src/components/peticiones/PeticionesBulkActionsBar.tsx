import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Trash2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface PeticionesBulkActionsBarProps {
  selectedCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkDelete: () => void;
  isDeleting?: boolean;
}

export function PeticionesBulkActionsBar({
  selectedCount,
  onSelectAll,
  onClearSelection,
  onBulkDelete,
  isDeleting = false,
}: PeticionesBulkActionsBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center gap-3 px-4 py-3 bg-background border rounded-xl shadow-xl">
        {/* Selection Count */}
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="px-3 py-1">
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            {selectedCount} peticion{selectedCount !== 1 ? "es" : ""}
          </Badge>
        </div>

        <div className="h-6 w-px bg-border" />

        {/* Quick Select */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onSelectAll}
          className="text-muted-foreground hover:text-foreground"
        >
          Seleccionar todo
        </Button>

        <div className="h-6 w-px bg-border" />

        {/* Actions */}
        <Button
          variant="destructive"
          size="sm"
          onClick={onBulkDelete}
          disabled={isDeleting}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Eliminar
        </Button>

        {/* Clear Selection */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onClearSelection}
          className="h-8 w-8"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
