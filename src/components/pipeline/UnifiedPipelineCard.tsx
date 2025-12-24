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
        isDragging && "opacity-90 shadow-lg scale-105 rotate-2 ring-2 ring-primary",
        !isDragging && "hover:shadow-md hover:ring-2 hover:ring-primary/30",
        item.type === "filing" && "border-l-2 border-l-blue-500",
        item.type === "process" && "border-l-2 border-l-emerald-500"
      )}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          {/* Navigation and reclassify buttons */}
          <div className="flex flex-col gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-60 hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                navigate(detailPath);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title="Ver detalle"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            {onReclassify && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-60 hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onReclassify(item);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                title="Reclasificar"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Type indicator and link badge */}
            <div className="flex items-center gap-1 mb-1">
              {item.type === "filing" ? (
                <FileText className="h-3 w-3 text-blue-500" />
              ) : (
                <Scale className="h-3 w-3 text-emerald-500" />
              )}
              <span className="text-[10px] text-muted-foreground uppercase">
                {item.type === "filing" ? "Radicación" : "Proceso"}
              </span>
              {isLinked && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                  Vinculado
                </Badge>
              )}
            </div>

            {/* Radicado */}
            {item.radicado && (
              <p className="font-mono text-xs truncate">
                {item.radicado}
              </p>
            )}

            {/* Client/Matter info */}
            <p className="text-xs text-muted-foreground truncate">
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
              <div className="flex items-center gap-1 mt-1">
                <User className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground truncate">
                  {item.demandantes?.split(",")[0] || item.demandados?.split(",")[0]}
                </span>
              </div>
            )}

            {/* SLA for filings or last checked for processes */}
            <div className="flex items-center justify-between mt-2">
              {item.type === "filing" && relevantSla && (
                <SlaBadge dueDate={relevantSla} size="sm" />
              )}
              {item.type === "process" && item.lastCheckedAt && (
                <p className="text-[10px] text-muted-foreground">
                  {formatDistanceToNow(new Date(item.lastCheckedAt), {
                    addSuffix: true,
                    locale: es,
                  })}
                </p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
