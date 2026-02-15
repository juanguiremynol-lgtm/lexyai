/**
 * DemoResultModal — Full-screen modal showing demo radicado results
 *
 * Presents: Resumen card, Coverage summary, Actuaciones timeline, Estados list,
 * Work Item preview, Mini Kanban sandbox, Andro IA mascot bubble.
 * All ephemeral — no DB, no localStorage.
 */

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  X, Scale, MapPin, Calendar, FileText, Activity, LayoutGrid,
  Building2, Clock, ArrowRight, User, Users, CheckCircle2, XCircle,
  AlertTriangle, Info, ChevronDown, ChevronUp, Zap,
} from "lucide-react";
import { DemoActuacionesTimeline } from "./DemoActuacionesTimeline";
import { DemoEstadosList } from "./DemoEstadosList";
import { DemoMiniKanban } from "./DemoMiniKanban";
import { DemoWorkItemCard } from "./DemoWorkItemCard";
import { DemoAteniaMascot } from "./DemoAteniaMascot";
import { Link } from "react-router-dom";
import type { DemoResult, ProviderOutcome } from "./demo-types";
import { useMemo, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// Category display mapping
const CATEGORY_LABELS: Record<string, { label: string; shortLabel: string; emoji: string }> = {
  CGP: { label: "Código General del Proceso", shortLabel: "CGP", emoji: "⚖️" },
  CPACA: { label: "Contencioso Administrativo", shortLabel: "CPACA", emoji: "🏛️" },
  TUTELA: { label: "Acción de Tutela", shortLabel: "Tutela", emoji: "🛡️" },
  LABORAL: { label: "Laboral", shortLabel: "Laboral", emoji: "👷" },
  PENAL_906: { label: "Penal (Ley 906)", shortLabel: "Penal", emoji: "🔒" },
  DESCONOCIDA: { label: "Sin clasificar", shortLabel: "Sin clasificar", emoji: "❓" },
};

interface DemoResultModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: DemoResult | null;
}

export function DemoResultModal({ open, onOpenChange, data }: DemoResultModalProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const categoryMeta = useMemo(() => {
    if (!data?.category_inference) return null;
    return CATEGORY_LABELS[data.category_inference.category] || CATEGORY_LABELS.DESCONOCIDA;
  }, [data]);

  if (!data) return null;
  const { resumen, actuaciones, estados, meta, category_inference, conflicts } = data;

  const confidenceLabel: Record<string, string> = {
    HIGH: "Alta confianza",
    MEDIUM: "Confianza media",
    LOW: "Confianza baja",
  };

  const providersChecked = meta.providers_checked || meta.provider_outcomes?.length || 0;
  const providersWithData = meta.providers_with_data || meta.sources?.length || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[98vw] sm:w-[95vw] h-[95vh] sm:h-[90vh] p-0 gap-0 overflow-hidden rounded-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="font-mono text-xs">
                {resumen.radicado_display}
              </Badge>
              <Badge className="text-xs bg-primary/10 text-primary border-primary/20">
                Demo
              </Badge>
              {categoryMeta && category_inference && (
                <Badge className="text-xs bg-accent/15 text-accent-foreground border-accent/30 border">
                  {categoryMeta.emoji} {categoryMeta.label}
                  <span className="ml-1 opacity-60">({confidenceLabel[category_inference.confidence]})</span>
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {categoryMeta && category_inference && category_inference.category !== "DESCONOCIDA"
                ? `Andromeda identificó este caso como ${categoryMeta.shortLabel}`
                : "Así se vería este proceso en Andromeda"}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1 h-[calc(95vh-140px)] sm:h-[calc(90vh-140px)]">
          <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
            {/* Coverage Summary Bar */}
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Cobertura de fuentes</span>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {providersWithData} de {providersChecked} fuentes con datos
                  </Badge>
                  {meta.fetched_at && (
                    <span className="text-xs text-muted-foreground">
                      Consultado: {new Date(meta.fetched_at).toLocaleTimeString("es-CO")}
                    </span>
                  )}
                </div>
                <Collapsible open={sourcesOpen} onOpenChange={setSourcesOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-xs gap-1.5 h-7">
                      <Info className="h-3.5 w-3.5" />
                      Ver fuentes
                      {sourcesOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3">
                    <ProviderOutcomesPanel outcomes={meta.provider_outcomes || []} />
                  </CollapsibleContent>
                </Collapsible>
              </div>
              {providersWithData > 1 && (
                <p className="text-xs text-muted-foreground mt-2">
                  ✓ Múltiples fuentes coincidieron para este radicado — los datos han sido consolidados y deduplicados.
                </p>
              )}
            </div>

            {/* Conflicts Banner */}
            {conflicts && conflicts.length > 0 && (
              <div className="rounded-lg border border-amber-300/50 bg-amber-50/50 dark:bg-amber-950/20 p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      Las fuentes reportan datos diferentes
                    </p>
                    <div className="mt-2 space-y-2">
                      {conflicts.map((c, i) => (
                        <div key={i} className="text-xs text-amber-700 dark:text-amber-400">
                          <span className="font-medium capitalize">{c.field}:</span>{" "}
                          {c.variants.map((v, j) => (
                            <span key={j}>
                              {j > 0 && " vs "}
                              <span className="font-mono">{v.value}</span>
                              <span className="opacity-60"> ({v.provider})</span>
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-amber-600/80 dark:text-amber-400/60 mt-1">
                      Andromeda muestra el primer valor encontrado. En tu cuenta podrías revisar cada fuente en detalle.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Resumen Card */}
            <div className="rounded-lg border bg-card p-5 space-y-4">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Scale className="h-5 w-5 text-primary" />
                Resumen del Proceso
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                {resumen.despacho && (
                  <InfoItem icon={Building2} label="Despacho" value={resumen.despacho} />
                )}
                {(resumen.ciudad || resumen.departamento) && (
                  <InfoItem
                    icon={MapPin}
                    label="Ubicación"
                    value={[resumen.ciudad, resumen.departamento].filter(Boolean).join(", ")}
                  />
                )}
                {resumen.jurisdiccion && (
                  <InfoItem icon={Scale} label="Jurisdicción" value={resumen.jurisdiccion} />
                )}
                {resumen.demandante && (
                  <InfoItem icon={User} label="Demandante / Accionante" value={resumen.demandante} />
                )}
                {resumen.demandado && (
                  <InfoItem icon={Users} label="Demandado / Accionado" value={resumen.demandado} />
                )}
                {resumen.tipo_proceso && (
                  <InfoItem icon={FileText} label="Tipo" value={resumen.tipo_proceso} />
                )}
                {resumen.fecha_radicacion && (
                  <InfoItem
                    icon={Calendar}
                    label="Radicación"
                    value={new Date(resumen.fecha_radicacion).toLocaleDateString("es-CO", {
                      year: "numeric", month: "long", day: "numeric",
                    })}
                  />
                )}
                {resumen.ultima_actuacion_fecha && (
                  <InfoItem
                    icon={Clock}
                    label="Última actuación"
                    value={`${new Date(resumen.ultima_actuacion_fecha).toLocaleDateString("es-CO")}${resumen.ultima_actuacion_tipo ? ` — ${resumen.ultima_actuacion_tipo}` : ""}`}
                  />
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <Badge variant="secondary" className="text-xs">
                  <Activity className="h-3 w-3 mr-1" />
                  {resumen.total_actuaciones} actuaciones
                </Badge>
                {resumen.total_estados > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    <LayoutGrid className="h-3 w-3 mr-1" />
                    {resumen.total_estados} estados
                  </Badge>
                )}
              </div>
            </div>

            {/* Tabs: Actuaciones, Estados, Pipeline */}
            <Tabs defaultValue="actuaciones" className="w-full">
              <TabsList className="w-full justify-start">
                <TabsTrigger value="actuaciones" className="gap-1.5">
                  <Activity className="h-3.5 w-3.5" />
                  Actuaciones ({actuaciones.length})
                </TabsTrigger>
                {estados.length > 0 && (
                  <TabsTrigger value="estados" className="gap-1.5">
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Estados ({estados.length})
                  </TabsTrigger>
                )}
                <TabsTrigger value="kanban" className="gap-1.5">
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Pipeline
                </TabsTrigger>
              </TabsList>

              <TabsContent value="actuaciones" className="mt-4">
                <DemoActuacionesTimeline actuaciones={actuaciones} />
              </TabsContent>

              {estados.length > 0 && (
                <TabsContent value="estados" className="mt-4">
                  <DemoEstadosList estados={estados} />
                </TabsContent>
              )}

              <TabsContent value="kanban" className="mt-4">
                <div className="space-y-6">
                  <div>
                    <h4 className="text-sm font-medium mb-1 text-muted-foreground">
                      Así se vería en tu espacio de trabajo
                    </h4>
                    <p className="text-xs text-muted-foreground mb-4">
                      Un vistazo a cómo Andromeda organizaría este caso en tu pipeline.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    <DemoWorkItemCard resumen={resumen} />
                    <DemoMiniKanban resumen={resumen} />
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            {/* Andro IA mascot */}
            <DemoAteniaMascot actuacionesCount={actuaciones.length} />

            {/* CTA */}
            <div className="rounded-lg border bg-primary/5 p-6 text-center space-y-3">
              <h4 className="text-lg font-semibold">
                ¿Te gustó? Tu espacio de trabajo completo te espera.
              </h4>
              <p className="text-sm text-muted-foreground max-w-lg mx-auto">
                Sincronización automática diaria, alertas inteligentes, Andro IA
                monitoreando tus casos 24/7.
              </p>
              <Button asChild size="lg">
                <Link to="/auth?signup=true">
                  Crear cuenta gratis — 3 meses
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </ScrollArea>

        {/* Footer CTA */}
        <div className="border-t bg-muted/30 px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2">
          <p className="text-xs sm:text-sm text-muted-foreground">
            ¿Quieres gestionar este y todos tus procesos?
          </p>
          <Button asChild>
            <Link to="/auth?signup=true">
              Comenzar gratis
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Provider outcomes detail panel */
function ProviderOutcomesPanel({ outcomes }: { outcomes: ProviderOutcome[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {outcomes.map((o) => {
        const isSuccess = o.outcome === "success";
        const isNoData = o.outcome === "no-data";
        const isError = o.outcome === "error" || o.outcome === "timeout";
        const isSkipped = o.outcome === "skipped";

        return (
          <div
            key={o.name}
            className={`rounded-md border p-3 text-xs ${
              isSuccess
                ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-800/50"
                : isNoData
                ? "bg-muted/30 border-border"
                : isError
                ? "bg-red-50/50 dark:bg-red-950/20 border-red-200/50 dark:border-red-800/50"
                : "bg-muted/20 border-border/50"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium truncate">{o.label || o.name}</span>
              {isSuccess && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />}
              {isNoData && <XCircle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
              {isError && <AlertTriangle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />}
              {isSkipped && <Info className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0" />}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              {isSuccess && (
                <span>
                  {o.actuaciones_count > 0 && `${o.actuaciones_count} act.`}
                  {o.actuaciones_count > 0 && o.estados_count > 0 && " · "}
                  {o.estados_count > 0 && `${o.estados_count} est.`}
                  {o.actuaciones_count === 0 && o.estados_count === 0 && "Metadatos"}
                </span>
              )}
              {isNoData && <span>Sin datos para este radicado</span>}
              {isError && <span>No disponible</span>}
              {isSkipped && <span>No configurada</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium truncate">{value}</p>
      </div>
    </div>
  );
}
