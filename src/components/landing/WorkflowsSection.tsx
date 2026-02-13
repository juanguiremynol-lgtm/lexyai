import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Scale, Landmark, Gavel, Shield, Briefcase } from "lucide-react";

const WORKFLOWS = [
  {
    icon: Scale,
    title: "CGP / Civil",
    badge: "ICARUS · CPNU",
    description:
      "Seguimiento de procesos del Código General del Proceso. Estados via ICARUS, actuaciones via CPNU con fallback a SAMAI.",
    highlights: ["Términos legales automáticos", "Alertas de traslado y audiencia", "Línea de tiempo completa"],
  },
  {
    icon: Landmark,
    title: "Contencioso CPACA",
    badge: "SAMAI",
    description:
      "Gestión integral de procesos contencioso-administrativos. Cálculo de caducidad, traslados y audiencias.",
    highlights: ["Caducidad y prescripción", "Seguimiento de medidas cautelares", "Publicaciones procesales"],
  },
  {
    icon: Gavel,
    title: "Tutelas",
    badge: "Tutelas API · CPNU",
    description:
      "Plazos estrictos de tutela con monitoreo multi-fuente. Notificaciones de impugnación, fallo y cumplimiento.",
    highlights: ["Alertas de 48 horas", "Seguimiento de impugnación", "Control de cumplimiento"],
  },
  {
    icon: Shield,
    title: "Penal (Ley 906)",
    badge: "Publicaciones",
    description:
      "Clasificación de fases penales (indagación, investigación, juicio). Audiencias y publicaciones procesales.",
    highlights: ["Fases del proceso penal", "Audiencias programadas", "Publicaciones automatizadas"],
  },
  {
    icon: Briefcase,
    title: "Laboral",
    badge: "ICARUS · CPNU",
    description:
      "Procesos laborales con seguimiento de términos, audiencias de conciliación y fallos.",
    highlights: ["Términos laborales", "Conciliación obligatoria", "Seguimiento de sentencias"],
  },
];

export function WorkflowsSection() {
  return (
    <section className="py-20 md:py-28" id="features">
      <div className="container max-w-7xl mx-auto px-4">
        <div className="text-center mb-14 max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Un flujo especializado para cada tipo de proceso
          </h2>
          <p className="text-muted-foreground text-lg">
            Andromeda adapta reglas, fuentes de datos y alertas según la categoría 
            del proceso. Sin configuración manual.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {WORKFLOWS.map((wf) => {
            const Icon = wf.icon;
            return (
              <Card key={wf.title} className="relative overflow-hidden group hover:shadow-lg transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <CardTitle className="text-lg">{wf.title}</CardTitle>
                      <Badge variant="outline" className="text-xs font-normal">
                        {wf.badge}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{wf.description}</p>
                  <ul className="space-y-1.5">
                    {wf.highlights.map((h) => (
                      <li key={h} className="text-xs text-muted-foreground flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-primary shrink-0" />
                        {h}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
