import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SlaBadge } from "@/components/ui/sla-badge";
import { User, ExternalLink, Scale, FileText, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

export interface UnifiedItem {
  id: string;
  type: "filing" | "process";
  radicado: string | null;
  // Shared fields
  clientName: string | null;
  despachoName: string | null;
  demandantes: string | null;
  demandados: string | null;
  // Filing-specific
  filingType?: string;
  matterName?: string | null;
  slaActaDueAt?: string | null;
  slaCourtReplyDueAt?: string | null;
  filingStatus?: string;
  // Process-specific
  lastCheckedAt?: string | null;
  monitoringEnabled?: boolean;
  phase?: string | null;
  // Linking
  linkedFilingId?: string | null;
  linkedProcessId?: string | null;
  hasAutoAdmisorio?: boolean;
}

interface UnifiedPipelineCardProps {
  item: UnifiedItem;
  isDragging?: boolean;
  onReclassify?: (item: UnifiedItem) => void;
}

export function UnifiedPipelineCard({ 
  item, 
  isDragging = false,
  onReclassify,
}: UnifiedPipelineCardProps) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `${item.type}:${item.id}`,
    data: { item },
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  const detailPath = item.type === "filing" 
    ? `/filings/${item.id}` 
    : `/process-status/${item.id}`;

  const relevantSla = item.filingStatus === "ACTA_PENDING"
    ? item.slaActaDueAt
    : item.slaCourtReplyDueAt;

  const isLinked = item.linkedFilingId || item.linkedProcessId;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "cursor-grab active:cursor-grabbing transition-all duration-200 group",
        "shadow-sm",
        isDragging && "opacity-90 shadow-xl scale-105 rotate-2 ring-2 ring-primary z-50",
        !isDragging && "hover:shadow-lg hover:ring-2 hover:ring-primary/40 hover:-translate-y-0.5",
        // Enhanced type-specific styling
        item.type === "filing" && "border-l-4 border-l-blue-500 bg-gradient-to-r from-blue-50/50 to-transparent dark:from-blue-950/30",
        item.type === "process" && "border-l-4 border-l-emerald-500 bg-gradient-to-r from-emerald-50/50 to-transparent dark:from-emerald-950/30"
      )}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          {/* Navigation and reclassify buttons */}
          <div className="flex flex-col gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 transition-all",
                item.type === "filing" 
                  ? "hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900/50" 
                  : "hover:bg-emerald-100 hover:text-emerald-700 dark:hover:bg-emerald-900/50"
              )}
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
            {onReclassify && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-amber-100 hover:text-amber-700 dark:hover:bg-amber-900/50 transition-all"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onReclassify(item);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                title="Reclasificar"
              >
                <ArrowRightLeft className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Type indicator badge */}
            <div className="flex items-center gap-1.5 mb-2">
              <Badge 
                variant="secondary" 
                className={cn(
                  "text-[10px] px-1.5 py-0.5 font-medium",
                  item.type === "filing" 
                    ? "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-800" 
                    : "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-800"
                )}
              >
                {item.type === "filing" ? (
                  <FileText className="h-3 w-3 mr-1" />
                ) : (
                  <Scale className="h-3 w-3 mr-1" />
                )}
                {item.type === "filing" ? "Radicación" : "Proceso"}
              </Badge>
              {isLinked && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-violet-50 text-violet-600 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300">
                  Vinculado
                </Badge>
              )}
            </div>

            {/* Radicado - more prominent */}
            {item.radicado && (
              <p className="font-mono text-sm font-semibold text-foreground truncate mb-1">
                {item.radicado}
              </p>
            )}

            {/* Client/Matter info */}
            <p className="text-sm font-medium text-foreground/80 truncate">
              {item.clientName || item.matterName || "Sin cliente"}
            </p>

            {/* Filing type or despacho */}
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {item.type === "filing" 
                ? item.filingType 
                : item.despachoName || "Sin despacho"}
            </p>

            {/* Parties for processes */}
            {item.type === "process" && (item.demandantes || item.demandados) && (
              <div className="flex items-center gap-1.5 mt-2 p-1.5 bg-muted/50 rounded">
                <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-muted-foreground truncate">
                  {item.demandantes?.split(",")[0] || item.demandados?.split(",")[0]}
                </span>
              </div>
            )}

            {/* SLA for filings or last checked for processes */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
              {item.type === "filing" && relevantSla && (
                <SlaBadge dueDate={relevantSla} size="sm" />
              )}
              {item.type === "process" && item.lastCheckedAt && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {formatDistanceToNow(new Date(item.lastCheckedAt), {
                    addSuffix: true,
                    locale: es,
                  })}
                </p>
              )}
              {!relevantSla && !item.lastCheckedAt && (
                <span className="text-xs text-muted-foreground italic">Sin fecha</span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
