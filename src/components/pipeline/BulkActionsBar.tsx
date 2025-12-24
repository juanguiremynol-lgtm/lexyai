import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, CheckSquare, FileText, Scale, ArrowRightLeft, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface BulkActionsBarProps {
  selectedCount: number;
  filingsCount: number;
  processesCount: number;
  onSelectAllFilings: () => void;
  onSelectAllProcesses: () => void;
  onClearSelection: () => void;
  onBulkReclassify: () => void;
  onBulkDelete: () => void;
  isDeleting?: boolean;
}

export function BulkActionsBar({
  selectedCount,
  filingsCount,
  processesCount,
  onSelectAllFilings,
  onSelectAllProcesses,
  onClearSelection,
  onBulkReclassify,
  onBulkDelete,
  isDeleting = false,
}: BulkActionsBarProps) {
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
        <div className="flex items-center gap-1.5 ml-2">
          {filingsCount > 0 && (
            <Badge variant="secondary" className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
              <FileText className="h-3 w-3 mr-1" />
              {filingsCount}
            </Badge>
          )}
          {processesCount > 0 && (
            <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
              <Scale className="h-3 w-3 mr-1" />
              {processesCount}
            </Badge>
          )}
        </div>
      </div>

      <div className="h-6 w-px bg-border" />

      {/* Quick select buttons */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onSelectAllFilings}
          className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
        >
          <FileText className="h-4 w-4 mr-1.5" />
          Todas radicaciones
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onSelectAllProcesses}
          className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
        >
          <Scale className="h-4 w-4 mr-1.5" />
          Todos procesos
        </Button>
      </div>

      <div className="h-6 w-px bg-border" />

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onBulkReclassify}
          className="gap-1.5"
        >
          <ArrowRightLeft className="h-4 w-4" />
          Reclasificar
        </Button>
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
      </div>

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
