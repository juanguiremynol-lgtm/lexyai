/**
 * Fase 4 / C.2 — the five card fields, and nothing else:
 *   1. identificador          2. contraparte / autoridad
 *   3. etapa (del catálogo)   4. término más próximo
 *   5. condiciones de atención (dimensión separada de la etapa)
 */
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertTriangle, Clock, Info } from "lucide-react";
import type { AttentionCondition } from "@/hooks/use-workflow-catalog-board";

export interface CatalogCardItem {
  id: string;
  stage: string;
  stageLabel: string;
  identifier: string | null;
  counterparty: string | null;
  nextDeadlineLabel: string | null;
  nextDeadlineDate: string | null;
}

const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: "bg-destructive/15 text-destructive border-destructive/30",
  WARNING: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  INFO: "bg-muted text-muted-foreground border-border",
};

export const CONDITION_LABEL: Record<string, string> = {
  TERMINO_VENCIDO: "Término vencido",
  TERMINO_POR_VENCER: "Término por vencer",
  SUGERENCIA_DE_ETAPA_PENDIENTE: "Sugerencia de etapa pendiente",
  SIN_MOVIMIENTO: "Sin movimiento",
  RESPUESTA_NO_RECIBIDA: "Respuesta no recibida",
};

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "CRITICAL") return <AlertTriangle className="h-3 w-3" />;
  if (severity === "WARNING") return <Clock className="h-3 w-3" />;
  return <Info className="h-3 w-3" />;
}

export function CatalogKanbanCard({
  item,
  conditions,
  isDragging,
  onOpen,
}: {
  item: CatalogCardItem;
  conditions: AttentionCondition[];
  isDragging?: boolean;
  onOpen?: (id: string) => void;
}) {
  return (
    <Card
      className={cn(
        "transition-all duration-200 cursor-pointer",
        isDragging ? "opacity-90 shadow-lg ring-2 ring-primary" : "hover:shadow-md",
      )}
      onClick={() => onOpen?.(item.id)}
    >
      <CardContent className="p-3 space-y-1.5">
        <p className="font-medium text-sm truncate">
          {item.identifier ?? "Sin identificador"}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {item.counterparty ?? "Contraparte no registrada"}
        </p>
        <Badge variant="outline" className="text-[10px]">
          {item.stageLabel}
        </Badge>
        <p className="text-xs text-muted-foreground">
          {item.nextDeadlineDate
            ? `Próximo término: ${item.nextDeadlineLabel ?? "término"} — ${item.nextDeadlineDate}`
            : "Sin término vigente"}
        </p>
        {conditions.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {conditions.map((c, i) => (
              <span
                key={`${c.objectId ?? c.conditionType}-${i}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]",
                  SEVERITY_STYLE[c.severity] ?? SEVERITY_STYLE.INFO,
                )}
                title={c.detail ?? undefined}
              >
                <SeverityIcon severity={c.severity} />
                {CONDITION_LABEL[c.conditionType] ?? c.conditionType}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
