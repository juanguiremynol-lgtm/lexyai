import { useDraggable } from "@dnd-kit/core";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Building2, Calendar, Clock, ExternalLink, Gavel } from "lucide-react";
import { cn } from "@/lib/utils";
import { isPast, format } from "date-fns";
import { es } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import type { PeticionPhase } from "@/lib/peticiones-constants";
import { EntityClientLink } from "@/components/shared/EntityClientLink";

export interface PeticionItem {
  id: string;
  entityName: string;
  entityType: "PUBLIC" | "PRIVATE";
  subject: string;
  radicado: string | null;
  filedAt: string | null;
  deadlineAt: string | null;
  prorogationRequested: boolean;
  prorogationDeadlineAt: string | null;
  phase: PeticionPhase;
  escalatedToTutela: boolean;
  tutelaFilingId: string | null;
  clientId: string | null;
  clientName: string | null;
}

interface PeticionCardProps {
  item: PeticionItem;
  isDragging?: boolean;
  isFocused?: boolean;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (item: { id: string; type: "peticion" }, shiftKey: boolean) => void;
  onEscalateToTutela?: (item: PeticionItem) => void;
}

export function PeticionCard({
  item,
  isDragging = false,
  isFocused = false,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelection,
  onEscalateToTutela,
}: PeticionCardProps) {
  const navigate = useNavigate();
  
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `peticion:${item.id}`,
    disabled: isSelectionMode,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const handleClick = (e: React.MouseEvent) => {
    if (isSelectionMode && onToggleSelection) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelection({ id: item.id, type: "peticion" }, e.shiftKey);
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleSelection) {
      onToggleSelection({ id: item.id, type: "peticion" }, e.shiftKey);
    }
  };

  // Calculate deadline status
  const effectiveDeadline = item.prorogationRequested && item.prorogationDeadlineAt
    ? new Date(item.prorogationDeadlineAt)
    : item.deadlineAt
    ? new Date(item.deadlineAt)
    : null;

  const isOverdue = effectiveDeadline && isPast(effectiveDeadline) && item.phase !== "RESPUESTA";
  const daysUntilDeadline = effectiveDeadline 
    ? Math.ceil((effectiveDeadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  const getDeadlineBadge = () => {
    if (item.phase === "RESPUESTA") return null;
    if (!effectiveDeadline) return null;
    
    if (isOverdue) {
      return (
        <Badge variant="destructive" className="text-xs">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Vencida
        </Badge>
      );
    }
    
    if (daysUntilDeadline !== null && daysUntilDeadline <= 3) {
      return (
        <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">
          <Clock className="h-3 w-3 mr-1" />
          {daysUntilDeadline} días
        </Badge>
      );
    }
    
    if (daysUntilDeadline !== null && daysUntilDeadline <= 7) {
      return (
        <Badge variant="outline" className="text-xs">
          <Clock className="h-3 w-3 mr-1" />
          {daysUntilDeadline} días
        </Badge>
      );
    }
    
    return null;
  };

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
        isOverdue && "border-red-300 bg-red-50/50 dark:bg-red-950/10",
        item.escalatedToTutela && "border-purple-300 bg-purple-50/50 dark:bg-purple-950/10"
      )}
    >
      <CardContent className="p-3 space-y-2">
        {/* Header with selection checkbox */}
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
              <p className="text-sm font-medium truncate">{item.subject}</p>
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                <Building2 className="h-3 w-3" />
                <span className="truncate">{item.entityName}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            {getDeadlineBadge()}
            {item.prorogationRequested && (
              <Badge variant="outline" className="text-xs">
                Prórroga
              </Badge>
            )}
          </div>
        </div>

        {/* Entity type badge */}
        <div className="flex items-center gap-2">
          <Badge 
            variant="secondary" 
            className={cn(
              "text-xs",
              item.entityType === "PUBLIC" 
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                : "bg-slate-100 text-slate-700 dark:bg-slate-900/50 dark:text-slate-300"
            )}
          >
            {item.entityType === "PUBLIC" ? "Pública" : "Privada"}
          </Badge>
          {item.radicado && (
            <span className="text-xs font-mono text-muted-foreground">
              {item.radicado}
            </span>
          )}
        </div>

        {/* Client link */}
        <div onClick={(e) => e.stopPropagation()}>
          <EntityClientLink
            entityId={item.id}
            entityType="peticion"
            entityLabel={`Petición: ${item.subject}`}
            currentClientId={item.clientId}
            currentClientName={item.clientName}
            compact
          />
        </div>

        {/* Filed date and deadline */}
        {item.filedAt && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>Radicada: {format(new Date(item.filedAt), "dd/MM/yyyy", { locale: es })}</span>
          </div>
        )}

        {effectiveDeadline && item.phase !== "RESPUESTA" && (
          <div className={cn(
            "flex items-center gap-1 text-xs",
            isOverdue ? "text-red-600" : "text-muted-foreground"
          )}>
            <Clock className="h-3 w-3" />
            <span>
              Vence: {format(effectiveDeadline, "dd/MM/yyyy", { locale: es })}
              {item.prorogationRequested && " (prórroga)"}
            </span>
          </div>
        )}

        {/* Escalation to tutela */}
        {item.escalatedToTutela ? (
          <div className="flex items-center gap-1 text-xs text-purple-600">
            <Gavel className="h-3 w-3" />
            <span>Escalada a Tutela</span>
            {item.tutelaFilingId && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/filings/${item.tutelaFilingId}`);
                }}
              >
                <ExternalLink className="h-3 w-3" />
              </Button>
            )}
          </div>
        ) : isOverdue && onEscalateToTutela && (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs h-7 text-purple-600 border-purple-300 hover:bg-purple-50"
            onClick={(e) => {
              e.stopPropagation();
              onEscalateToTutela(item);
            }}
          >
            <Gavel className="h-3 w-3 mr-1" />
            Escalar a Tutela
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
