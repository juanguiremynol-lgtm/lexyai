import { Badge } from "@/components/ui/badge";
import {
  Bell,
  Mail,
  Smartphone,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  FileText,
} from "lucide-react";

const ALERT_FEATURES = [
  {
    icon: Bell,
    title: "Alertas en la App",
    description: "Notificaciones en tiempo real dentro de Andromeda con niveles de severidad (info, warning, critical).",
  },
  {
    icon: Mail,
    title: "Alertas por Email",
    description: "Resúmenes diarios y alertas críticas directamente a tu correo. Configura qué severidad te notifica.",
  },
  {
    icon: Clock,
    title: "Términos Inteligentes",
    description: "Cálculo automático de plazos legales con días hábiles y festivos colombianos. Alertas anticipadas configurables.",
  },
  {
    icon: AlertTriangle,
    title: "Vencimientos Críticos",
    description: "Alertas escalonadas: 5 días antes, día del vencimiento, y seguimiento post-vencimiento.",
  },
];

const EMAIL_FEATURES = [
  {
    icon: FileText,
    title: "Generación de Documentos",
    description: "Genera memoriales, derechos de petición y oficios desde plantillas con datos del proceso pre-llenados.",
  },
  {
    icon: Calendar,
    title: "Agenda Judicial",
    description: "Calendario unificado con todas tus audiencias, vencimientos y compromisos procesales.",
  },
  {
    icon: CheckCircle2,
    title: "Seguimiento de Actuaciones",
    description: "Historial completo y cronológico de todas las actuaciones de cada proceso con fuente verificada.",
  },
  {
    icon: Smartphone,
    title: "Acceso Responsive",
    description: "Consulta tus procesos y alertas desde cualquier dispositivo. Interfaz optimizada para móvil y escritorio.",
  },
];

export function AlertsAndEmailSection() {
  return (
    <section className="py-20 md:py-28 bg-muted/30" id="alerts">
      <div className="container max-w-7xl mx-auto px-4">
        <div className="text-center mb-14 max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Nunca pierdas un término. Nunca más.
          </h2>
          <p className="text-muted-foreground text-lg">
            Sistema de alertas multi-canal con cálculo inteligente de plazos, 
            generación de documentos y seguimiento completo de actuaciones.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-12">
          {/* Alerts column */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="secondary" className="text-sm">
                <Bell className="h-3.5 w-3.5 mr-1.5" />
                Alertas Inteligentes
              </Badge>
            </div>
            <div className="space-y-4">
              {ALERT_FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <div key={f.title} className="flex gap-4 p-4 rounded-lg border bg-card/60">
                    <div className="p-2 rounded-md bg-primary/10 h-fit">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-medium mb-1">{f.title}</h4>
                      <p className="text-sm text-muted-foreground">{f.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tools column */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="secondary" className="text-sm">
                <FileText className="h-3.5 w-3.5 mr-1.5" />
                Herramientas de Productividad
              </Badge>
            </div>
            <div className="space-y-4">
              {EMAIL_FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <div key={f.title} className="flex gap-4 p-4 rounded-lg border bg-card/60">
                    <div className="p-2 rounded-md bg-primary/10 h-fit">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-medium mb-1">{f.title}</h4>
                      <p className="text-sm text-muted-foreground">{f.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
