import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Building2,
  Users,
  CheckCircle,
  AlertTriangle,
  Loader2,
  CalendarClock,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { fuenteBadgeClass } from "@/lib/services/andromeda-novedades";
import type { TerminoItem } from "@/lib/services/andromeda-terminos";

interface TerminoCardProps {
  termino: TerminoItem;
  onMarcarAtendido: (notas: string) => void;
  loading?: boolean;
}

function alertaClasses(alerta: string): string {
  const a = (alerta || "").toUpperCase();
  if (a === "VENCIDO") return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-300";
  if (a === "URGENTE") return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-300";
  if (a === "PROXIMO") return "bg-yellow-500/15 text-yellow-800 dark:text-yellow-400 border-yellow-300";
  if (a === "VIGENTE") return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-300";
  return "bg-muted text-muted-foreground border-border";
}

function prioridadClasses(prioridad: string): string {
  const p = (prioridad || "").toUpperCase();
  if (p === "CRITICA") return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-300";
  if (p === "ALTA") return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-300";
  if (p === "NORMAL") return "bg-muted text-muted-foreground border-border";
  return "bg-muted text-muted-foreground border-border";
}

function borderClass(alerta: string, atendido: boolean): string {
  if (atendido) return "border-l-muted-foreground/30";
  const a = (alerta || "").toUpperCase();
  if (a === "VENCIDO") return "border-l-red-500";
  if (a === "URGENTE") return "border-l-orange-500";
  if (a === "PROXIMO") return "border-l-yellow-500";
  if (a === "VIGENTE") return "border-l-green-500";
  return "border-l-primary/30";
}

function formatFecha(fecha: string | null | undefined): string {
  if (!fecha) return "—";
  try {
    return format(new Date(fecha), "dd MMM yyyy", { locale: es });
  } catch {
    return fecha;
  }
}

export function TerminoCard({ termino: t, onMarcarAtendido, loading }: TerminoCardProps) {
  const [notas, setNotas] = useState("");
  const atendido = (t.estado || "").toUpperCase() === "ATENDIDO";
  const alerta = (t.alerta || "").toUpperCase();
  const prioridad = (t.prioridad || "").toUpperCase();

  const partes =
    t.demandante || t.demandado ? `${t.demandante || "—"} vs ${t.demandado || "—"}` : null;

  const diasInfo = atendido
    ? null
    : alerta === "VENCIDO"
      ? `Vencido hace ${t.dias_vencido} día${t.dias_vencido === 1 ? "" : "s"}`
      : t.dias_vencido < 0
        ? `Vence en ${Math.abs(t.dias_vencido)} día${Math.abs(t.dias_vencido) === 1 ? "" : "s"}`
        : null;

  return (
    <Card
      className={cn(
        "transition-shadow hover:shadow-md border-l-4",
        borderClass(alerta, atendido),
        atendido && "opacity-60"
      )}
    >
      <CardContent className="py-4 space-y-3">
        {/* Top row: alerta + prioridad + fuente */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {atendido ? (
              <Badge
                variant="outline"
                className="text-xs bg-green-500/15 text-green-700 dark:text-green-400 border-green-300"
              >
                <CheckCircle className="h-3 w-3 mr-1" />
                Atendido
              </Badge>
            ) : (
              <>
                <Badge variant="outline" className={cn("text-xs font-semibold", alertaClasses(alerta))}>
                  {alerta || "—"}
                </Badge>
                <Badge variant="outline" className={cn("text-xs", prioridadClasses(prioridad))}>
                  {prioridad || "—"}
                </Badge>
              </>
            )}
          </div>
          {t.fuente && (
            <Badge variant="outline" className={cn("text-xs font-medium", fuenteBadgeClass(t.fuente))}>
              {t.fuente}
            </Badge>
          )}
        </div>

        {/* Radicado + workflow */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <p
            className={cn(
              "font-mono text-sm font-semibold text-foreground break-all",
              atendido && "line-through"
            )}
          >
            {t.radicado || "—"}
          </p>
          {t.workflow_type && (
            <Badge variant="secondary" className="text-xs">
              {t.workflow_type}
            </Badge>
          )}
        </div>

        {/* Despacho */}
        {t.despacho && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{t.despacho}</span>
          </div>
        )}

        {/* Partes */}
        {partes && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{partes}</span>
          </div>
        )}

        {/* Bloque destacado: tipo_auto + accion_abogado */}
        {(t.tipo_auto || t.accion_abogado) && (
          <div className="bg-muted/40 rounded p-2 space-y-1">
            {t.tipo_auto && (
              <p className={cn("text-sm font-bold text-foreground", atendido && "line-through")}>
                {t.tipo_auto}
              </p>
            )}
            {t.accion_abogado && (
              <p className={cn("text-sm font-bold text-foreground/90", atendido && "line-through")}>
                {t.accion_abogado}
              </p>
            )}
          </div>
        )}

        {/* Metadatos */}
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
          {t.norma && <span>{t.norma}</span>}
          {t.norma && t.fecha_limite && <span>·</span>}
          {t.fecha_limite && (
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />
              Fecha límite: {formatFecha(t.fecha_limite)}
            </span>
          )}
          {typeof t.dias_habiles === "number" && (
            <>
              <span>·</span>
              <span>{t.dias_habiles} días hábiles</span>
            </>
          )}
          {diasInfo && (
            <>
              <span>·</span>
              <span
                className={cn(
                  "font-semibold",
                  alerta === "VENCIDO" && "text-red-600 dark:text-red-400",
                  alerta === "URGENTE" && "text-orange-600 dark:text-orange-400"
                )}
              >
                {diasInfo}
              </span>
            </>
          )}
        </div>

        {/* Consecuencia */}
        {t.consecuencia && !atendido && (
          <div className="flex items-start gap-1.5 text-xs text-red-700 dark:text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>{t.consecuencia}</span>
          </div>
        )}

        {/* Footer: notas + acción (solo pendientes) */}
        {!atendido && (
          <div className="space-y-2 pt-1">
            <Textarea
              placeholder="¿Qué acción tomó? (opcional)"
              value={notas}
              maxLength={500}
              onChange={(e) => setNotas(e.target.value)}
              className="text-sm min-h-[60px]"
              disabled={loading}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => onMarcarAtendido(notas)}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                Marcar atendido
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}