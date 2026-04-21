import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  Gavel,
  Users,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  normalizePortal,
  PORTAL_BADGE_CLASS,
  PORTAL_LABEL,
} from "@/lib/alerts/portal-badge";
import { useAndromedaRadicado } from "@/hooks/useAndromedaRadicado";

export interface GroupedAlertItem {
  id: string;
  entity_id: string;
  entity_type: string;
  alert_type: string | null;
  alert_source: string | null;
  severity: string;
  status: string;
  title: string;
  message: string;
  fired_at: string;
  read_at: string | null;
  payload: Record<string, unknown> | null;
}

interface AlertGroupedRowProps {
  entityId: string;
  alerts: GroupedAlertItem[]; // already sorted desc by fired_at
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  isDismissing?: boolean;
}

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  return String(v);
}

export function AlertGroupedRow({
  entityId,
  alerts,
  selectedIds,
  onToggleSelect,
  onMarkRead,
  onDismiss,
  isDismissing,
}: AlertGroupedRowProps) {
  const [expanded, setExpanded] = useState(false);
  const head = alerts[0];
  const headPayload = (head.payload ?? {}) as Record<string, unknown>;

  const portal = normalizePortal(
    asString(headPayload.portal) ?? head.alert_source ?? null,
  );
  const radicadoPayload = asString(headPayload.radicado);
  const despachoPayload = asString(headPayload.despacho);
  const demandantePayload = asString(headPayload.demandante);
  const demandadoPayload = asString(headPayload.demandado);
  const needsFallback =
    !despachoPayload || !demandantePayload || !demandadoPayload || !radicadoPayload;
  const { data: andro } = useAndromedaRadicado(radicadoPayload, needsFallback);

  const radicado = radicadoPayload;
  const despacho = despachoPayload ?? asString(andro?.despacho_nombre);
  const demandante = demandantePayload ?? asString(andro?.demandante);
  const demandado = demandadoPayload ?? asString(andro?.demandado);

  const unreadCount = alerts.filter((a) => !a.read_at).length;
  const total = alerts.length;
  const lastDetectedAgo = formatDistanceToNow(new Date(head.fired_at), {
    addSuffix: true,
    locale: es,
  });

  const allSelected = alerts.every((a) => selectedIds.has(a.id));
  const someSelected = alerts.some((a) => selectedIds.has(a.id));

  const toggleAllInGroup = () => {
    if (allSelected) {
      alerts.forEach((a) => {
        if (selectedIds.has(a.id)) onToggleSelect(a.id);
      });
    } else {
      alerts.forEach((a) => {
        if (!selectedIds.has(a.id)) onToggleSelect(a.id);
      });
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border transition-colors",
        unreadCount > 0 ? "bg-muted/40 border-primary/20" : "bg-background",
        someSelected && "ring-2 ring-primary",
      )}
    >
      {/* Header (clickable to expand) */}
      <div className="flex items-start gap-3 p-4">
        <div className="flex-shrink-0 pt-0.5">
          <Checkbox
            checked={allSelected}
            onCheckedChange={toggleAllInGroup}
            aria-label="Seleccionar todas las notificaciones del expediente"
          />
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-shrink-0 mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={expanded ? "Colapsar" : "Expandir"}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => setExpanded((v) => !v)}
        >
          {/* Header badges */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <Badge
              variant="outline"
              className={cn("text-[10px] font-semibold", PORTAL_BADGE_CLASS[portal])}
            >
              {PORTAL_LABEL[portal]}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {total} {total === 1 ? "actuación nueva" : "actuaciones nuevas"}
            </Badge>
            {unreadCount > 0 && (
              <Badge className="bg-primary text-primary-foreground text-[10px]">
                {unreadCount} sin leer
              </Badge>
            )}
          </div>

          {/* Radicado */}
          {radicado && (
            <p className="text-xs text-muted-foreground mb-0.5">
              Radicado: <code className="bg-muted px-1 rounded">{radicado}</code>
            </p>
          )}

          {/* Despacho */}
          {despacho && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-0.5">
              <Gavel className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{despacho}</span>
            </p>
          )}

          {/* Partes */}
          {(demandante || demandado) && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
              <Users className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">
                <span className="font-medium text-foreground/80">
                  {demandante ?? "—"}
                </span>
                <span className="mx-1.5 text-muted-foreground">vs</span>
                <span className="font-medium text-foreground/80">
                  {demandado ?? "—"}
                </span>
              </span>
            </p>
          )}

          <div className="flex items-center gap-1 mt-2 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Última actuación {lastDetectedAgo}</span>
          </div>
        </div>

        {/* Group actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {entityId && (
            <Button
              variant="ghost"
              size="sm"
              asChild
              title="Ver expediente"
              onClick={(e) => e.stopPropagation()}
            >
              <Link to={`/app/work-items/${entityId}`}>
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Expanded list of individual actuaciones */}
      {expanded && (
        <div className="border-t bg-background/50 divide-y">
          {alerts.map((a) => {
            const p = (a.payload ?? {}) as Record<string, unknown>;
            const tipoActuacion = asString(p.tipo_actuacion);
            const isUnread = !a.read_at;
            const detectedAgo = formatDistanceToNow(new Date(a.fired_at), {
              addSuffix: true,
              locale: es,
            });
            return (
              <div
                key={a.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3",
                  selectedIds.has(a.id) && "bg-primary/5",
                )}
              >
                <div className="flex-shrink-0 pt-1">
                  <Checkbox
                    checked={selectedIds.has(a.id)}
                    onCheckedChange={() => onToggleSelect(a.id)}
                    aria-label={`Seleccionar: ${a.title}`}
                  />
                </div>
                <div
                  className={cn(
                    "h-2 w-2 rounded-full mt-2 flex-shrink-0",
                    isUnread ? "bg-primary" : "bg-transparent",
                  )}
                  aria-label={isUnread ? "No leída" : undefined}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    {tipoActuacion && (
                      <Badge variant="outline" className="text-[10px]">
                        {tipoActuacion}
                      </Badge>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {detectedAgo}
                    </span>
                  </div>
                  <p className="text-sm line-clamp-2">
                    {a.message || a.title}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {isUnread && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onMarkRead(a.id)}
                      title="Marcar leída"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDismiss(a.id)}
                    disabled={isDismissing}
                    title="Descartar"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}