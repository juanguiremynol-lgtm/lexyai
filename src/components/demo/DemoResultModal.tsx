/**
 * DemoResultModal — Full-screen modal showing demo radicado results
 *
 * Presents: Resumen card, Actuaciones timeline, Estados list,
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
  Building2, Clock, ArrowRight,
} from "lucide-react";
import { DemoActuacionesTimeline } from "./DemoActuacionesTimeline";
import { DemoEstadosList } from "./DemoEstadosList";
import { DemoMiniKanban } from "./DemoMiniKanban";
import { DemoWorkItemCard } from "./DemoWorkItemCard";
import { DemoAteniaMascot } from "./DemoAteniaMascot";
import { Link } from "react-router-dom";
import type { DemoResult } from "./demo-types";

interface DemoResultModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: DemoResult | null;
}

export function DemoResultModal({ open, onOpenChange, data }: DemoResultModalProps) {
  if (!data) return null;
  const { resumen, actuaciones, estados } = data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs">
                {resumen.radicado_display}
              </Badge>
              <Badge className="text-xs bg-primary/10 text-primary border-primary/20">
                Demo
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Así se vería este proceso en ATENIA
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1 h-[calc(90vh-140px)]">
          <div className="p-6 space-y-6">
            {/* Resumen Card */}
            <div className="rounded-lg border bg-card p-5 space-y-4">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Scale className="h-5 w-5 text-primary" />
                Resumen del Proceso
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
                      Un vistazo a cómo ATENIA organizaría este caso en tu pipeline.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-1">
                      <DemoWorkItemCard resumen={resumen} />
                    </div>
                    <div className="md:col-span-2">
                      <DemoMiniKanban resumen={resumen} />
                    </div>
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
        <div className="border-t bg-muted/30 px-6 py-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
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
