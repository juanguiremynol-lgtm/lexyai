import { useDroppable } from "@dnd-kit/core";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Gavel, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { TutelaCard, TutelaItem } from "./TutelaCard";
import type { TutelaPhase } from "@/lib/tutela-constants";

export interface TutelaStageConfig {
  id: string;
  label: string;
  shortLabel: string;
  color: string;
  phase: TutelaPhase;
}

interface TutelaColumnProps {
  stage: TutelaStageConfig;
  items: TutelaItem[];
  isSelectionMode: boolean;
  isItemSelected: (item: { id: string; type: "tutela" }) => boolean;
  onToggleSelection: (item: { id: string; type: "tutela" }, shiftKey: boolean) => void;
  onArchivePrompt: (item: TutelaItem) => void;
  showCreateButton?: boolean;
  onCreateTutela?: () => void;
  onCreateHabeas?: () => void;
}

export function TutelaColumn({
  stage,
  items,
  isSelectionMode,
  isItemSelected,
  onToggleSelection,
  onArchivePrompt,
  showCreateButton = false,
  onCreateTutela,
  onCreateHabeas,
}: TutelaColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-shrink-0 w-72 bg-muted/30 rounded-lg border",
        "flex flex-col min-h-[400px] transition-colors duration-200",
        isOver && "bg-primary/5 border-primary/50"
      )}
    >
      {/* Column Header */}
      <div className="p-3 border-b bg-muted/50 rounded-t-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full", stage.color)} />
            <h3 className="font-medium text-sm">{stage.shortLabel}</h3>
            <Badge variant="secondary" className="text-xs">
              {items.length}
            </Badge>
          </div>
          {showCreateButton && (onCreateTutela || onCreateHabeas) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-7 px-2">
                  <Plus className="h-4 w-4 mr-1" />
                  Crear
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onCreateTutela}>
                  <Gavel className="h-4 w-4 mr-2" />
                  Nueva Tutela
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onCreateHabeas} className="text-red-600">
                  <Shield className="h-4 w-4 mr-2" />
                  Habeas Corpus
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Column Content */}
      <ScrollArea className="flex-1 p-2">
        <div className="space-y-2">
          {items.map((item) => (
            <TutelaCard
              key={item.id}
              item={item}
              isSelectionMode={isSelectionMode}
              isSelected={isItemSelected({ id: item.id, type: "tutela" })}
              onToggleSelection={onToggleSelection}
              onArchivePrompt={onArchivePrompt}
            />
          ))}
          {items.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Sin tutelas
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
