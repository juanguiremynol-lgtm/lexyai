import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Building2, ExternalLink, MapPin, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import type { AdminProcessPhase } from "@/lib/admin-constants";

export interface AdminItem {
  id: string;
  radicado: string;
  expedienteAdmin: string | null;
  autoridad: string | null;
  entidad: string | null;
  dependencia: string | null;
  tipoActuacion: string | null;
  correoAutoridad: string | null;
  department: string | null;
  municipality: string | null;
  demandantes: string | null;
  demandados: string | null;
  clientName: string | null;
  adminPhase: AdminProcessPhase | null;
  lastCheckedAt: string | null;
  notes: string | null;
}

interface AdminPipelineCardProps {
  item: AdminItem;
  isDragging?: boolean;
  isFocused?: boolean;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onToggleSelection?: (item: AdminItem, shiftKey: boolean) => void;
}

export function AdminPipelineCard({ 
  item, 
  isDragging = false,
  isFocused = false,
  isSelected = false,
  isSelectionMode = false,
  onToggleSelection,
}: AdminPipelineCardProps) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `admin:${item.id}`,
    data: { item },
    disabled: isSelectionMode,
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  const detailPath = `/process-status/${item.id}`;

  const handleCardClick = (e: React.MouseEvent) => {
    if (isSelectionMode && onToggleSelection) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelection(item, e.shiftKey);
    }
  };

  const displayExpediente = item.expedienteAdmin || item.radicado;
  const displayAuthority = item.autoridad || item.entidad || item.dependencia;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...(isSelectionMode ? {} : { ...attributes, ...listeners })}
      onClick={handleCardClick}
      className={cn(
        "transition-all duration-200 group",
        "border-l-4 shadow-card",
        isSelectionMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-90 shadow-elevated scale-105 rotate-2 ring-2 ring-primary z-50",
        isSelected && "ring-2 ring-primary bg-primary/5",
        isFocused && !isDragging && !isSelected && "ring-2 ring-primary shadow-elevated -translate-y-0.5",
        !isDragging && !isFocused && !isSelected && "hover:shadow-elevated hover:ring-1 hover:ring-primary/30 hover:-translate-y-0.5",
        "border-l-blue-500 bg-gradient-to-r from-blue-500/10 to-transparent"
      )}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          {/* Selection/Navigation */}
          <div className="flex flex-col gap-1 flex-shrink-0">
            {isSelectionMode ? (
              <div className="h-7 w-7 flex items-center justify-center">
                <Checkbox 
                  checked={isSelected}
                  onCheckedChange={() => onToggleSelection?.(item, false)}
                  onClick={(e) => e.stopPropagation()}
                  className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                />
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900/50 transition-all"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  navigate(detailPath);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                title="Ver detalle"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Type badges */}
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              <Badge 
                variant="secondary" 
                className="text-[10px] px-1.5 py-0.5 font-medium bg-blue-500/20 text-blue-400 border-blue-500/30"
              >
                <Building2 className="h-3 w-3 mr-1" />
                Administrativo
              </Badge>
              {item.tipoActuacion && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                  {item.tipoActuacion}
                </Badge>
              )}
            </div>

            {/* Expediente number */}
            <p className="font-mono text-sm font-semibold text-foreground truncate mb-1">
              {displayExpediente}
            </p>

            {/* Authority / Entity */}
            {displayAuthority && (
              <p className="text-sm font-medium text-foreground/80 truncate">
                {displayAuthority}
              </p>
            )}

            {/* Client */}
            {item.clientName && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {item.clientName}
              </p>
            )}

            {/* Location */}
            {(item.municipality || item.department) && (
              <div className="flex items-center gap-1.5 mt-2 p-1.5 bg-muted/50 rounded">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-muted-foreground truncate">
                  {[item.municipality, item.department].filter(Boolean).join(", ")}
                </span>
              </div>
            )}

            {/* Parties */}
            {(item.demandantes || item.demandados) && (
              <div className="flex items-center gap-1.5 mt-2 p-1.5 bg-muted/50 rounded">
                <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-muted-foreground truncate">
                  {item.demandantes?.split(",")[0] || item.demandados?.split(",")[0]}
                </span>
              </div>
            )}

            {/* Last checked */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
              {item.lastCheckedAt ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  {formatDistanceToNow(new Date(item.lastCheckedAt), {
                    addSuffix: true,
                    locale: es,
                  })}
                </p>
              ) : (
                <span className="text-xs text-muted-foreground italic">Sin revisión</span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
