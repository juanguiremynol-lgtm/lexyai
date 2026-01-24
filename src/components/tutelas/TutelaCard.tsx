import { useDraggable } from "@dnd-kit/core";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ClientRequiredBadge } from "@/components/shared/ClientRequiredBadge";
import { Calendar, FileText, Gavel, Archive, ExternalLink, AlertTriangle, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import type { TutelaPhase } from "@/lib/tutela-constants";
import { TUTELA_FINAL_PHASES } from "@/lib/tutela-constants";
import { EntityClientLink } from "@/components/shared/EntityClientLink";

export interface TutelaItem {
  id: string;
  type: "tutela";
  filingType: string;
  radicado: string | null;
  courtName: string | null;
  createdAt: string;
  status: string;
  phase: TutelaPhase;
  clientId: string | null;
  clientName: string | null;
  demandantes: string | null;
  demandados: string | null;
  lastArchivedPromptAt: string | null;
  isFavorable: boolean | null;
  isFlagged: boolean;
  // Compliance tracking
  complianceReported: boolean;
  complianceReportedAt: string | null;
  hasDesacatoIncident: boolean;
}

interface TutelaCardProps {
  item: TutelaItem;
  isDragging?: boolean;
  isFocused?: boolean;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (item: { id: string; type: "tutela" }, shiftKey: boolean) => void;
  onArchivePrompt?: (item: TutelaItem) => void;
  onInitiateDesacato?: (item: TutelaItem) => void;
  onReportIncumplimiento?: (item: TutelaItem) => void;
  onToggleFlag?: (item: TutelaItem) => void;
}

export function TutelaCard({
  item,
  isDragging = false,
  isFocused = false,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelection,
  onArchivePrompt,
  onInitiateDesacato,
  onReportIncumplimiento,
  onToggleFlag,
}: TutelaCardProps) {
  const navigate = useNavigate();
  
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `tutela:${item.id}`,
    disabled: isSelectionMode,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const handleClick = (e: React.MouseEvent) => {
    if (isSelectionMode && onToggleSelection) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelection({ id: item.id, type: "tutela" }, e.shiftKey);
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleSelection) {
      onToggleSelection({ id: item.id, type: "tutela" }, e.shiftKey);
    }
  };

  const isFinalPhase = TUTELA_FINAL_PHASES.includes(item.phase);
  const showArchiveButton = isFinalPhase && onArchivePrompt;
  // Show desacato button if: final phase, favorable ruling, and NOT already has desacato
  const showDesacatoButton = isFinalPhase && item.isFavorable && !item.hasDesacatoIncident && onInitiateDesacato;
  // Show incumplimiento button if: final phase, favorable ruling, NOT already reported, and no desacato yet
  const showIncumplimientoButton = isFinalPhase && item.isFavorable && !item.complianceReported && !item.hasDesacatoIncident && onReportIncumplimiento;

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
        isFinalPhase && item.isFavorable && "border-green-300 bg-green-50/50 dark:bg-green-950/10",
        isFinalPhase && !item.isFavorable && "border-red-300 bg-red-50/50 dark:bg-red-950/10",
        item.isFlagged && "ring-2 ring-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20"
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
              <div className="flex items-center gap-2">
                <Gavel className="h-4 w-4 text-purple-500" />
                <p className="text-sm font-medium">Tutela</p>
                <ClientRequiredBadge hasClient={!!item.clientId} />
                {item.isFlagged && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-amber-500/20 text-amber-500 border-amber-500/30">
                    <Flag className="h-2.5 w-2.5 mr-0.5 fill-current" />
                    Marcado
                  </Badge>
                )}
              </div>
              {item.radicado && (
                <p className="text-xs font-mono text-muted-foreground mt-1">
                  {item.radicado}
                </p>
              )}
            </div>
          </div>
          {isFinalPhase && (
            <div className="flex flex-col items-end gap-1">
              <Badge 
                variant={item.isFavorable ? "default" : "destructive"}
                className="text-xs"
              >
                {item.isFavorable ? "Favorable" : "Desfavorable"}
              </Badge>
              {item.hasDesacatoIncident && (
                <Badge 
                  variant="outline"
                  className="text-[9px] px-1 py-0 h-4 border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950/30"
                >
                  <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                  Desacato
                </Badge>
              )}
              {item.complianceReported && !item.hasDesacatoIncident && (
                <Badge 
                  variant="outline"
                  className="text-[9px] px-1 py-0 h-4 border-red-500 text-red-600 bg-red-50 dark:bg-red-950/30"
                >
                  Incumplido
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Court name */}
        {item.courtName && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <FileText className="h-3 w-3" />
            <span className="truncate">{item.courtName}</span>
          </div>
        )}

        {/* Client link */}
        <div onClick={(e) => e.stopPropagation()}>
          <EntityClientLink
            entityId={item.id}
            entityType="tutela"
            entityLabel={`Tutela: ${item.radicado || item.demandantes || "Sin radicado"}`}
            currentClientId={item.clientId}
            currentClientName={item.clientName}
            compact
          />
        </div>

        {/* Parties */}
        {item.demandantes && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Accionante:</span>{" "}
            <span className="truncate">{item.demandantes}</span>
          </div>
        )}
        {item.demandados && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Accionado:</span>{" "}
            <span className="truncate">{item.demandados}</span>
          </div>
        )}

        {/* Created date */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          <span>{format(new Date(item.createdAt), "dd/MM/yyyy", { locale: es })}</span>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs flex-1"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/filings/${item.id}`);
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

          {showArchiveButton && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onArchivePrompt(item);
              }}
            >
              <Archive className="h-3 w-3 mr-1" />
              Archivar
            </Button>
          )}

          {showIncumplimientoButton && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
              onClick={(e) => {
                e.stopPropagation();
                onReportIncumplimiento(item);
              }}
            >
              <AlertTriangle className="h-3 w-3 mr-1" />
              Incumplimiento
            </Button>
          )}

          {showDesacatoButton && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-orange-300 text-orange-600 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950/30"
              onClick={(e) => {
                e.stopPropagation();
                onInitiateDesacato(item);
              }}
            >
              <AlertTriangle className="h-3 w-3 mr-1" />
              Desacato
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
