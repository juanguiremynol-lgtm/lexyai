/**
 * DemoPipelineCard — Mirrors WorkItemPipelineCard styling for the demo Kanban.
 * 
 * Supports drag handle, click-to-open, delete action.
 * No DB writes, no auth, no navigation — all demo-local.
 */

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExternalLink, MoreVertical, Trash2, User, Clock, Activity, Scale, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DemoWorkItem } from "./DemoPipelineContext";

interface Props {
  item: DemoWorkItem;
  isDragging?: boolean;
  onOpen: () => void;
  onDelete: () => void;
}

export function DemoPipelineCard({ item, isDragging = false, onOpen, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: item.id,
    data: { item },
  });

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "transition-all duration-200 group cursor-grab active:cursor-grabbing",
        "border-l-4 shadow-sm",
        isDragging && "opacity-90 shadow-lg scale-105 rotate-2 ring-2 ring-primary z-50",
        !isDragging && "hover:shadow-md hover:ring-1 hover:ring-primary/30 hover:-translate-y-0.5",
        item.isSample
          ? "border-l-muted-foreground/30 bg-gradient-to-r from-muted/30 to-transparent"
          : "border-l-primary bg-gradient-to-r from-primary/10 to-transparent"
      )}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          {/* Actions */}
          <div className="flex flex-col gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:bg-primary/10"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onOpen();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title="Ver detalle"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:bg-muted"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="text-destructive focus:text-destructive focus:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Eliminar (demo)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex-1 min-w-0">
            {/* Type badge */}
            <div className="flex items-center gap-1.5 mb-2">
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0.5 font-medium bg-primary/20 text-primary border-primary/30"
              >
                <Scale className="h-3 w-3 mr-1" />
                Proceso
              </Badge>
              {item.isSample && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                  Ejemplo
                </Badge>
              )}
              {!item.isSample && (
                <Badge className="text-[9px] px-1 py-0 h-4 bg-primary/10 text-primary border-primary/20">
                  Tu radicado
                </Badge>
              )}
            </div>

            {/* Radicado */}
            <p className="font-mono text-sm font-semibold truncate mb-1">
              {item.radicado_display}
            </p>

            {/* Client / parties */}
            <p className="text-sm font-medium text-foreground/80 truncate">
              {item.demandante || "Sin demandante"}
            </p>

            {/* Court */}
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {item.despacho || "Sin juzgado"}
            </p>

            {/* Parties */}
            {item.demandado && (
              <div className="flex items-center gap-1.5 mt-2 p-1.5 bg-muted/50 rounded">
                <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-muted-foreground truncate">
                  vs {item.demandado}
                </span>
              </div>
            )}

            {/* Stats footer */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
              <div className="flex gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Activity className="h-3 w-3" />
                  {item.total_actuaciones} act.
                </span>
              </div>
              {item.ultima_actuacion_fecha && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(item.ultima_actuacion_fecha).toLocaleDateString("es-CO", { month: "short", day: "numeric" })}
                </p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
