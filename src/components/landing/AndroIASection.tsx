import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Bot,
  BrainCircuit,
  MessageSquareText,
  ShieldCheck,
  Zap,
  FileSearch,
  RotateCcw,
} from "lucide-react";

const ANDRO_CAPABILITIES = [
  {
    icon: BrainCircuit,
    title: "Diagnóstico automático",
    description:
      "Andro IA analiza el estado de cada proceso, identifica riesgos y sugiere acciones antes de que venza un término.",
  },
  {
    icon: MessageSquareText,
    title: "Chat contextual por caso",
    description:
      "Pregúntale a Andro sobre cualquier proceso: resúmenes, historial de actuaciones, alertas activas y próximos pasos.",
  },
  {
    icon: FileSearch,
    title: "Clasificación inteligente",
    description:
      "Detecta automáticamente el tipo de proceso (CGP, CPACA, Tutela, Penal, Laboral) y aplica reglas especializadas.",
  },
  {
    icon: Zap,
    title: "Acciones autónomas",
    description:
      "Ejecuta tareas de bajo riesgo (marcar leído, programar alertas) de forma autónoma. Las acciones críticas requieren tu aprobación.",
  },
  {
    icon: RotateCcw,
    title: "Auto-remediación",
    description:
      "Cuando un proveedor falla o un scraping no responde, Andro reintenta con proveedores alternativos automáticamente.",
  },
  {
    icon: ShieldCheck,
    title: "Supervisión transparente",
    description:
      "Cada acción de IA queda registrada con razonamiento, evidencia y opción de reversa. Auditoría completa siempre.",
  },
];

export function AndroIASection() {
  return (
    <section className="py-20 md:py-28 bg-muted/30" id="andro-ia">
      <div className="container max-w-7xl mx-auto px-4">
        <div className="text-center mb-14 max-w-3xl mx-auto">
          <Badge variant="outline" className="mb-4">
            <Bot className="h-3.5 w-3.5 mr-1.5" />
            Andro IA
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Tu asistente legal que nunca duerme
          </h2>
          <p className="text-muted-foreground text-lg">
            Andro IA es el cerebro de Andromeda. Monitorea, diagnostica, clasifica 
            y actúa sobre tus procesos 24/7 — siempre bajo tu supervisión.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {ANDRO_CAPABILITIES.map((cap) => {
            const Icon = cap.icon;
            return (
              <Card key={cap.title} className="bg-card/60 backdrop-blur-sm border-border/50 hover:border-primary/30 transition-colors">
                <CardContent className="pt-6 space-y-3">
                  <div className="inline-flex p-2.5 rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-lg">{cap.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {cap.description}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
