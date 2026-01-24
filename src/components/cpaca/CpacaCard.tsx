import { useDraggable } from "@dnd-kit/core";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ClientRequiredBadge } from "@/components/shared/ClientRequiredBadge";
import { EntityClientLink } from "@/components/shared/EntityClientLink";
import { 
  Calendar, 
  FileText, 
  Scale, 
  ExternalLink, 
  AlertTriangle,
  Clock,
  Building2,
  Users,
  Flag
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, differenceInDays } from "date-fns";
import { es } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { 
  CPACA_PHASES, 
  MEDIOS_DE_CONTROL, 
  ESTADOS_CADUCIDAD,
  type CpacaPhase,
  type MedioDeControl,
  type EstadoCaducidad
} from "@/lib/cpaca-constants";

export interface CpacaItem {
  id: string;
  type: "cpaca";
  radicado: string | null;
  titulo: string | null;
  medioDeControl: MedioDeControl;
  medioDeControlCustom: string | null;
  phase: CpacaPhase;
  despachoNombre: string | null;
  despachoCiudad: string | null;
  demandantes: string | null;
  demandados: string | null;
  clientId: string | null;
  clientName: string | null;
  estadoCaducidad: EstadoCaducidad;
  fechaVencimientoCaducidad: string | null;
  fechaVencimientoTraslado: string | null;
  fechaAudienciaInicial: string | null;
  createdAt: string;
  isFlagged: boolean;
}

interface CpacaCardProps {
  item: CpacaItem;
  isDragging?: boolean;
  isFocused?: boolean;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (item: { id: string; type: "cpaca" }, shiftKey: boolean) => void;
  onToggleFlag?: (item: CpacaItem) => void;
}

export function CpacaCard({
  item,
  isDragging = false,
  isFocused = false,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelection,
  onToggleFlag,
}: CpacaCardProps) {
  const navigate = useNavigate();
  
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `cpaca:${item.id}`,
    disabled: isSelectionMode,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const handleClick = (e: React.MouseEvent) => {
    if (isSelectionMode && onToggleSelection) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelection({ id: item.id, type: "cpaca" }, e.shiftKey);
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleSelection) {
      onToggleSelection({ id: item.id, type: "cpaca" }, e.shiftKey);
    }
  };

  // Calculate urgency indicators
  const getUrgencyInfo = () => {
    const urgencies: { label: string; variant: "destructive" | "secondary" | "default"; days?: number }[] = [];
    
    // Caducidad urgency
    if (item.fechaVencimientoCaducidad && item.estadoCaducidad !== "NO_APLICA") {
      const days = differenceInDays(new Date(item.fechaVencimientoCaducidad), new Date());
      if (days <= 7 && days >= 0) {
        urgencies.push({ label: "Caducidad crítica", variant: "destructive", days });
      } else if (days <= 30 && days > 7) {
        urgencies.push({ label: "Caducidad pronto", variant: "secondary", days });
      }
    }
    
    // Traslado urgency
    if (item.fechaVencimientoTraslado) {
      const days = differenceInDays(new Date(item.fechaVencimientoTraslado), new Date());
      if (days <= 3 && days >= 0) {
        urgencies.push({ label: "Traslado crítico", variant: "destructive", days });
      } else if (days <= 10 && days > 3) {
        urgencies.push({ label: "Traslado pronto", variant: "secondary", days });
      }
    }
    
    return urgencies;
  };

  const urgencies = getUrgencyInfo();
  const medioInfo = MEDIOS_DE_CONTROL[item.medioDeControl];
  const caducidadInfo = ESTADOS_CADUCIDAD[item.estadoCaducidad];

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...(isSelectionMode ? {} : { ...attributes, ...listeners })}
      onClick={handleClick}
      className={cn(
        "cursor-grab active:cursor-grabbing transition-all duration-200",
        "hover:shadow-md hover:border-primary/50",
        isDragging && "opacity-50 rotate-2 scale-105 shadow-xl",
        isFocused && "ring-2 ring-primary ring-offset-2",
        isSelected && "ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-950/20",
        item.estadoCaducidad === "VENCIDO" && "border-red-400 bg-red-50/50 dark:bg-red-950/10",
        item.estadoCaducidad === "RIESGO" && "border-amber-400 bg-amber-50/50 dark:bg-amber-950/10",
        item.isFlagged && "ring-2 ring-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20"
      )}
    >
      <CardContent className="p-3 space-y-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            {isSelectionMode && (
              <Checkbox
                checked={isSelected}
                onClick={handleCheckboxClick}
                className="mt-0.5"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Scale className="h-4 w-4 text-indigo-500 flex-shrink-0" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-xs truncate max-w-[120px]">
                      {medioInfo.shortLabel}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>{medioInfo.label}</TooltipContent>
                </Tooltip>
                <ClientRequiredBadge hasClient={!!item.clientId} />
                {item.isFlagged && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-amber-500/20 text-amber-500 border-amber-500/30">
                    <Flag className="h-2.5 w-2.5 mr-0.5 fill-current" />
                    Marcado
                  </Badge>
                )}
              </div>
              {item.radicado && (
                <p className="text-xs font-mono text-muted-foreground mt-1 truncate">
                  {item.radicado}
                </p>
              )}
              {item.titulo && (
                <p className="text-sm font-medium mt-1 line-clamp-2">
                  {item.titulo}
                </p>
              )}
            </div>
          </div>
          
          {/* Caducidad badge */}
          {item.estadoCaducidad !== "NO_APLICA" && (
            <Badge variant={caducidadInfo.variant} className="text-xs flex-shrink-0">
              {caducidadInfo.label}
            </Badge>
          )}
        </div>

        {/* Urgency badges */}
        {urgencies.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {urgencies.map((u, i) => (
              <Badge key={i} variant={u.variant} className="text-xs">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {u.label} {u.days !== undefined && `(${u.days}d)`}
              </Badge>
            ))}
          </div>
        )}

        {/* Despacho */}
        {item.despachoNombre && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Building2 className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{item.despachoNombre}</span>
          </div>
        )}

        {/* Client link */}
        <div onClick={(e) => e.stopPropagation()}>
          <EntityClientLink
            entityId={item.id}
            entityType="cpaca"
            entityLabel={`CPACA: ${item.radicado || item.titulo || "Sin identificar"}`}
            currentClientId={item.clientId}
            currentClientName={item.clientName}
            compact
          />
        </div>

        {/* Parties */}
        {item.demandantes && (
          <div className="flex items-start gap-1 text-xs text-muted-foreground">
            <Users className="h-3 w-3 flex-shrink-0 mt-0.5" />
            <span className="line-clamp-1">
              <span className="font-medium">Dte:</span> {item.demandantes}
            </span>
          </div>
        )}
        {item.demandados && (
          <div className="flex items-start gap-1 text-xs text-muted-foreground">
            <Users className="h-3 w-3 flex-shrink-0 mt-0.5" />
            <span className="line-clamp-1">
              <span className="font-medium">Ddo:</span> {item.demandados}
            </span>
          </div>
        )}

        {/* Key dates */}
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {item.fechaVencimientoCaducidad && item.estadoCaducidad !== "NO_APLICA" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>Cad: {format(new Date(item.fechaVencimientoCaducidad), "dd/MM/yy")}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>Vencimiento caducidad</TooltipContent>
            </Tooltip>
          )}
          {item.fechaAudienciaInicial && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  <span>Aud: {format(new Date(item.fechaAudienciaInicial), "dd/MM/yy")}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>Audiencia inicial</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Created date */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <FileText className="h-3 w-3" />
          <span>Creado: {format(new Date(item.createdAt), "dd/MM/yyyy", { locale: es })}</span>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/work-items/${item.id}`);
            }}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Ver detalle
          </Button>
          {onToggleFlag && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 text-xs",
                item.isFlagged 
                  ? "text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/50" 
                  : "hover:bg-muted hover:text-amber-500"
              )}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFlag(item);
              }}
            >
              <Flag className={cn("h-3 w-3", item.isFlagged && "fill-current")} />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
