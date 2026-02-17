/**
 * "Used for" Workflow Grid — Social proof via capability cards
 * 
 * Shows all 7 workflow types Atenia handles, each opening a modal
 * with auto-generated feature bullets.
 */

import { useState } from "react";
import { 
  Scale, Landmark, Gavel, Shield, Briefcase, FileText, ScrollText,
  X, CheckCircle2, Bell, Clock, Search
} from "lucide-react";
import { cn } from "@/lib/utils";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface WorkflowType {
  id: string;
  icon: typeof Scale;
  title: string;
  subtitle: string;
  color: string;
  features: { icon: typeof CheckCircle2; text: string }[];
}

const WORKFLOW_TYPES: WorkflowType[] = [
  {
    id: "cgp",
    icon: Scale,
    title: "CGP / Civil",
    subtitle: "Código General del Proceso",
    color: "from-blue-500/20 to-blue-600/10 border-blue-500/30",
    features: [
      { icon: Search, text: "Seguimiento automático de actuaciones vía CPNU y SAMAI" },
      { icon: Bell, text: "Alertas inteligentes de traslados, audiencias y términos" },
      { icon: Clock, text: "Cálculo automático de plazos legales y caducidades" },
      { icon: CheckCircle2, text: "Línea de tiempo completa con publicaciones procesales" },
    ],
  },
  {
    id: "cpaca",
    icon: Landmark,
    title: "CPACA",
    subtitle: "Contencioso Administrativo",
    color: "from-purple-500/20 to-purple-600/10 border-purple-500/30",
    features: [
      { icon: Clock, text: "Control de caducidad y prescripción automatizado" },
      { icon: Search, text: "Seguimiento de medidas cautelares y autos interlocutorios" },
      { icon: Bell, text: "Notificaciones de publicaciones procesales en tiempo real" },
      { icon: CheckCircle2, text: "Gestión integral de audiencias y traslados" },
    ],
  },
  {
    id: "laboral",
    icon: Briefcase,
    title: "Laboral",
    subtitle: "Procesos Laborales",
    color: "from-amber-500/20 to-amber-600/10 border-amber-500/30",
    features: [
      { icon: Clock, text: "Términos laborales con cálculo de días hábiles" },
      { icon: Search, text: "Seguimiento de conciliación obligatoria y audiencias" },
      { icon: Bell, text: "Alertas de sentencias y recursos de apelación" },
      { icon: CheckCircle2, text: "Monitoreo multi-fuente (CPNU + SAMAI)" },
    ],
  },
  {
    id: "penal",
    icon: Shield,
    title: "Penal",
    subtitle: "Ley 906 / Sistema Acusatorio",
    color: "from-red-500/20 to-red-600/10 border-red-500/30",
    features: [
      { icon: Search, text: "Clasificación automática de fases penales" },
      { icon: Bell, text: "Alertas de audiencias programadas y reprogramaciones" },
      { icon: Clock, text: "Control de términos de indagación e investigación" },
      { icon: CheckCircle2, text: "Publicaciones procesales y autos automatizados" },
    ],
  },
  {
    id: "tutelas",
    icon: Gavel,
    title: "Tutelas",
    subtitle: "Acción de Tutela",
    color: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30",
    features: [
      { icon: Bell, text: "Alertas críticas de 48 horas para cumplimiento" },
      { icon: Search, text: "Seguimiento de impugnación y revisión ante Corte" },
      { icon: Clock, text: "Plazos estrictos con monitoreo multi-fuente" },
      { icon: CheckCircle2, text: "Control de cumplimiento y desacato" },
    ],
  },
  {
    id: "peticiones",
    icon: FileText,
    title: "Peticiones",
    subtitle: "Derechos de Petición",
    color: "from-cyan-500/20 to-cyan-600/10 border-cyan-500/30",
    features: [
      { icon: Clock, text: "Control automático de términos de respuesta (15/30 días)" },
      { icon: Bell, text: "Alertas antes del vencimiento del plazo legal" },
      { icon: Search, text: "Seguimiento del estado: radicada, en trámite, resuelta" },
      { icon: CheckCircle2, text: "Historial completo de la gestión y respuestas" },
    ],
  },
  {
    id: "administrativo",
    icon: ScrollText,
    title: "Proceso Administrativo",
    subtitle: "Procedimientos Administrativos",
    color: "from-indigo-500/20 to-indigo-600/10 border-indigo-500/30",
    features: [
      { icon: Search, text: "Seguimiento de trámites ante entidades públicas" },
      { icon: Clock, text: "Control de términos de respuesta y silencio administrativo" },
      { icon: Bell, text: "Alertas de resoluciones y actos administrativos" },
      { icon: CheckCircle2, text: "Gestión de recursos en vía gubernativa" },
    ],
  },
];

export function WorkflowGridSection() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowType | null>(null);

  const handleCardClick = (wf: WorkflowType) => {
    setSelectedWorkflow(wf);
    track(ANALYTICS_EVENTS.LANDING_WORKFLOW_CARD_OPEN, { workflow_type: wf.id });
  };

  return (
    <section className="py-20 md:py-28 bg-gradient-to-b from-background to-muted/20">
      <div className="container max-w-7xl mx-auto px-4">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-primary mb-3">
            Diseñado para el derecho colombiano
          </span>
          <h2 className="text-3xl md:text-4xl font-display font-bold tracking-tight text-foreground mb-4">
            Un motor especializado para cada tipo de proceso
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Atenia adapta automáticamente sus fuentes de datos, reglas de alerta y cálculos de plazos 
            según la categoría del proceso. Sin configuración manual.
          </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-5">
          {WORKFLOW_TYPES.map((wf) => {
            const Icon = wf.icon;
            return (
              <button
                key={wf.id}
                onClick={() => handleCardClick(wf)}
                className={cn(
                  "group relative flex flex-col items-center gap-3 p-6 rounded-xl border",
                  "bg-gradient-to-br transition-all duration-300",
                  "hover:scale-[1.03] hover:shadow-lg",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  wf.color
                )}
              >
                <div className="p-3 rounded-xl bg-background/80 shadow-sm group-hover:shadow-md transition-shadow">
                  <Icon className="h-6 w-6 text-foreground" />
                </div>
                <div className="text-center">
                  <h3 className="font-semibold text-foreground text-sm md:text-base">{wf.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">{wf.subtitle}</p>
                </div>
                <span className="text-[10px] uppercase tracking-wider text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  Ver detalles →
                </span>
              </button>
            );
          })}
        </div>

        {/* Tagline */}
        <p className="text-center text-sm text-muted-foreground mt-8">
          Haz clic en cada tipo de proceso para ver qué hace Atenia por ti.
        </p>
      </div>

      {/* Detail Modal */}
      <Dialog open={!!selectedWorkflow} onOpenChange={(open) => !open && setSelectedWorkflow(null)}>
        {selectedWorkflow && (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className={cn("p-2.5 rounded-xl bg-gradient-to-br", selectedWorkflow.color)}>
                  <selectedWorkflow.icon className="h-5 w-5 text-foreground" />
                </div>
                <div>
                  <DialogTitle className="text-lg">{selectedWorkflow.title}</DialogTitle>
                  <DialogDescription>{selectedWorkflow.subtitle}</DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-3 mt-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                Lo que Atenia hace por ti
              </p>
              <ul className="space-y-3">
                {selectedWorkflow.features.map((f, i) => {
                  const FIcon = f.icon;
                  return (
                    <li key={i} className="flex items-start gap-3">
                      <div className="mt-0.5 p-1 rounded-md bg-primary/10 shrink-0">
                        <FIcon className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <span className="text-sm text-foreground leading-relaxed">{f.text}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
