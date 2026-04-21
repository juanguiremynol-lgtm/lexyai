import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Clock,
  ExternalLink,
  Gavel,
  Info,
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

interface AlertLike {
  id: string;
  entity_id: string;
  entity_type: string;
  severity: string;
  status: string;
  title: string;
  message: string;
  fired_at: string;
  read_at?: string | null;
  alert_source?: string | null;
  payload?: Record<string, unknown> | null;
}

interface AlertConsolidatedRowProps {
  alert: AlertLike;
  isSelected?: boolean;
  showCheckbox?: boolean;
  onToggleSelect?: (id: string) => void;
  onAcknowledge?: (id: string) => void;
  onDismiss?: (id: string) => void;
  isDismissing?: boolean;
}

function severityIcon(severity: string) {
  switch (severity) {
    case "CRITICAL":
    case "error":
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    case "WARN":
    case "WARNING":
      return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    default:
      return <Info className="h-4 w-4 text-primary" />;
  }
}

function severityBadge(severity: string) {
  switch (severity) {
    case "CRITICAL":
    case "error":
      return <Badge variant="destructive" className="text-[10px]">Crítica</Badge>;
    case "WARN":
    case "WARNING":
      return <Badge className="bg-amber-500 text-white text-[10px]">Advertencia</Badge>;
    default:
      return <Badge variant="secondary" className="text-[10px]">Info</Badge>;
  }
}

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (Array.isArray(v)) {
    const joined = v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).filter(Boolean).join(", ");
    return joined || null;
  }
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return null;
    }
  }
  return String(v);
}

function formatFecha(value: unknown): string | null {
  const s = asString(value);
  if (!s) return null;
  // Try ISO date
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
  }
  return s;
}

function extractRadicado(alert: AlertLike, payloadRadicado: string | null): string | null {
  if (payloadRadicado) return payloadRadicado;
  const RX = /\b\d{23}\b/;
  return alert.title?.match(RX)?.[0] ?? alert.message?.match(RX)?.[0] ?? null;
}

export function AlertConsolidatedRow({
  alert,
  isSelected,
  showCheckbox = true,
  onToggleSelect,
  onAcknowledge,
  onDismiss,
  isDismissing,
}: AlertConsolidatedRowProps) {
  const payload = (alert.payload ?? {}) as Record<string, unknown>;
  const portal = normalizePortal(
    asString(payload.portal) ?? alert.alert_source ?? null,
  );
  const radicado = asString(payload.radicado);
  const despacho = asString(payload.despacho);
  const demandante = asString(payload.demandante);
  const demandado = asString(payload.demandado);
  const tipoActuacion = asString(payload.tipo_actuacion);
  const fechaAuto = formatFecha(payload.fecha_auto);
  const detectedAgo = formatDistanceToNow(new Date(alert.fired_at), {
    addSuffix: true,
    locale: es,
  });
  const isUnread = alert.status === "PENDING" && !alert.read_at;

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 rounded-lg border transition-colors",
        isUnread ? "bg-muted/40 border-primary/20" : "bg-background",
        isSelected && "ring-2 ring-primary",
      )}
    >
      {showCheckbox && (
        <div className="flex-shrink-0 pt-0.5">
          <Checkbox
            checked={!!isSelected}
            onCheckedChange={() => onToggleSelect?.(alert.id)}
            aria-label={`Seleccionar alerta: ${alert.title}`}
          />
        </div>
      )}
      <div className="flex-shrink-0 mt-0.5">{severityIcon(alert.severity)}</div>
      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <Badge variant="outline" className={cn("text-[10px] font-semibold", PORTAL_BADGE_CLASS[portal])}>
            {PORTAL_LABEL[portal]}
          </Badge>
          {severityBadge(alert.severity)}
          {tipoActuacion && (
            <Badge variant="outline" className="text-[10px]">
              {tipoActuacion}
            </Badge>
          )}
          {isUnread && (
            <Badge variant="outline" className="text-[10px]">Nueva</Badge>
          )}
          {fechaAuto && (
            <span className="text-[11px] text-muted-foreground ml-auto">
              Fecha auto: {fechaAuto}
            </span>
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
              <span className="font-medium text-foreground/80">{demandante ?? "—"}</span>
              <span className="mx-1.5 text-muted-foreground">vs</span>
              <span className="font-medium text-foreground/80">{demandado ?? "—"}</span>
            </span>
          </p>
        )}

        {/* Message */}
        <p className="text-sm line-clamp-2 mt-1">{alert.message || alert.title}</p>

        {/* Footer */}
        <div className="flex items-center gap-1 mt-2 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>Detectado {detectedAgo}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {alert.entity_id && (
          <Button variant="ghost" size="sm" asChild title="Ver expediente">
            <Link to={`/app/work-items/${alert.entity_id}`}>
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        )}
        {alert.status === "PENDING" && onAcknowledge && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onAcknowledge(alert.id)}
            title="Reconocer"
          >
            <Check className="h-4 w-4" />
          </Button>
        )}
        {onDismiss && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDismiss(alert.id)}
            disabled={isDismissing}
            title="Descartar"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}