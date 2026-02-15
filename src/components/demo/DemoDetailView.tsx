/**
 * DemoDetailView — Tabbed detail view for a demo work item.
 * 
 * Mirrors the production work-item detail view with:
 * - Overview tab (metadata, parties, coverage)
 * - Actuaciones tab (timeline)
 * - Estados tab
 * 
 * Read-only. All data from in-memory demo state.
 */

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  X, Scale, Building2, MapPin, Calendar, User, Users, Activity,
  LayoutGrid, Clock, ArrowLeft, FileText, Zap,
} from "lucide-react";
import { useDemoPipeline, type DemoWorkItem } from "./DemoPipelineContext";
import { DemoActuacionesTimeline } from "./DemoActuacionesTimeline";
import { DemoEstadosList } from "./DemoEstadosList";
import { getCategoryDisplayName } from "./demo-pipeline-stages";

export function DemoDetailView() {
  const { items, selectedItemId, isDetailOpen, closeDetail } = useDemoPipeline();
  const item = items.find(i => i.id === selectedItemId);

  if (!item) return null;

  const categoryLabel = getCategoryDisplayName(item.category);
  const confidenceLabel: Record<string, string> = {
    HIGH: "Alta confianza",
    MEDIUM: "Confianza media",
    LOW: "Confianza baja",
    UNCERTAIN: "Por confirmar",
  };

  return (
    <Dialog open={isDetailOpen} onOpenChange={(open) => !open && closeDetail()}>
      <DialogContent className="max-w-4xl w-[98vw] sm:w-[95vw] h-[90vh] sm:h-[85vh] p-0 gap-0 overflow-hidden rounded-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1 h-7 -ml-2"
                onClick={closeDetail}
              >
                <ArrowLeft className="h-3 w-3" />
                Pipeline
              </Button>
              <Badge variant="outline" className="font-mono text-xs">
                {item.radicado_display}
              </Badge>
              <Badge className="text-xs bg-primary/10 text-primary border-primary/20">
                Demo
              </Badge>
              {item.isSample && (
                <Badge variant="outline" className="text-xs">Ejemplo</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {categoryLabel} • Detalle del proceso
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={closeDetail}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1 h-[calc(90vh-140px)] sm:h-[calc(85vh-140px)]">
          <div className="p-4 sm:p-6 space-y-6">
            {/* Overview Card */}
            <div className="rounded-lg border bg-card p-5 space-y-4">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Scale className="h-5 w-5 text-primary" />
                Resumen del Proceso
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {item.despacho && (
                  <DetailField icon={Building2} label="Despacho" value={item.despacho} />
                )}
                {item.jurisdiccion && (
                  <DetailField icon={Scale} label="Jurisdicción" value={item.jurisdiccion} />
                )}
                {item.demandante && (
                  <DetailField icon={User} label="Demandante" value={item.demandante} />
                )}
                {item.demandado && (
                  <DetailField icon={Users} label="Demandado" value={item.demandado} />
                )}
                {item.tipo_proceso && (
                  <DetailField icon={FileText} label="Tipo" value={item.tipo_proceso} />
                )}
                {item.fecha_radicacion && (
                  <DetailField
                    icon={Calendar}
                    label="Radicación"
                    value={new Date(item.fecha_radicacion).toLocaleDateString("es-CO", {
                      year: "numeric", month: "long", day: "numeric",
                    })}
                  />
                )}
                {item.ultima_actuacion_fecha && (
                  <DetailField
                    icon={Clock}
                    label="Última actuación"
                    value={new Date(item.ultima_actuacion_fecha).toLocaleDateString("es-CO")}
                  />
                )}
              </div>

              {/* Stats badges */}
              <div className="flex gap-3 pt-2">
                <Badge variant="secondary" className="text-xs">
                  <Activity className="h-3 w-3 mr-1" />
                  {item.total_actuaciones} actuaciones
                </Badge>
                {item.total_estados > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    <LayoutGrid className="h-3 w-3 mr-1" />
                    {item.total_estados} estados
                  </Badge>
                )}
              </div>

              {/* Category inference */}
              {item.category_inference && (
                <div className="flex items-center gap-2 pt-2 border-t">
                  <Zap className="h-4 w-4 text-primary" />
                  <span className="text-sm">
                    Clasificado como <strong>{categoryLabel}</strong>
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {confidenceLabel[item.category_inference.confidence]}
                  </Badge>
                </div>
              )}

              {/* Caveats */}
              {item.category_inference?.caveats && item.category_inference.caveats.length > 0 && (
                <div className="rounded-md bg-muted/30 p-3 text-sm text-muted-foreground space-y-1">
                  {item.category_inference.caveats.map((c, i) => (
                    <p key={i}>{c}</p>
                  ))}
                </div>
              )}
            </div>

            {/* Tabs */}
            {!item.isSample ? (
              <Tabs defaultValue="actuaciones" className="w-full">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="actuaciones" className="gap-1.5">
                    <Activity className="h-3.5 w-3.5" />
                    Actuaciones ({item.actuaciones.length})
                  </TabsTrigger>
                  <TabsTrigger value="estados" className="gap-1.5">
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Estados ({item.estados.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="actuaciones" className="mt-4">
                  <DemoActuacionesTimeline actuaciones={item.actuaciones} />
                </TabsContent>

                <TabsContent value="estados" className="mt-4">
                  <DemoEstadosList estados={item.estados} />
                </TabsContent>
              </Tabs>
            ) : (
              <div className="rounded-lg border bg-muted/20 p-8 text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  Esta es una tarjeta de ejemplo para demostrar el pipeline multi-proceso.
                </p>
                <p className="text-xs text-muted-foreground">
                  En tu cuenta, cada proceso tendría sus actuaciones, estados y documentos reales.
                </p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t bg-muted/30 px-4 py-3 flex items-center justify-between">
          <Badge variant="outline" className="text-xs">
            Demo Mode — Datos no almacenados
          </Badge>
          <Button size="sm" onClick={closeDetail}>
            <ArrowLeft className="h-3 w-3 mr-1.5" />
            Volver al pipeline
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailField({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}
