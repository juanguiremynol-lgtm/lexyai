/**
 * DemoResultModal — Responsive results overlay.
 * Desktop (≥1024px): Radix Dialog modal.
 * Mobile/Tablet (<1024px): Vaul Drawer (full-screen bottom sheet).
 */

import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
} from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  X, Scale, MapPin, Calendar, FileText, Activity, LayoutGrid,
  Building2, Clock, ArrowRight, User, Users, CheckCircle2, XCircle,
  AlertTriangle, Info, ChevronDown, ChevronUp, Zap,
} from "lucide-react";
import { DemoActuacionesTimeline } from "./DemoActuacionesTimeline";
import { DemoEstadosList } from "./DemoEstadosList";
import { DemoPipelineKanban } from "./DemoPipelineKanban";
import { DemoDetailView } from "./DemoDetailView";
import { DemoPipelineProvider } from "./DemoPipelineContext";
import { DemoAteniaMascot } from "./DemoAteniaMascot";
import { getCategoryDisplayName } from "./demo-pipeline-stages";
import { Link } from "react-router-dom";
import type { DemoResult, ProviderOutcome } from "./demo-types";
import { detectDemoAmbiguity } from "./demo-ambiguity";
import { useMemo, useState, useEffect } from "react";
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
  UNCERTAIN: { label: "Categoría por confirmar", shortLabel: "Por confirmar", emoji: "🔍" },
};

const DESKTOP_BREAKPOINT = 1024;

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState<boolean>(
    typeof window !== "undefined" ? window.innerWidth >= DESKTOP_BREAKPOINT : true
  );
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", onChange);
    setIsDesktop(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

interface DemoResultModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: DemoResult | null;
}

export function DemoResultModal({ open, onOpenChange, data }: DemoResultModalProps) {
  const isDesktop = useIsDesktop();

  if (!data) return null;

  if (isDesktop) {
    return (
      <DemoPipelineProvider data={data}>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="max-w-5xl w-[95vw] h-[90vh] max-h-[90vh] p-0 gap-0 overflow-hidden rounded-lg flex flex-col">
            <ResultsContent data={data} onClose={() => onOpenChange(false)} />
          </DialogContent>
        </Dialog>
        <DemoDetailView />
      </DemoPipelineProvider>
    );
  }

  // Mobile/Tablet: full-screen drawer
  return (
    <DemoPipelineProvider data={data}>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[100dvh] max-h-[100dvh] rounded-t-none p-0 [&>div:first-child]:hidden">
          <ResultsContent data={data} onClose={() => onOpenChange(false)} isMobile />
        </DrawerContent>
      </Drawer>
      <DemoDetailView />
    </DemoPipelineProvider>
  );
}

/** Shared results content for both desktop modal and mobile drawer */
function ResultsContent({
  data,
  onClose,
  isMobile = false,
}: {
  data: DemoResult;
  onClose: () => void;
  isMobile?: boolean;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const categoryMeta = useMemo(() => {
    if (!data?.category_inference) return null;
    return CATEGORY_LABELS[data.category_inference.category] || CATEGORY_LABELS.DESCONOCIDA;
  }, [data]);

  const ambiguity = useMemo(() => {
    if (!data) return null;
    return detectDemoAmbiguity(data);
  }, [data]);

  const { resumen, actuaciones, estados, meta, category_inference, conflicts } = data;

  const confidenceLabel: Record<string, string> = {
    HIGH: "Alta confianza",
    MEDIUM: "Confianza media",
    LOW: "Confianza baja",
    UNCERTAIN: "Por confirmar",
  };

  const providersChecked = meta.providers_checked || meta.provider_outcomes?.length || 0;
  const providersWithData = meta.providers_with_data || meta.sources?.length || 0;

  return (
    <div className="flex flex-col h-full" style={isMobile ? { paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" } : undefined}>
      {/* Fixed Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b bg-muted/30 flex-shrink-0">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="font-mono text-xs shrink-0">
              {resumen.radicado_display}
            </Badge>
            <Badge className="text-xs bg-primary/10 text-primary border-primary/20 shrink-0">
              Demo
            </Badge>
            {categoryMeta && category_inference && (
              <Badge className={`text-xs border ${
                category_inference.confidence === "UNCERTAIN"
                  ? "bg-muted/30 text-muted-foreground border-border"
                  : "bg-accent/15 text-accent-foreground border-accent/30"
              }`}>
                {categoryMeta.emoji} {isMobile ? categoryMeta.shortLabel : categoryMeta.label}
                {!isMobile && (
                  <span className="ml-1 opacity-60">({confidenceLabel[category_inference.confidence]})</span>
                )}
              </Badge>
            )}
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground truncate">
            {categoryMeta && category_inference && category_inference.confidence !== "UNCERTAIN" && category_inference.category !== "DESCONOCIDA"
              ? `Andromeda identificó este caso como ${categoryMeta.shortLabel}`
              : "Así se vería este proceso en Andromeda"}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="flex-shrink-0 ml-2">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Scrollable Content */}
      {isMobile ? (
        <div className="flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" as any }}>
          <div className="p-3 space-y-4 pb-6">
            <ResultsBody
              data={data}
              categoryMeta={categoryMeta}
              ambiguity={ambiguity}
              sourcesOpen={sourcesOpen}
              setSourcesOpen={setSourcesOpen}
              providersChecked={providersChecked}
              providersWithData={providersWithData}
              isMobile
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" as any }}>
          <div className="p-6 space-y-6">
            <ResultsBody
              data={data}
              categoryMeta={categoryMeta}
              ambiguity={ambiguity}
              sourcesOpen={sourcesOpen}
              setSourcesOpen={setSourcesOpen}
              providersChecked={providersChecked}
              providersWithData={providersWithData}
            />
          </div>
        </div>
      )}

      {/* Fixed Footer */}
      <div className="border-t bg-muted/30 px-4 sm:px-6 py-3 flex items-center justify-between gap-2 flex-shrink-0">
        <p className="text-xs sm:text-sm text-muted-foreground">
          ¿Quieres gestionar tus procesos?
        </p>
        <div className="flex gap-2 flex-shrink-0">
          <Button asChild size={isMobile ? "sm" : "default"}>
            <Link to="/auth?signup=true">
              Comenzar gratis
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/** All result sections — shared between mobile/desktop */
function ResultsBody({
  data,
  categoryMeta,
  ambiguity,
  sourcesOpen,
  setSourcesOpen,
  providersChecked,
  providersWithData,
  isMobile = false,
}: {
  data: DemoResult;
  categoryMeta: { label: string; shortLabel: string; emoji: string } | null;
  ambiguity: ReturnType<typeof detectDemoAmbiguity> | null;
  sourcesOpen: boolean;
  setSourcesOpen: (v: boolean) => void;
  providersChecked: number;
  providersWithData: number;
  isMobile?: boolean;
}) {
  const { resumen, actuaciones, estados, meta, category_inference, conflicts } = data;

  return (
    <>
      {/* Coverage Summary Bar + Cache Status */}
      <div className="rounded-lg border bg-card p-3 sm:p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <span className="text-xs sm:text-sm font-medium">Cobertura</span>
            </div>
            <Badge variant="secondary" className="text-xs">
              {providersWithData}/{providersChecked} fuentes
            </Badge>
            {meta.served_from_cache && (
              <Badge variant="outline" className="text-xs text-blue-600 border-blue-200 dark:text-blue-400 dark:border-blue-800">
                <Clock className="h-3 w-3 mr-1" />
                {meta.cache_age_minutes != null && meta.cache_age_minutes > 0
                  ? `Caché (hace ${meta.cache_age_minutes} min)`
                  : "Caché"}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">
              {meta.refreshed_at
                ? `Actualizado ${new Date(meta.refreshed_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </span>
            <Collapsible open={sourcesOpen} onOpenChange={setSourcesOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs gap-1.5 h-7">
                  <Info className="h-3.5 w-3.5" />
                  {isMobile ? "Fuentes" : "Ver fuentes"}
                  {sourcesOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                <ProviderOutcomesPanel outcomes={meta.provider_outcomes || []} />
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>
        {providersWithData > 1 && (
          <p className="text-xs text-muted-foreground mt-2">
            ✓ Datos consolidados y deduplicados de múltiples fuentes.
          </p>
        )}
      </div>

      {/* Category Caveats Banner */}
      {category_inference?.caveats && category_inference.caveats.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 sm:p-4">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              {category_inference.caveats.map((caveat, i) => (
                <p key={i} className="text-xs sm:text-sm text-muted-foreground">{caveat}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Ambiguity Notice */}
      {ambiguity?.hasAmbiguity && ambiguity.ambiguityNotice && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 sm:p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <div className="space-y-2">
              <p className="text-xs sm:text-sm text-foreground">{ambiguity.ambiguityNotice}</p>
              {ambiguity.hasTutelaHints && ambiguity.tutelaHintSources.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p className="font-medium">Indicios encontrados:</p>
                  {ambiguity.tutelaHintSources.map((hint, i) => (
                    <p key={i}>• {hint}</p>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Puedes cambiar el pipeline en la pestaña "Pipeline".
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Conflicts Banner */}
      {conflicts && conflicts.length > 0 && (
        <div className="rounded-lg border border-amber-300/50 bg-amber-50/50 dark:bg-amber-950/20 p-3 sm:p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs sm:text-sm font-medium text-amber-800 dark:text-amber-300">
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
                Andromeda muestra el primer valor encontrado.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Resumen Card */}
      <div className="rounded-lg border bg-card p-4 sm:p-5 space-y-3 sm:space-y-4">
        <h3 className="font-semibold text-base sm:text-lg flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" />
          Resumen del Proceso
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
            <InfoItem icon={User} label="Demandante" value={resumen.demandante} />
          )}
          {resumen.demandado && (
            <InfoItem icon={Users} label="Demandado" value={resumen.demandado} />
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
        <div className="flex gap-2 sm:gap-3 pt-2 flex-wrap">
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
        <TabsList className={`w-full ${isMobile ? "grid grid-cols-3" : "justify-start"}`}>
          <TabsTrigger value="actuaciones" className="gap-1 text-xs sm:text-sm">
            <Activity className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Actuaciones</span>
            <span className="sm:hidden">Act.</span>
            <span className="text-xs opacity-60">({actuaciones.length})</span>
          </TabsTrigger>
          <TabsTrigger value="estados" className="gap-1 text-xs sm:text-sm">
            <LayoutGrid className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Estados</span>
            <span className="sm:hidden">Est.</span>
            <span className="text-xs opacity-60">({estados.length})</span>
          </TabsTrigger>
          <TabsTrigger value="kanban" className="gap-1 text-xs sm:text-sm">
            <LayoutGrid className="h-3.5 w-3.5" />
            Pipeline
          </TabsTrigger>
        </TabsList>

        <TabsContent value="actuaciones" className="mt-3 sm:mt-4">
          <DemoActuacionesTimeline actuaciones={actuaciones} />
        </TabsContent>

        <TabsContent value="estados" className="mt-3 sm:mt-4">
          <DemoEstadosList estados={estados} />
        </TabsContent>

        <TabsContent value="kanban" className="mt-3 sm:mt-4">
          <DemoPipelineKanban ambiguity={ambiguity} />
        </TabsContent>
      </Tabs>

      {/* Andro IA mascot */}
      <DemoAteniaMascot actuacionesCount={actuaciones.length} />

      {/* Dev-only debug panel */}
      {import.meta.env.DEV && (
        <details className="rounded-lg border border-dashed border-muted-foreground/30 p-3 text-xs font-mono">
          <summary className="cursor-pointer text-muted-foreground font-medium">
            🔧 Debug: Provider Fan-out ({meta.provider_outcomes?.length || 0} providers)
          </summary>
          <div className="mt-2 space-y-1">
            <p>providers_checked = {providersChecked} [{meta.provider_outcomes?.map(o => o.name).join(", ")}]</p>
            <p>providers_with_data = {providersWithData}</p>
            <div className="mt-1 space-y-0.5">
              {meta.provider_outcomes?.map(o => (
                <p key={o.name} className={o.outcome === "success" ? "text-emerald-600" : o.outcome === "no-data" ? "text-muted-foreground" : "text-red-500"}>
                  {o.name}: {o.outcome} | {o.found_status} | {o.latency_ms}ms | acts={o.actuaciones_count} est={o.estados_count}
                </p>
              ))}
            </div>
            <p className="mt-1">category: {category_inference?.category} ({category_inference?.confidence})</p>
            <p>signals: [{category_inference?.signals?.join(", ")}]</p>
            {category_inference?.caveats && <p>caveats: [{category_inference.caveats.join(" | ")}]</p>}
          </div>
        </details>
      )}

      {/* CTA */}
      <div className="rounded-lg border bg-primary/5 p-4 sm:p-6 text-center space-y-3">
        <h4 className="text-base sm:text-lg font-semibold">
          ¿Te gustó? Tu espacio de trabajo completo te espera.
        </h4>
        <p className="text-xs sm:text-sm text-muted-foreground max-w-lg mx-auto">
          Sincronización automática diaria, alertas inteligentes, Andro IA monitoreando tus casos 24/7.
        </p>
        <Button asChild size={isMobile ? "default" : "lg"}>
          <Link to="/auth?signup=true">
            Crear cuenta gratis
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </>
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
            className={`rounded-md border p-2.5 sm:p-3 text-xs ${
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
              {isNoData && <span>Sin datos</span>}
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
        <p className="text-sm font-medium break-words">{value}</p>
      </div>
    </div>
  );
}
