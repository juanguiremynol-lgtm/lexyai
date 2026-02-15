/**
 * WizardProcessPreview — Rich summary panel shown after "Buscar proceso" in the wizard.
 * Shows case metadata, actuaciones timeline, estados, and provider status.
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2,
  AlertCircle,
  MapPin,
  Users,
  FileText,
  Calendar,
  ChevronDown,
  ChevronUp,
  Database,
  Activity,
  MinusCircle,
} from "lucide-react";
import type { ProcessData, LookupResult } from "@/hooks/use-radicado-lookup";
import { formatRadicadoDisplay } from "@/lib/radicado-utils";

interface WizardProcessPreviewProps {
  lookupResult: LookupResult;
  radicado: string;
  workflowType?: string;
}

export function WizardProcessPreview({ lookupResult, radicado, workflowType }: WizardProcessPreviewProps) {
  const data = lookupResult.process_data;
  const [showAllActuaciones, setShowAllActuaciones] = useState(false);

  if (!data) return null;

  const actuaciones = data.actuaciones || [];
  const providerSummary = data.provider_summary || {};
  const sourcesFound = data.sources_found || [];
  const isTutela = workflowType === 'TUTELA';

  // Label parties based on workflow
  const plaintiffLabel = isTutela ? 'Accionante' : 'Demandante';
  const defendantLabel = isTutela ? 'Accionado' : 'Demandado';

  const displayedActuaciones = showAllActuaciones ? actuaciones : actuaciones.slice(0, 5);

  return (
    <div className="space-y-3 rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-primary" />
          <span className="font-display font-semibold text-sm">
            {lookupResult.found_status === 'FOUND_PARTIAL' ? 'Proceso Encontrado (parcial)' : 'Proceso Encontrado'}
          </span>
          {lookupResult.found_status === 'FOUND_PARTIAL' && (
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
              Datos parciales
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {lookupResult.cgp_phase && (
            <Badge variant={lookupResult.cgp_phase === 'PROCESS' ? 'default' : 'secondary'} className="text-xs">
              {lookupResult.cgp_phase === 'PROCESS' ? 'Admitido' : 'Radicación'}
            </Badge>
          )}
          {lookupResult.source_used && (
            <Badge variant="outline" className="text-xs">
              {lookupResult.source_used}
            </Badge>
          )}
        </div>
      </div>

      <Separator />

      {/* Case Metadata Grid */}
      <div className="px-4 space-y-2">
        {/* Radicado */}
        <MetaRow icon={<FileText className="h-3.5 w-3.5" />} label="Radicado">
          <span className="font-mono text-xs">{formatRadicadoDisplay(radicado)}</span>
        </MetaRow>

        {/* Despacho */}
        {data.despacho && (
          <MetaRow icon={<MapPin className="h-3.5 w-3.5" />} label="Despacho">
            {data.despacho}
          </MetaRow>
        )}

        {/* City/Department */}
        {(data.ciudad || data.departamento) && (
          <MetaRow icon={<MapPin className="h-3.5 w-3.5" />} label="Ubicación">
            {[data.ciudad, data.departamento].filter(Boolean).join(', ')}
          </MetaRow>
        )}

        {/* Tipo Proceso */}
        {data.tipo_proceso && (
          <MetaRow icon={<FileText className="h-3.5 w-3.5" />} label="Tipo Proceso">
            {data.tipo_proceso}
            {data.clase_proceso && data.clase_proceso !== data.tipo_proceso && (
              <span className="text-muted-foreground ml-1">({data.clase_proceso})</span>
            )}
          </MetaRow>
        )}

        {/* Filing Date */}
        {data.fecha_radicacion && (
          <MetaRow icon={<Calendar className="h-3.5 w-3.5" />} label="Fecha Radicación">
            {data.fecha_radicacion}
          </MetaRow>
        )}

        {/* Parties */}
        {(data.demandante || data.demandado) && (
          <MetaRow icon={<Users className="h-3.5 w-3.5" />} label="Partes">
            <div className="space-y-0.5">
              {data.demandante && (
                <div>
                  <span className="text-muted-foreground text-xs">{plaintiffLabel}:</span>{' '}
                  <span className="text-xs">{data.demandante.replace(/\|/g, ', ')}</span>
                </div>
              )}
              {data.demandado && (
                <div>
                  <span className="text-muted-foreground text-xs">{defendantLabel}:</span>{' '}
                  <span className="text-xs">{data.demandado.replace(/\|/g, ', ')}</span>
                </div>
              )}
            </div>
          </MetaRow>
        )}

        {/* Tutela-specific fields */}
        {isTutela && data.ponente && (
          <MetaRow icon={<Users className="h-3.5 w-3.5" />} label="Ponente">
            {data.ponente}
          </MetaRow>
        )}
        {isTutela && data.corte_status && (
          <MetaRow icon={<Activity className="h-3.5 w-3.5" />} label="Estado Corte">
            {data.corte_status}
          </MetaRow>
        )}

        {/* Sujetos procesales if present and no parties */}
        {!data.demandante && !data.demandado && data.sujetos_procesales && data.sujetos_procesales.length > 0 && (
          <MetaRow icon={<Users className="h-3.5 w-3.5" />} label="Sujetos Procesales">
            <div className="space-y-0.5">
              {data.sujetos_procesales.slice(0, 6).map((s, i) => (
                <div key={i} className="text-xs">
                  <span className="text-muted-foreground">{s.tipo}:</span> {s.nombre}
                </div>
              ))}
              {data.sujetos_procesales.length > 6 && (
                <span className="text-xs text-muted-foreground">+{data.sujetos_procesales.length - 6} más</span>
              )}
            </div>
          </MetaRow>
        )}
      </div>

      {/* Tabs: Actuaciones + Providers */}
      <Tabs defaultValue="actuaciones" className="px-4 pb-4">
        <TabsList className="w-full grid grid-cols-2 h-8">
          <TabsTrigger value="actuaciones" className="text-xs gap-1">
            <Activity className="h-3 w-3" />
            Actuaciones ({actuaciones.length})
          </TabsTrigger>
          <TabsTrigger value="providers" className="text-xs gap-1">
            <Database className="h-3 w-3" />
            Fuentes ({sourcesFound.length}/{lookupResult.sources_checked?.length || 0})
          </TabsTrigger>
        </TabsList>

        {/* Actuaciones Tab */}
        <TabsContent value="actuaciones" className="mt-2">
          {actuaciones.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground text-xs">
              <AlertCircle className="h-4 w-4 mx-auto mb-1 opacity-50" />
              No se encontraron actuaciones registradas aún.
              {lookupResult.classification_reason && (
                <p className="mt-1 text-[10px]">{lookupResult.classification_reason}</p>
              )}
            </div>
          ) : (
            <ScrollArea className={actuaciones.length > 5 ? "max-h-[200px]" : ""}>
              <div className="space-y-1.5">
                {displayedActuaciones.map((act, idx) => (
                  <div key={idx} className="flex gap-2 text-xs p-2 rounded bg-background/60 border border-border/30">
                    <div className="text-muted-foreground shrink-0 w-[70px] font-mono">
                      {act.fecha || '—'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{act.actuacion}</p>
                      {act.anotacion && (
                        <p className="text-muted-foreground truncate mt-0.5">{act.anotacion}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {actuaciones.length > 5 && !showAllActuaciones && (
                <button
                  onClick={() => setShowAllActuaciones(true)}
                  className="w-full text-xs text-primary hover:underline mt-2 flex items-center justify-center gap-1"
                >
                  <ChevronDown className="h-3 w-3" />
                  Ver todas ({actuaciones.length})
                </button>
              )}
              {showAllActuaciones && actuaciones.length > 5 && (
                <button
                  onClick={() => setShowAllActuaciones(false)}
                  className="w-full text-xs text-primary hover:underline mt-2 flex items-center justify-center gap-1"
                >
                  <ChevronUp className="h-3 w-3" />
                  Mostrar menos
                </button>
              )}
            </ScrollArea>
          )}
        </TabsContent>

        {/* Provider Status Tab */}
        <TabsContent value="providers" className="mt-2">
          <div className="space-y-1.5">
            {/* From attempts (always available) */}
            {lookupResult.attempts && lookupResult.attempts.length > 0 ? (
              lookupResult.attempts.map((attempt, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs p-2 rounded bg-background/60 border border-border/30">
                  <ProviderStatusIcon success={attempt.success} />
                  <span className="font-medium flex-1">{attempt.source}</span>
                  <span className="text-muted-foreground">{attempt.latency_ms}ms</span>
                  {attempt.success && attempt.events_found !== undefined && (
                    <Badge variant="outline" className="text-[10px] h-4 px-1">
                      {attempt.events_found} act.
                    </Badge>
                  )}
                  {!attempt.success && attempt.error && (
                    <span className="text-destructive text-[10px] truncate max-w-[120px]">{attempt.error}</span>
                  )}
                </div>
              ))
            ) : Object.keys(providerSummary).length > 0 ? (
              Object.entries(providerSummary).map(([provider, status]) => (
                <div key={provider} className="flex items-center gap-2 text-xs p-2 rounded bg-background/60 border border-border/30">
                  <ProviderStatusIcon success={status.ok && status.found} />
                  <span className="font-medium flex-1">{provider}</span>
                  {status.found && status.actuaciones_count !== undefined && (
                    <Badge variant="outline" className="text-[10px] h-4 px-1">
                      {status.actuaciones_count} act.
                    </Badge>
                  )}
                  {!status.found && !status.error && (
                    <span className="text-muted-foreground text-[10px]">Sin datos</span>
                  )}
                  {status.error && (
                    <span className="text-destructive text-[10px] truncate max-w-[120px]">{status.error}</span>
                  )}
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground text-center py-2">
                Fuentes consultadas: {lookupResult.sources_checked?.join(', ') || 'N/A'}
              </p>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Classification note */}
      {lookupResult.classification_reason && (
        <div className="px-4 pb-3">
          <p className="text-[10px] text-muted-foreground bg-background/50 p-2 rounded">
            {lookupResult.classification_reason}
          </p>
        </div>
      )}
    </div>
  );
}

// --- Helper components ---

function MetaRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <div className="text-muted-foreground mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <span className="text-muted-foreground text-xs">{label}:</span>
        <span className="ml-1.5 text-xs">{children}</span>
      </div>
    </div>
  );
}

function ProviderStatusIcon({ success }: { success: boolean }) {
  return success ? (
    <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
  ) : (
    <MinusCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
  );
}
